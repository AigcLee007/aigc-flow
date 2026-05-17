CREATE TABLE IF NOT EXISTS billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  currency text NOT NULL DEFAULT 'USD',
  balance_cents bigint NOT NULL DEFAULT 0,
  reserved_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_run_id uuid REFERENCES workflow_runs(id) ON DELETE SET NULL,
  node_run_id uuid REFERENCES node_runs(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  route_id uuid REFERENCES ai_routes(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  modality text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  units numeric(18, 6),
  unit_type text,
  raw_cost numeric(18, 8),
  billable_cents bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS billing_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  billing_account_id uuid NOT NULL REFERENCES billing_accounts(id),
  usage_event_id uuid REFERENCES usage_events(id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  idempotency_key text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_accounts_tenant
  ON billing_accounts (tenant_id);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created_at
  ON usage_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_workflow_run
  ON usage_events (tenant_id, workflow_run_id);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_node_run
  ON usage_events (tenant_id, node_run_id);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_status
  ON usage_events (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_tenant_created_at
  ON billing_ledger (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_ledger_tenant_usage_event
  ON billing_ledger (tenant_id, usage_event_id);

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_accounts_select_current_tenant
  ON billing_accounts
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY billing_accounts_insert_current_tenant
  ON billing_accounts
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY billing_accounts_update_current_tenant
  ON billing_accounts
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY billing_accounts_delete_current_tenant
  ON billing_accounts
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;

CREATE POLICY usage_events_select_current_tenant
  ON usage_events
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY usage_events_insert_current_tenant
  ON usage_events
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY usage_events_update_current_tenant
  ON usage_events
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY usage_events_delete_current_tenant
  ON usage_events
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE billing_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_ledger_select_current_tenant
  ON billing_ledger
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY billing_ledger_insert_current_tenant
  ON billing_ledger
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY billing_ledger_update_current_tenant
  ON billing_ledger
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY billing_ledger_delete_current_tenant
  ON billing_ledger
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());
