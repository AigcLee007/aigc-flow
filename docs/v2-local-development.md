# v2 Local Development

This document covers the current v2 bootstrap work. The legacy runtime still
exists in parallel, and the v2 services are being introduced phase by phase.

## Start local infrastructure

```bash
npm run dev:infra
```

This starts local development containers for:

- PostgreSQL
- Redis
- MinIO

The compose file lives at `infra/docker-compose.dev.yml`.

## Start the v2 API

```bash
npm run dev:api
```

The current Fastify v2 service exposes:

- `GET /health`
- `POST /api/v2/auth/register`
- `POST /api/v2/auth/login`
- `POST /api/v2/auth/refresh`
- `POST /api/v2/auth/logout`
- `GET /api/v2/auth/me`
- `GET /api/v2/projects`
- `POST /api/v2/projects`
- `GET /api/v2/projects/:projectId`
- `PATCH /api/v2/projects/:projectId`
- `DELETE /api/v2/projects/:projectId`
- `GET /api/v2/projects/:projectId/flows`
- `POST /api/v2/projects/:projectId/flows`
- `GET /api/v2/flows/:flowId`
- `PATCH /api/v2/flows/:flowId`
- `POST /api/v2/flows/:flowId/publish`
- `GET /api/v2/flows/:flowId/versions`
- `POST /api/v2/assets/presigned-upload`
- `POST /api/v2/assets/:assetId/complete-upload`
- `GET /api/v2/assets/:assetId`
- `GET /api/v2/assets/:assetId/download-url`
- `DELETE /api/v2/assets/:assetId`

By default it listens on `http://localhost:3366`.

## Start the v2 worker skeleton

```bash
npm run dev:worker
```

The worker only boots and prints a ready message in PR-01/PR-02. It does not
connect to Redis or consume queues yet.

## Configure `DATABASE_URL`

Copy `.env.v2.example` or export the variable directly before running
migrations:

```bash
set DATABASE_URL=postgres://aigc_flow:aigc_flow_dev@localhost:5432/aigc_flow
```

PowerShell:

```powershell
$env:DATABASE_URL="postgres://aigc_flow:aigc_flow_dev@localhost:5432/aigc_flow"
```

## Configure `JWT_ACCESS_SECRET`

PR-04 adds JWT-based access tokens for the v2 auth API.

PowerShell:

```powershell
$env:JWT_ACCESS_SECRET="dev_access_secret_change_me"
$env:JWT_REFRESH_SECRET="dev_refresh_secret_change_me"
```

In production, `JWT_ACCESS_SECRET` must be present or the v2 API will fail to
start. `JWT_REFRESH_SECRET` remains in the environment contract even though
refresh tokens are currently random database-backed tokens rather than JWTs.

## Configure S3 / MinIO asset storage

PR-06 adds the first v2 asset storage foundation:

- PostgreSQL `assets` and `asset_variants` metadata tables
- tenant-scoped RLS on both asset tables
- S3-compatible storage provider in `packages/storage`
- presigned upload and download APIs in `apps/api`

The current PR-06 scope is limited to uploaded assets. It does not yet connect
AI-generated outputs, workflow runs, or worker asset ingestion.

PowerShell:

```powershell
$env:S3_ENDPOINT="http://localhost:9000"
$env:S3_REGION="us-east-1"
$env:S3_BUCKET="aigc-flow-dev"
$env:S3_ACCESS_KEY_ID="minio"
$env:S3_SECRET_ACCESS_KEY="minio123456"
$env:S3_FORCE_PATH_STYLE="true"
```

Development defaults:

- `S3_ENDPOINT=http://localhost:9000`
- `S3_REGION=us-east-1`
- `S3_BUCKET=aigc-flow-dev`
- `S3_ACCESS_KEY_ID=minio`
- `S3_SECRET_ACCESS_KEY=minio123456`
- `S3_FORCE_PATH_STYLE=true`

Production startup now requires all of the S3 variables above. The v2 API will
fail fast if any required S3 configuration is missing.

## MinIO startup notes

`npm run dev:infra` starts MinIO with:

- API endpoint: `http://localhost:9000`
- Console: `http://localhost:9001`
- Access key: `minio`
- Secret key: `minio123456`

Before using the PR-06 asset APIs, create the configured bucket if it does not
already exist. With the MinIO UI, sign in at `http://localhost:9001` and create
the `aigc-flow-dev` bucket. Keep the bucket private.

## Run the PostgreSQL migrations

```bash
npm run db:migrate
```

PR-02 and PR-03 introduce the real PostgreSQL migration and IAM foundation in
`packages/db`.

Current scope:

- creates `schema_migrations` automatically if missing
- runs SQL files from `packages/db/migrations` in filename order
- records successful executions
- skips migrations that are already recorded

Current migrations:

- `000001_extensions.sql`
- `000002_iam.sql`
- `000003_auth.sql`
- `000004_projects_flows.sql`
- `000005_assets.sql`

`000001_extensions.sql` installs:

- `pgcrypto`
- `citext`

`000002_iam.sql` adds the v2 IAM / tenant schema foundation:

- `users`
- `tenants`
- `tenant_memberships`
- `roles`
- `permissions`
- `role_permissions`

`000003_auth.sql` adds the current auth persistence layer:

- `auth_sessions`
- `refresh_tokens`

`000004_projects_flows.sql` adds the current project and flow model:

- `projects`
- `flows`
- `flow_versions`

`000005_assets.sql` adds the current uploaded asset model:

- `assets`
- `asset_variants`

PR-03 and PR-04 also introduce PostgreSQL helper functions for request context
and the current base RLS policies for tenant-scoped tables.

PR-05 keeps runtime execution tables such as `workflow_runs` and `node_runs`
deferred. This phase only introduces authoring-time flow metadata, versioning,
and compiled graph persistence.

PR-06 also keeps `workflow_run_id` and `node_run_id` as nullable placeholder
columns on `assets` without introducing workflow runtime tables yet.

## Run the `packages/db` tests

If PostgreSQL is running and `DATABASE_URL` points at it, you can run:

```bash
npm run test --workspace @aigc-flow/db
```

The database tests create isolated temporary databases, run migrations, and
verify:

- migration execution and idempotency
- IAM schema creation and seed data
- RLS isolation behavior
- `withTenantTransaction`
- auth-related RLS visibility for tenant lists
- projects / flows / flow_versions migrations
- tenant RLS isolation for projects / flows / flow_versions
- assets / asset_variants migrations
- tenant RLS isolation for assets / asset_variants

## Run the `apps/api` auth tests

If PostgreSQL is running and `DATABASE_URL` points at it, you can run:

```bash
npm run test --workspace @aigc-flow/api
```

The auth tests exercise:

- `register`
- `login`
- `refresh`
- `logout`
- `me`
- permission resolution
- request context parsing

PR-05 also adds project / flow API tests:

```bash
npm run test --workspace @aigc-flow/api
```

These cover:

- project creation permissions
- flow creation
- flow publish and version history
- cyclic graph rejection
- tenant isolation for projects / flows / versions
- asset presigned upload permissions
- complete-upload object HEAD verification
- asset metadata reads without permanent public URLs
- tenant isolation for asset metadata and download URLs
- soft-deleted assets refusing download URLs

You can also run the standalone workflow compiler tests:

```bash
npm run test --workspace @aigc-flow/workflow-core
```

For the storage package itself:

```bash
npm run build --workspace @aigc-flow/storage
npm run test --workspace @aigc-flow/storage
```

## Tenant-scoped database access

PR-03 adds:

- `app.current_tenant_id()`
- `app.current_user_id()`
- `withTenantTransaction(ctx, fn)`

PR-04 extends this with request-time auth context in `apps/api`. RLS-protected
queries depend on `app.tenant_id` and `app.user_id` being set for the current
transaction. The `withTenantTransaction` helper is the intended entry point for
API services that access tenant-scoped v2 tables with a concrete tenant
selection. PR-04 also adds auth flows that temporarily set `app.user_id`
without a tenant so the current user can list their own tenant memberships.

Current hardening note:

- PR-03 establishes the base RLS policies and uses `FORCE ROW LEVEL SECURITY`
  on the initial tenant-scoped tables so tests do not accidentally bypass RLS
  through the table owner.

PR-05 extends that same RLS pattern to:

- `projects`
- `flows`
- `flow_versions`

PR-06 extends the same RLS pattern to:

- `assets`
- `asset_variants`

## Try the Auth v2 API

Register:

```bash
curl -X POST http://localhost:3366/api/v2/auth/register ^
  -H "content-type: application/json" ^
  -d "{\"email\":\"alice@example.com\",\"password\":\"StrongPass123!\",\"tenantName\":\"Alice Tenant\"}"
```

Login:

```bash
curl -X POST http://localhost:3366/api/v2/auth/login ^
  -H "content-type: application/json" ^
  -d "{\"email\":\"alice@example.com\",\"password\":\"StrongPass123!\"}"
```

Get the current user:

```bash
curl http://localhost:3366/api/v2/auth/me ^
  -H "authorization: Bearer <access-token>"
```

Create a project:

```bash
curl -X POST http://localhost:3366/api/v2/projects ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"name\":\"Demo Project\",\"description\":\"Compiler demo\"}"
```

Create a flow:

```bash
curl -X POST http://localhost:3366/api/v2/projects/<project-id>/flows ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"title\":\"Demo Flow\",\"description\":\"First draft\"}"
```

Publish a flow version:

```bash
curl -X POST http://localhost:3366/api/v2/flows/<flow-id>/publish ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"graph\":{\"nodes\":[{\"id\":\"input\",\"type\":\"input\"},{\"id\":\"output\",\"type\":\"output\"}],\"edges\":[{\"source\":\"input\",\"target\":\"output\"}]}}"
```

Publish stores:

- the original `graph_json`
- the compiled `compiled_graph_json`
- a stable `checksum`
- an immutable `flow_versions` row

When the same flow is published with an unchanged checksum, PR-05 reuses the
existing version instead of creating a duplicate row.

Current auth storage note:

- PR-04 keeps refresh tokens in PostgreSQL.
- The database stores only `token_hash`, never the refresh token plaintext.
- Redis session/cache integration is intentionally deferred to a later PR.

## Try the PR-06 asset API

Create a presigned upload:

```bash
curl -X POST http://localhost:3366/api/v2/assets/presigned-upload ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"kind\":\"image\",\"mimeType\":\"image/png\",\"originalFilename\":\"demo.png\",\"sizeBytes\":12345}"
```

The API returns:

- an `asset` metadata row with `status=uploading`
- a short-lived presigned `PUT` upload URL
- required request headers such as `content-type` when applicable

After the client uploads to MinIO/S3, mark the asset as available:

```bash
curl -X POST http://localhost:3366/api/v2/assets/<asset-id>/complete-upload ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{}"
```

Fetch metadata:

```bash
curl http://localhost:3366/api/v2/assets/<asset-id> ^
  -H "authorization: Bearer <access-token>"
```

Request a short-lived download URL:

```bash
curl http://localhost:3366/api/v2/assets/<asset-id>/download-url ^
  -H "authorization: Bearer <access-token>"
```

PR-06 does not expose permanent public URLs and does not route through the
legacy generated asset service.
