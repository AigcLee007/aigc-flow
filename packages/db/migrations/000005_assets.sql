CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  workflow_run_id uuid,
  node_run_id uuid,
  owner_user_id uuid REFERENCES users(id),
  kind text NOT NULL,
  mime_type text NOT NULL,
  storage_provider text NOT NULL DEFAULT 's3',
  bucket text NOT NULL,
  object_key text NOT NULL,
  original_filename text,
  size_bytes bigint,
  checksum_sha256 text,
  width int,
  height int,
  duration_ms int,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'uploading',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (bucket, object_key)
);

CREATE TABLE IF NOT EXISTS asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  width int,
  height int,
  size_bytes bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, variant_key)
);

CREATE INDEX IF NOT EXISTS assets_tenant_created_at_idx
  ON assets (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assets_tenant_project_idx
  ON assets (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS assets_tenant_owner_user_idx
  ON assets (tenant_id, owner_user_id);

CREATE INDEX IF NOT EXISTS assets_tenant_status_idx
  ON assets (tenant_id, status);

CREATE INDEX IF NOT EXISTS asset_variants_tenant_asset_idx
  ON asset_variants (tenant_id, asset_id);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;

CREATE POLICY assets_select_current_tenant
  ON assets
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY assets_insert_current_tenant
  ON assets
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY assets_update_current_tenant
  ON assets
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY assets_delete_current_tenant
  ON assets
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE asset_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_variants FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_variants_select_current_tenant
  ON asset_variants
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY asset_variants_insert_current_tenant
  ON asset_variants
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY asset_variants_update_current_tenant
  ON asset_variants
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY asset_variants_delete_current_tenant
  ON asset_variants
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());
