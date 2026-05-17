CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  flow_id uuid NOT NULL REFERENCES flows(id),
  flow_version_id uuid NOT NULL REFERENCES flow_versions(id),
  status text NOT NULL DEFAULT 'pending',
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  error_json jsonb,
  idempotency_key text,
  created_by uuid REFERENCES users(id),
  started_at timestamptz,
  finished_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS node_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb,
  error_json jsonb,
  provider_task_id text,
  cost_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, node_id)
);

CREATE TABLE IF NOT EXISTS workflow_run_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_run_id uuid REFERENCES node_runs(id),
  event_type text NOT NULL,
  sequence int NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_created_at
  ON workflow_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_status
  ON workflow_runs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_node_runs_tenant_workflow_run
  ON node_runs (tenant_id, workflow_run_id);

CREATE INDEX IF NOT EXISTS idx_node_runs_tenant_status_workflow_run
  ON node_runs (tenant_id, status, workflow_run_id);

CREATE INDEX IF NOT EXISTS idx_workflow_run_events_tenant_run_sequence
  ON workflow_run_events (tenant_id, workflow_run_id, sequence);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_runs_select_current_tenant
  ON workflow_runs
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY workflow_runs_insert_current_tenant
  ON workflow_runs
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY workflow_runs_update_current_tenant
  ON workflow_runs
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY workflow_runs_delete_current_tenant
  ON workflow_runs
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE node_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY node_runs_select_current_tenant
  ON node_runs
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY node_runs_insert_current_tenant
  ON node_runs
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY node_runs_update_current_tenant
  ON node_runs
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY node_runs_delete_current_tenant
  ON node_runs
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE workflow_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_events FORCE ROW LEVEL SECURITY;

CREATE POLICY workflow_run_events_select_current_tenant
  ON workflow_run_events
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY workflow_run_events_insert_current_tenant
  ON workflow_run_events
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY workflow_run_events_update_current_tenant
  ON workflow_run_events
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY workflow_run_events_delete_current_tenant
  ON workflow_run_events
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());
