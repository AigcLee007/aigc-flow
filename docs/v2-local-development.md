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
- `GET /api/v2/workflow-runs/:runId/stream`
- `POST /api/v2/workflow-runs/:runId/cancel`
- `GET /api/v2/billing/summary`
- `GET /api/v2/billing/usage-events`
- `GET /api/v2/billing/ledger`

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

## PR-11 workflow run SSE streaming

PR-11 adds the first workflow run SSE endpoint:

- `GET /api/v2/workflow-runs/:runId/stream`
- event replay sourced from `workflow_run_events`
- resume support via `afterSequence` or `Last-Event-ID`
- keepalive comments for long-lived clients

Current PR-11 behavior:

- `afterSequence` takes priority when both cursor sources are present
- if `afterSequence` is absent, the API falls back to `Last-Event-ID`
- the stream replays historical events first and then polls PostgreSQL for new ones
- the implementation releases database resources after each poll and does not hold a transaction open for the life of the connection

Current PR-11 limits:

- this phase uses PostgreSQL polling rather than Redis pub/sub
- frontend stream wiring is not implemented yet
- image/video execution remains deferred to PR-12
- billing remains out of scope

## PR-12 image/video backend execution foundation

PR-12 extends the backend workflow runner with the first media node execution
path:

- `image.generate`
- `video.generate`
- `provider.poll`
- workflow media outputs persisted to S3-compatible storage plus `assets`
  metadata rows
- `node_runs.output_json` storing `AssetRef` objects only for completed media
  nodes
- async provider task state stored as lightweight provider-task metadata only

Current PR-12 behavior:

- `image.generate` and `video.generate` run in the backend worker, not the
  browser
- synchronous provider results may return a URL or base64 payload; the worker
  downloads or decodes the binary, uploads it to S3-compatible storage, and
  writes an `assets` row with `status=available`
- asynchronous provider results return a `providerTaskId`; the node transitions
  to `waiting_provider` and the worker enqueues `provider.poll` with ID-only job
  payloads
- `provider.poll` re-enqueues itself with a simple delay while the provider task
  is still `pending` or `running`
- when polling succeeds, the worker persists the final media output to
  S3-compatible storage, updates `node_runs.output_json` to `{ "assets": [...] }`,
  and unlocks downstream nodes
- `node_runs.output_json` does not store base64 payloads, binary blobs, or raw
  provider responses

Current PR-12 limits:

- billing is still not implemented
- frontend cutover is still deferred
- tests use mock runtimes, mock HTTP, and fake storage providers; no real
  external provider is required
- provider polling uses a minimal fixed delay rather than complex retry/backoff
- no real OpenAI, Gemini, or third-party provider calls are used in normal
  tests

## PR-13 billing v2 foundation

PR-13 adds the first v2 billing state and retry-safe usage recording:

- `000008_billing.sql`
- `billing_accounts`
- `usage_events`
- `billing_ledger`
- idempotent `tenant_id + idempotency_key` handling for usage events and ledger
  entries
- backend worker usage recording for:
  - `text.generate`
  - `image.generate`
  - `video.generate`
- billing API read endpoints:
  - `GET /api/v2/billing/summary`
  - `GET /api/v2/billing/usage-events`
  - `GET /api/v2/billing/ledger`

Current PR-13 behavior:

- the worker records one `usage_events` row per successful node execution using:
  - `usage:{tenantId}:{workflowRunId}:{nodeRunId}:text`
  - `usage:{tenantId}:{workflowRunId}:{nodeRunId}:image`
  - `usage:{tenantId}:{workflowRunId}:{nodeRunId}:video`
- async media tasks only record usage when `provider.poll` reaches the final
  `succeeded` state
- worker retries and repeated provider polling do not duplicate `usage_events`
  or `billing_ledger` rows because both use tenant-scoped idempotency keys
- this phase writes a zero-amount `settle` ledger entry for each recorded usage
  event so the ledger path is exercised without introducing a real pricing
  engine yet
- PostgreSQL remains the only source of truth for account, usage, and ledger
  state

Current PR-13 limits:

- no real payment provider is connected yet
- no Stripe, Paddle, PayPal, or invoice flow exists yet
- no frontend billing cutover exists yet
- no pricing admin backend or quota engine exists yet

## PR-14 frontend cutover to the v2 workflow run API

PR-14 adds the first frontend production-path cutover for workflow execution:

- the frontend production run path now targets:
  - `POST /api/v2/flows/:flowId/runs`
  - `GET /api/v2/workflow-runs/:runId`
  - `GET /api/v2/workflow-runs/:runId/events`
  - `GET /api/v2/workflow-runs/:runId/stream`
  - `GET /api/v2/assets/:assetId/download-url`
- `graphExecutor` remains in the repo as a legacy / local-preview helper and is
  no longer the intended production execution path
- the frontend runtime now keeps backend run state separately from the editable
  canvas snapshot so short-lived asset download URLs are not persisted as authoring data

Current PR-14 behavior:

- the flow canvas can store a backend binding for:
  - `backendProjectId`
  - `backendFlowId`
  - `backendCurrentVersionId`
- the current page also accepts the same values from query parameters, for example:
  - `?backendProjectId=<uuid>&backendFlowId=<uuid>&backendCurrentVersionId=<uuid>`
- when the user clicks a production run action on a text / image / video node,
  the frontend:
  - starts a backend workflow run for the bound `backendFlowId`
  - opens the workflow run stream
  - updates runtime node status from backend events
  - fetches the final workflow run snapshot
  - resolves `AssetRef` outputs through short-lived download URLs
- if the canvas is not bound to a backend flow, the frontend now shows a clear
  error instead of silently falling back to local production execution

How to use the PR-14 frontend path:

1. Log in with a v2 access token available to the browser runtime.
2. Open a flow canvas that is already bound to a published backend flow.
3. Trigger a production run from the flow canvas.
4. The frontend creates a workflow run, streams node events, and renders final
   text / image / video outputs from workflow run state and asset download URLs.

Current PR-14 limits:

- this phase does not add billing UI
- this phase does not add credential management UI
- this phase does not add a full asset manager UI
- this phase does not migrate legacy data
- this phase does not remove legacy runtime code
- this phase does not delete `graphExecutor`
- this phase does not attempt to publish the current local TapNow canvas graph
  as a backend workflow automatically
- if the current canvas does not have a stable backend `flowId` binding, the
  frontend refuses the production run and asks for a bound published flow first

## PR-15 legacy migration scripts

PR-15 adds the first reusable legacy-to-v2 migration script framework:

- `scripts/migrate-legacy-v2/migrate.ts`
- `scripts/migrate-legacy-v2/legacy-readers.ts`
- `scripts/migrate-legacy-v2/v2-writers.ts`
- `scripts/migrate-legacy-v2/asset-migrator.ts`
- `scripts/migrate-legacy-v2/checkpoint-store.ts`
- `scripts/migrate-legacy-v2/mapping.ts`
- `scripts/migrate-legacy-v2/README.md`

Current PR-15 behavior:

- legacy `flow_projects` style canvas data can be read from:
  - JSON fallback files such as `flow_projects.local.json`
  - legacy MySQL when the old `MYSQL_*` environment is configured
- each legacy flow-project record is treated as:
  - one migrated v2 `projects` row
  - one migrated v2 `flows` row
  - one migrated v2 `flow_versions` row when the graph compiles successfully
- migrated graphs are validated and compiled with `workflow-core`
- invalid graphs are reported as migration errors and do not crash the entire batch
- local generated assets under the legacy `storage/generated/line4/original` tree can be migrated into:
  - S3-compatible object storage
  - v2 `assets` metadata rows
- auth migration is metadata-only in this phase:
  - user metadata is inventoried
  - passwords are not migrated
  - sessions are not migrated
- billing migration is summary-only in this phase:
  - legacy billing counts and balances can be reported
  - no v2 `billing_ledger` rows are written by PR-15

How to use the PR-15 migration scripts:

1. Start PostgreSQL, Redis, and MinIO when you plan to do a real migration run.
2. Run a dry-run first:

```bash
npm run migrate:legacy:v2:dry-run -- --tenant-id 00000000-0000-0000-0000-000000000001 --legacy-source ./scripts/migrate-legacy-v2/fixtures --report ./scripts/migrate-legacy-v2/reports/dry-run.json
```

3. Review the generated report for:
   - planned project / flow / asset counts
   - graph compile errors
   - missing asset warnings
   - auth and billing manual follow-up notes
4. For a real migration, run:

```bash
npm run migrate:legacy:v2 -- --tenant-id <tenant-id> --user-id <existing-v2-user-id> --legacy-source ./storage --resume --report ./scripts/migrate-legacy-v2/reports/migration.json
```

Checkpoint and resume notes:

- state is stored in `scripts/migrate-legacy-v2/.migration-state.json`
- `--resume` skips already completed project and asset items
- reports can be written to `scripts/migrate-legacy-v2/reports/*.json`
- the checkpoint file and generated reports are gitignored

Asset migration notes:

- migrated assets are uploaded into S3-compatible object storage
- the database stores metadata plus `object_key`, not file content
- migrated asset URLs are not treated as permanent public URLs
- missing legacy asset files are reported as warnings instead of failing the whole batch

Current PR-15 limits:

- PR-15 does not delete or rewire legacy runtime code
- PR-15 does not change `server.cjs`
- PR-15 does not migrate plaintext passwords
- PR-15 does not migrate legacy sessions
- PR-15 does not write billing reconciliation rows into `billing_ledger`
- PR-15 does not remove legacy MySQL / JSON / local-storage paths
- PR-17 remains the phase for legacy runtime removal

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
$env:S3_ENDPOINT="http://localhost:9000"
$env:S3_REGION="us-east-1"
$env:S3_BUCKET="aigc-flow-dev"
$env:S3_ACCESS_KEY_ID="minio"
$env:S3_SECRET_ACCESS_KEY="minio123456"
$env:S3_FORCE_PATH_STYLE="true"
```

Rules:

- production startup now requires `REDIS_URL`
- development defaults to `redis://localhost:6379`
- queue payloads are ID-only and must stay lightweight
- Redis remains queue / lock / rate-limit / pubsub infrastructure only, not the
  source of truth
- PR-12 also requires the worker to have the same S3 configuration as the API
  because backend media execution now writes generated outputs into object
  storage

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
- `000008_billing.sql`

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

`000008_billing.sql` adds the first billing v2 tables:

- `billing_accounts`
- `usage_events`
- `billing_ledger`

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
- workflow run SSE replay and resume behavior
- billing summary auth and tenant isolation
- billing usage-event list auth and tenant isolation
- billing ledger list auth and tenant isolation
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
