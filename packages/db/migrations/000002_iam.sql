CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE,
  display_name text,
  avatar_asset_id uuid,
  status text NOT NULL DEFAULT 'active',
  password_hash text,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext UNIQUE NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES users(id),
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  key text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_global_key_unique
  ON roles (key)
  WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS permissions (
  key text PRIMARY KEY,
  description text
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);

INSERT INTO permissions (key, description)
VALUES
  ('tenant:read', 'Read tenant metadata'),
  ('tenant:manage', 'Manage tenant settings'),
  ('member:read', 'Read tenant membership data'),
  ('member:manage', 'Manage tenant memberships'),
  ('project:read', 'Read projects'),
  ('project:create', 'Create projects'),
  ('project:update', 'Update projects'),
  ('project:delete', 'Delete projects'),
  ('flow:read', 'Read flows'),
  ('flow:create', 'Create flows'),
  ('flow:update', 'Update flows'),
  ('flow:publish', 'Publish flows'),
  ('flow:delete', 'Delete flows'),
  ('flow:run', 'Run flows'),
  ('run:read', 'Read workflow runs'),
  ('run:cancel', 'Cancel workflow runs'),
  ('asset:read', 'Read assets'),
  ('asset:create', 'Create assets'),
  ('asset:delete', 'Delete assets'),
  ('billing:read', 'Read billing information'),
  ('billing:manage', 'Manage billing settings'),
  ('provider:read', 'Read provider configuration'),
  ('provider:manage', 'Manage provider configuration'),
  ('credential:manage', 'Manage credentials'),
  ('audit:read', 'Read audit logs'),
  ('admin:system', 'Perform system administration')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description;

WITH global_roles (key, name, description) AS (
  VALUES
    ('system_admin', 'System Admin', 'Global administrator with every permission'),
    ('tenant_owner', 'Tenant Owner', 'Tenant owner with full tenant permissions'),
    ('tenant_admin', 'Tenant Admin', 'Tenant administrator'),
    ('flow_developer', 'Flow Developer', 'Builds and runs flows'),
    ('operator', 'Operator', 'Runs flows and manages operational assets'),
    ('viewer', 'Viewer', 'Read-only access to tenant resources')
)
INSERT INTO roles (tenant_id, key, name, description)
SELECT NULL, global_roles.key, global_roles.name, global_roles.description
FROM global_roles
WHERE NOT EXISTS (
  SELECT 1
  FROM roles
  WHERE roles.tenant_id IS NULL
    AND roles.key = global_roles.key
);

WITH grants (role_key, permission_key) AS (
  VALUES
    ('system_admin', 'tenant:read'),
    ('system_admin', 'tenant:manage'),
    ('system_admin', 'member:read'),
    ('system_admin', 'member:manage'),
    ('system_admin', 'project:read'),
    ('system_admin', 'project:create'),
    ('system_admin', 'project:update'),
    ('system_admin', 'project:delete'),
    ('system_admin', 'flow:read'),
    ('system_admin', 'flow:create'),
    ('system_admin', 'flow:update'),
    ('system_admin', 'flow:publish'),
    ('system_admin', 'flow:delete'),
    ('system_admin', 'flow:run'),
    ('system_admin', 'run:read'),
    ('system_admin', 'run:cancel'),
    ('system_admin', 'asset:read'),
    ('system_admin', 'asset:create'),
    ('system_admin', 'asset:delete'),
    ('system_admin', 'billing:read'),
    ('system_admin', 'billing:manage'),
    ('system_admin', 'provider:read'),
    ('system_admin', 'provider:manage'),
    ('system_admin', 'credential:manage'),
    ('system_admin', 'audit:read'),
    ('system_admin', 'admin:system'),

    ('tenant_owner', 'tenant:read'),
    ('tenant_owner', 'tenant:manage'),
    ('tenant_owner', 'member:read'),
    ('tenant_owner', 'member:manage'),
    ('tenant_owner', 'project:read'),
    ('tenant_owner', 'project:create'),
    ('tenant_owner', 'project:update'),
    ('tenant_owner', 'project:delete'),
    ('tenant_owner', 'flow:read'),
    ('tenant_owner', 'flow:create'),
    ('tenant_owner', 'flow:update'),
    ('tenant_owner', 'flow:publish'),
    ('tenant_owner', 'flow:delete'),
    ('tenant_owner', 'flow:run'),
    ('tenant_owner', 'run:read'),
    ('tenant_owner', 'run:cancel'),
    ('tenant_owner', 'asset:read'),
    ('tenant_owner', 'asset:create'),
    ('tenant_owner', 'asset:delete'),
    ('tenant_owner', 'billing:read'),
    ('tenant_owner', 'billing:manage'),
    ('tenant_owner', 'provider:read'),
    ('tenant_owner', 'provider:manage'),
    ('tenant_owner', 'credential:manage'),
    ('tenant_owner', 'audit:read'),

    ('tenant_admin', 'tenant:read'),
    ('tenant_admin', 'member:read'),
    ('tenant_admin', 'member:manage'),
    ('tenant_admin', 'project:read'),
    ('tenant_admin', 'project:create'),
    ('tenant_admin', 'project:update'),
    ('tenant_admin', 'project:delete'),
    ('tenant_admin', 'flow:read'),
    ('tenant_admin', 'flow:create'),
    ('tenant_admin', 'flow:update'),
    ('tenant_admin', 'flow:publish'),
    ('tenant_admin', 'flow:delete'),
    ('tenant_admin', 'flow:run'),
    ('tenant_admin', 'run:read'),
    ('tenant_admin', 'run:cancel'),
    ('tenant_admin', 'asset:read'),
    ('tenant_admin', 'asset:create'),
    ('tenant_admin', 'asset:delete'),
    ('tenant_admin', 'billing:read'),
    ('tenant_admin', 'provider:read'),
    ('tenant_admin', 'credential:manage'),
    ('tenant_admin', 'audit:read'),

    ('flow_developer', 'project:read'),
    ('flow_developer', 'flow:read'),
    ('flow_developer', 'flow:create'),
    ('flow_developer', 'flow:update'),
    ('flow_developer', 'flow:publish'),
    ('flow_developer', 'flow:run'),
    ('flow_developer', 'run:read'),
    ('flow_developer', 'run:cancel'),
    ('flow_developer', 'asset:read'),
    ('flow_developer', 'asset:create'),
    ('flow_developer', 'asset:delete'),
    ('flow_developer', 'provider:read'),

    ('operator', 'project:read'),
    ('operator', 'flow:read'),
    ('operator', 'flow:run'),
    ('operator', 'run:read'),
    ('operator', 'run:cancel'),
    ('operator', 'asset:read'),
    ('operator', 'asset:create'),

    ('viewer', 'project:read'),
    ('viewer', 'flow:read'),
    ('viewer', 'run:read'),
    ('viewer', 'asset:read'),
    ('viewer', 'billing:read')
)
INSERT INTO role_permissions (role_id, permission_key)
SELECT roles.id, grants.permission_key
FROM grants
JOIN roles
  ON roles.tenant_id IS NULL
 AND roles.key = grants.role_key
ON CONFLICT (role_id, permission_key) DO NOTHING;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select_current_tenant
  ON tenants
  FOR SELECT
  USING (id = app.current_tenant_id());

CREATE POLICY tenants_insert_current_tenant
  ON tenants
  FOR INSERT
  WITH CHECK (id = app.current_tenant_id());

CREATE POLICY tenants_update_current_tenant
  ON tenants
  FOR UPDATE
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

CREATE POLICY tenants_delete_current_tenant
  ON tenants
  FOR DELETE
  USING (id = app.current_tenant_id());

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_memberships_select_current_tenant
  ON tenant_memberships
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_memberships_insert_current_tenant
  ON tenant_memberships
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_memberships_update_current_tenant
  ON tenant_memberships
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_memberships_delete_current_tenant
  ON tenant_memberships
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

CREATE POLICY roles_select_visible_roles
  ON roles
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());

CREATE POLICY roles_insert_current_tenant
  ON roles
  FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY roles_update_current_tenant
  ON roles
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY roles_delete_current_tenant
  ON roles
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_select_visible_roles
  ON role_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM roles
      WHERE roles.id = role_permissions.role_id
        AND (roles.tenant_id IS NULL OR roles.tenant_id = app.current_tenant_id())
    )
  );

CREATE POLICY role_permissions_insert_current_tenant_roles
  ON role_permissions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM roles
      WHERE roles.id = role_permissions.role_id
        AND roles.tenant_id = app.current_tenant_id()
    )
  );

CREATE POLICY role_permissions_update_current_tenant_roles
  ON role_permissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM roles
      WHERE roles.id = role_permissions.role_id
        AND roles.tenant_id = app.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM roles
      WHERE roles.id = role_permissions.role_id
        AND roles.tenant_id = app.current_tenant_id()
    )
  );

CREATE POLICY role_permissions_delete_current_tenant_roles
  ON role_permissions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM roles
      WHERE roles.id = role_permissions.role_id
        AND roles.tenant_id = app.current_tenant_id()
    )
  );
