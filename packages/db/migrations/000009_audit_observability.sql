CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_user_id uuid REFERENCES users(id),
  actor_type text NOT NULL DEFAULT 'user',
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  trace_id text,
  ip_hash text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at
  ON audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action_created_at
  ON audit_logs (tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_resource
  ON audit_logs (tenant_id, resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_trace_id
  ON audit_logs (trace_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id
  ON audit_logs (request_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select_current_tenant
  ON audit_logs
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY audit_logs_insert_current_tenant
  ON audit_logs
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());
