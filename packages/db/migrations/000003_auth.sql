CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id),
  status text NOT NULL DEFAULT 'active',
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
  ON auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS auth_sessions_tenant_id_idx
  ON auth_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS auth_sessions_status_expires_at_idx
  ON auth_sessions (status, expires_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  rotated_from_token_id uuid REFERENCES refresh_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS refresh_tokens_session_id_idx
  ON refresh_tokens (session_id);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx
  ON refresh_tokens (user_id);

CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
  ON refresh_tokens (expires_at);

CREATE POLICY tenant_memberships_select_current_user
  ON tenant_memberships
  FOR SELECT
  USING (user_id = app.current_user_id());

CREATE POLICY tenants_select_current_user_memberships
  ON tenants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM tenant_memberships
      WHERE tenant_memberships.tenant_id = tenants.id
        AND tenant_memberships.user_id = app.current_user_id()
        AND tenant_memberships.status = 'active'
    )
  );
