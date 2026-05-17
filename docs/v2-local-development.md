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
- `GET /api/v2/admin/ai/providers`
- `POST /api/v2/admin/ai/providers`
- `GET /api/v2/admin/ai/models`
- `POST /api/v2/admin/ai/models`
- `GET /api/v2/admin/ai/routes`
- `POST /api/v2/admin/ai/routes`
- `PATCH /api/v2/admin/ai/routes/:routeId`
- `GET /api/v2/admin/credentials`
- `POST /api/v2/admin/credentials`
- `PATCH /api/v2/admin/credentials/:credentialId`
- `POST /api/v2/admin/credentials/:credentialId/rotate`
- `DELETE /api/v2/admin/credentials/:credentialId`
- `POST /api/v2/ai/text/generate`
- `GET /api/v2/admin/queues/health`
- `POST /api/v2/flows/:flowId/runs`
- `GET /api/v2/workflow-runs/:runId`
- `GET /api/v2/workflow-runs/:runId/events`
- `POST /api/v2/workflow-runs/:runId/cancel`

By default it listens on `http://localhost:3366`.

## Start the v2 worker skeleton

```bash
npm run dev:worker
```

PR-09 upgrades the worker from a boot-only placeholder to the first Redis /
BullMQ skeleton:

- Redis connection bootstrapping from `REDIS_URL`
- queue registration for:
  - `workflow.start`
  - `node.execute`
  - `provider.poll`
  - `asset.ingest`
  - `billing.settle`
- processor skeletons that only log and return no-op results
- graceful shutdown on `SIGINT` / `SIGTERM`

Current PR-09 limits:

- no `workflow_runs`
- no `node_runs`
- no workflow engine execution
- no AI Gateway runtime calls from workers
- no real provider polling
- no real asset ingest
- no real billing settlement

## PR-10 workflow run minimal loop

PR-10 upgrades the worker and API from queue skeletons to the first minimal
backend workflow execution loop:

- `000007_workflow_runs.sql`
- PostgreSQL `workflow_runs`, `node_runs`, and `workflow_run_events`
- `POST /api/v2/flows/:flowId/runs`
- `GET /api/v2/workflow-runs/:runId`
- `GET /api/v2/workflow-runs/:runId/events`
- `POST /api/v2/workflow-runs/:runId/cancel`
- backend worker execution for `input`, `text.generate`, and `output`
- PostgreSQL-backed workflow state transitions and event sequencing

Current PR-10 limits:

- only `input`, `text.generate`, and `output` nodes are supported
- SSE / realtime event streaming is deferred to PR-11
- image and video execution are deferred to PR-12
- billing reserve / settle / refund are not implemented yet
- provider polling remains a later phase
- worker retries stay minimal in this phase

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

## Configure Redis / BullMQ

PR-09 adds the first shared Redis package and queue infrastructure for the v2
worker and admin queue health API.

PowerShell:

```powershell
$env:REDIS_URL="redis://localhost:6379"
$env:QUEUE_PREFIX="aigc-flow:v2"
$env:WORKER_CONCURRENCY="2"
```

Rules:

- production startup now requires `REDIS_URL`
- development defaults to `redis://localhost:6379`
- queue payloads are ID-only and must stay lightweight
- Redis remains queue / lock / rate-limit / pubsub infrastructure only, not the
  source of truth

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

## Configure the Credential Vault

PR-07 adds the first AI Gateway schema and the encrypted credential vault
foundation.

PowerShell:

```powershell
$env:CREDENTIAL_MASTER_KEY="MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
$env:CREDENTIAL_KEY_VERSION="v1"
```

Rules:

- `CREDENTIAL_MASTER_KEY` must be a base64-encoded 32-byte key
- credential secrets are encrypted with AES-256-GCM before they reach PostgreSQL
- PostgreSQL stores `encrypted_secret`, `nonce`, `auth_tag`, `key_version`, and
  a non-reversible secret fingerprint
- API responses return masked secrets only, never plaintext or raw encrypted
  fields

Development defaults now live in `.env.v2.example`. Production startup requires
`CREDENTIAL_MASTER_KEY`; the API fails fast if it is missing.

## PR-08 AI Gateway text runtime

PR-08 adds the first runtime AI Gateway path for text generation only:

- tenant-aware `RouteResolver`
- OpenAI-compatible text adapter
- credential decryption through the credential vault
- normalized provider errors
- redacted provider request / response logging
- `ai_call_logs` writes for succeeded and failed text calls

Current PR-08 limits:

- image generation is not implemented yet
- video generation is not implemented yet
- workflow / worker integration is not implemented yet
- billing settlement is not implemented yet
- AI outputs are not ingested into S3 assets in this phase

## PR-09 queue health endpoint

PR-09 adds:

- `GET /api/v2/admin/queues/health`

This endpoint:

- requires auth
- requires a tenant context
- requires `admin:system`
- returns Redis connection status plus BullMQ counts for each registered queue

The response intentionally does not expose `REDIS_URL`, credentials, or raw
connection details.

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
- `000006_ai_gateway.sql`
- `000007_workflow_runs.sql`

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

`000006_ai_gateway.sql` adds the current AI Gateway metadata and credential
schema:

- `ai_providers`
- `ai_models`
- `api_credentials`
- `ai_routes`
- `ai_call_logs`

`000007_workflow_runs.sql` adds the first backend workflow runtime tables:

- `workflow_runs`
- `node_runs`
- `workflow_run_events`

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
- ai gateway migrations
- tenant RLS isolation for credentials / routes / call logs

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
- encrypted credential creation and rotation
- masked credential responses without secret leakage
- provider / model / route admin APIs
- tenant isolation for credentials and routes
- workflow run creation
- workflow run reads with `node_runs`
- workflow run event listing with `afterSequence`
- workflow run cancel behavior

You can also run the standalone workflow compiler tests:

```bash
npm run test --workspace @aigc-flow/workflow-core
```

For the storage package itself:

```bash
npm run build --workspace @aigc-flow/storage
npm run test --workspace @aigc-flow/storage
```

For the Redis and worker packages added in PR-09:

```bash
npm run build --workspace @aigc-flow/redis
npm run test --workspace @aigc-flow/redis
npm run build --workspace @aigc-flow/worker
npm run test --workspace @aigc-flow/worker
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

PR-07 extends tenant-aware access to:

- `api_credentials`
- `ai_routes`
- `ai_call_logs`

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

## Try the PR-07 admin AI APIs

PR-07 adds the schema and admin control plane for AI Gateway configuration. It
does not execute provider calls yet; runtime provider dispatch starts in PR-08.

Create a provider:

```bash
curl -X POST http://localhost:3366/api/v2/admin/ai/providers ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"key\":\"openai\",\"name\":\"OpenAI\",\"kind\":\"openai\"}"
```

Create a model:

```bash
curl -X POST http://localhost:3366/api/v2/admin/ai/models ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"providerId\":\"<provider-id>\",\"modelKey\":\"gpt-4.1-mini\",\"displayName\":\"GPT-4.1 Mini\",\"modality\":\"text\"}"
```

Create a credential:

```bash
curl -X POST http://localhost:3366/api/v2/admin/credentials ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"providerId\":\"<provider-id>\",\"name\":\"Primary key\",\"secret\":\"sk-example-secret\"}"
```

Create a tenant route:

```bash
curl -X POST http://localhost:3366/api/v2/admin/ai/routes ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"providerId\":\"<provider-id>\",\"modelId\":\"<model-id>\",\"credentialId\":\"<credential-id>\",\"routeKey\":\"default-text\",\"modality\":\"text\"}"
```

Rotate a credential:

```bash
curl -X POST http://localhost:3366/api/v2/admin/credentials/<credential-id>/rotate ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"secret\":\"sk-rotated-secret\"}"
```

Current PR-07 scope:

- stores AI provider, model, route, and credential metadata
- encrypts provider secrets in PostgreSQL with the credential vault
- exposes masked credential admin APIs

Deferred to PR-08:

- actual provider adapters
- runtime route resolution and dispatch
- text / image / video generation calls

## Try the PR-08 text generation runtime

PR-08 adds a runtime endpoint for text generation:

```bash
curl -X POST http://localhost:3366/api/v2/ai/text/generate ^
  -H "authorization: Bearer <access-token>" ^
  -H "content-type: application/json" ^
  -d "{\"routeKey\":\"default-text\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}],\"temperature\":0.7,\"maxTokens\":100}"
```

The response shape is:

```json
{
  "status": "succeeded",
  "providerKey": "openai-compatible",
  "modelKey": "gpt-4.1-mini",
  "outputText": "hello from the mock provider",
  "usage": {
    "inputTokens": 1,
    "outputTokens": 2,
    "totalTokens": 3
  }
}
```

To configure an OpenAI-compatible route:

1. Create a provider with `kind=openai-compatible` and `defaultBaseUrl`.
2. Create a text model under that provider.
3. Create an encrypted credential through `/api/v2/admin/credentials`.
4. Create a tenant route through `/api/v2/admin/ai/routes` that references the provider, model, and credential.

Route resolution rules in PR-08:

- tenant route beats a system route with the same `routeKey`
- if `routeKey` is omitted, the gateway chooses the active text route with the lowest `priority` and highest `weight`
- only `status=active` routes are eligible

Current runtime note:

- the test suite uses mock HTTP providers only
- PR-08 does not call real OpenAI, Gemini, or other external services
