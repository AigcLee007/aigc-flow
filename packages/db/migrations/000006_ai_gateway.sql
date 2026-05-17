CREATE TABLE IF NOT EXISTS ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  default_base_url text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id),
  model_key text NOT NULL,
  display_name text NOT NULL,
  modality text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_window int,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_key)
);

CREATE TABLE IF NOT EXISTS api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES ai_providers(id),
  name text NOT NULL,
  encrypted_secret bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL,
  secret_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  rotated_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES ai_providers(id),
  model_id uuid REFERENCES ai_models(id),
  credential_id uuid REFERENCES api_credentials(id),
  route_key text NOT NULL,
  modality text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  weight int NOT NULL DEFAULT 100,
  fallback_group text,
  base_url_override text,
  request_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_run_id uuid,
  node_run_id uuid,
  provider_id uuid REFERENCES ai_providers(id),
  model_id uuid REFERENCES ai_models(id),
  route_id uuid REFERENCES ai_routes(id),
  status text NOT NULL,
  request_asset_id uuid REFERENCES assets(id),
  response_asset_id uuid REFERENCES assets(id),
  error jsonb,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  cost_raw numeric(18, 8),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_models_provider_modality_idx
  ON ai_models (provider_id, modality);

CREATE INDEX IF NOT EXISTS api_credentials_tenant_provider_idx
  ON api_credentials (tenant_id, provider_id);

CREATE UNIQUE INDEX IF NOT EXISTS api_credentials_system_name_unique_idx
  ON api_credentials (provider_id, name)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS api_credentials_tenant_name_unique_idx
  ON api_credentials (tenant_id, provider_id, name)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_routes_tenant_route_key_idx
  ON ai_routes (tenant_id, route_key);

CREATE INDEX IF NOT EXISTS ai_routes_provider_modality_status_idx
  ON ai_routes (provider_id, modality, status);

CREATE UNIQUE INDEX IF NOT EXISTS ai_routes_system_route_key_unique_idx
  ON ai_routes (route_key)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_routes_tenant_route_key_unique_idx
  ON ai_routes (tenant_id, route_key)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_call_logs_tenant_created_at_idx
  ON ai_call_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_call_logs_tenant_provider_created_at_idx
  ON ai_call_logs (tenant_id, provider_id, created_at DESC);

ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY api_credentials_select_current_tenant
  ON api_credentials
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY api_credentials_insert_current_tenant
  ON api_credentials
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY api_credentials_update_current_tenant
  ON api_credentials
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY api_credentials_delete_current_tenant
  ON api_credentials
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE ai_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_routes FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_routes_select_visible_routes
  ON ai_routes
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());

CREATE POLICY ai_routes_insert_current_tenant
  ON ai_routes
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY ai_routes_update_current_tenant
  ON ai_routes
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY ai_routes_delete_current_tenant
  ON ai_routes
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE ai_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_call_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_call_logs_select_current_tenant
  ON ai_call_logs
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY ai_call_logs_insert_current_tenant
  ON ai_call_logs
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY ai_call_logs_update_current_tenant
  ON ai_call_logs
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY ai_call_logs_delete_current_tenant
  ON ai_call_logs
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());
