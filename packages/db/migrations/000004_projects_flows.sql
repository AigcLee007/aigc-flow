CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS projects_tenant_deleted_idx
  ON projects (tenant_id, deleted_at);

CREATE TABLE IF NOT EXISTS flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  current_version_id uuid,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS flows_tenant_project_deleted_idx
  ON flows (tenant_id, project_id, deleted_at);

CREATE TABLE IF NOT EXISTS flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  flow_id uuid NOT NULL REFERENCES flows(id),
  version int NOT NULL,
  graph_json jsonb NOT NULL,
  compiled_graph_json jsonb NOT NULL,
  checksum text NOT NULL,
  changelog text,
  published_by uuid REFERENCES users(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version),
  UNIQUE (flow_id, checksum)
);

CREATE INDEX IF NOT EXISTS flow_versions_tenant_flow_idx
  ON flow_versions (tenant_id, flow_id);

CREATE INDEX IF NOT EXISTS flow_versions_graph_json_gin_idx
  ON flow_versions
  USING gin (graph_json);

CREATE INDEX IF NOT EXISTS flow_versions_compiled_graph_json_gin_idx
  ON flow_versions
  USING gin (compiled_graph_json);

ALTER TABLE flows
  ADD CONSTRAINT flows_current_version_id_fkey
  FOREIGN KEY (current_version_id)
  REFERENCES flow_versions(id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY projects_select_current_tenant
  ON projects
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY projects_insert_current_tenant
  ON projects
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY projects_update_current_tenant
  ON projects
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY projects_delete_current_tenant
  ON projects
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows FORCE ROW LEVEL SECURITY;

CREATE POLICY flows_select_current_tenant
  ON flows
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY flows_insert_current_tenant
  ON flows
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY flows_update_current_tenant
  ON flows
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY flows_delete_current_tenant
  ON flows
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY flow_versions_select_current_tenant
  ON flow_versions
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY flow_versions_insert_current_tenant
  ON flow_versions
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY flow_versions_update_current_tenant
  ON flow_versions
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY flow_versions_delete_current_tenant
  ON flow_versions
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());
