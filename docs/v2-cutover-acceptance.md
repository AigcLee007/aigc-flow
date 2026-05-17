# v2 Cutover Acceptance

This document is the final acceptance summary for the AIGC-Flow v2 backend
cutover. It records what was delivered across PR-01 to PR-17, what the current
production entry is, how to operate the remaining legacy fallback safely, and
what maintenance work is still reasonable after the mainline rebuild.

For day-to-day setup and endpoint details, also see
[docs/v2-local-development.md](/D:/flow/docs/v2-local-development.md).

## 1. Completed v2 Scope

The v2 rebuild is complete on the mainline path.

The production backend now centers on:

- `apps/api` for the Fastify API service
- `apps/worker` for BullMQ-backed workflow execution
- PostgreSQL as the source of truth
- Redis for queues and short-lived infrastructure concerns
- S3-compatible object storage for production binary assets
- AI Gateway for provider access
- encrypted credential storage
- tenant-aware RLS-backed data access
- workflow run persistence and backend execution
- billing usage recording and ledger settlement
- audit logging and basic observability

The legacy runtime remains in the repository only as an explicit fallback and
migration-support path.

## 2. PR-01 to PR-17 Summary

### PR-01 v2 monorepo skeleton and local infra

- Added the `apps/*` and `packages/*` v2 structure
- Added local infra support for PostgreSQL, Redis, and MinIO
- Established the v2 workspace layout without breaking legacy runtime

### PR-02 PostgreSQL migration runner

- Added the PostgreSQL migration runner under `packages/db`
- Standardized raw SQL migrations and migration recording

### PR-03 IAM / Tenant / RLS

- Added v2 tenant, membership, roles, permissions, and RLS foundations
- Established tenant-aware database access patterns

### PR-04 Auth v2 / RequestContext / Permission Resolver

- Added v2 auth endpoints and JWT access-token flow
- Added request context parsing and permission resolution

### PR-05 Projects / Flows / Flow Versions / workflow-core compiler

- Added v2 project, flow, and version persistence
- Added immutable compiled flow-version publishing workflow
- Introduced `workflow-core` compiler and graph validation

### PR-06 Assets metadata + S3-compatible storage foundation

- Added v2 asset metadata tables and RLS
- Added S3-compatible storage provider and presigned upload/download flow

### PR-07 AI Gateway schema + Credential Vault

- Added AI provider, model, route, and credential schema
- Added encrypted credential vault and masked-secret API responses

### PR-08 AI Gateway text runtime

- Added text-generation runtime path through AI Gateway
- Added provider adapter dispatch, route resolution, and normalized errors

### PR-09 Redis / BullMQ worker base

- Added shared Redis package and BullMQ queue wiring
- Added the first worker runtime skeleton and queue health support

### PR-10 Workflow Runs minimal backend execution loop

- Added `workflow_runs`, `node_runs`, and `workflow_run_events`
- Added the first backend workflow execution loop for simple node types

### PR-11 Workflow Run Events SSE streaming

- Added run event replay and SSE streaming
- Added resume support through `afterSequence` / `Last-Event-ID`

### PR-12 Image / Video node backend execution foundation

- Moved image/video execution into backend workers
- Added provider polling and S3-backed media output ingestion

### PR-13 Billing v2 with usage events and idempotent ledger

- Added `billing_accounts`, `usage_events`, and `billing_ledger`
- Added retry-safe usage recording and append-only ledger settlement

### PR-14 Frontend cutover to v2 workflow run API

- Cut production run actions over to the v2 workflow run API
- Stopped treating the frontend `graphExecutor` as the intended production path

### PR-15 Legacy data migration scripts

- Added dry-run, checkpoint, and resume-capable migration tooling
- Added migration support for legacy flow projects and local generated assets

### PR-16 Audit logs and observability

- Added `audit_logs`
- Added audit coverage for key auth, AI, workflow, asset, and billing actions
- Added structured logging, trace propagation, and admin health/metrics endpoints

### PR-17 Remove legacy production entry and old runtime stores

- Switched default production entry to v2 API + worker
- Renamed legacy startup scripts to explicit fallback names
- Added legacy-runtime guardrails and cut default production path away from
  `server.cjs`

## 3. Current Production Entry

The current default production entry is v2:

- `npm start`
- `npm run start:v2`

These map to:

- `npm run start:api`
- `npm run start:worker`

The actual runtime services are:

- `apps/api`
- `apps/worker`

Legacy `server.cjs` is no longer the default production entry.

## 4. Legacy Fallback

Legacy fallback remains available only for explicit operator use.

Available commands:

- `npm run legacy:server`
- `npm run legacy:start`

Production guardrail:

- when `NODE_ENV=production` and `ALLOW_LEGACY_SERVER !== "true"`, `server.cjs`
  refuses to start

Recommended usage:

- rollback drills
- migration compatibility checks
- short-lived emergency fallback only

Not recommended:

- continuing normal production operation on the legacy stack

## 5. Local Startup

Minimal local v2 flow:

1. Install dependencies with `npm install`
2. Start infra with `npm run dev:infra`
3. Configure environment variables such as `DATABASE_URL`, `REDIS_URL`,
   `S3_*`, `JWT_*`, and `CREDENTIAL_MASTER_KEY`
4. Run migrations with `npm run db:migrate`
5. Start the API with `npm run dev:api`
6. Start the worker with `npm run dev:worker`

Optional production-style local entry:

- `npm run start:v2`

For fuller local details, see
[docs/v2-local-development.md](/D:/flow/docs/v2-local-development.md).

## 6. Production Deployment Recommendation

Recommended runtime model:

- run `apps/api` and `apps/worker` as the production services
- use PostgreSQL as the only source of truth for business state
- use Redis only for queue/cache/lock/pubsub concerns
- use S3-compatible object storage for binary assets

Operational recommendation:

- prefer separate API and worker processes even if a combined root entry exists
- run migrations before promoting new application versions
- keep object storage private and use short-lived presigned URLs

Avoid:

- making `server.cjs` the normal production path again
- restoring old MySQL or file-backed runtime stores as first-class production
  dependencies

## 7. Required Environment Variables

Core runtime variables:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `CREDENTIAL_MASTER_KEY`

S3-compatible storage variables:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`

Useful worker / queue variables:

- `QUEUE_PREFIX`
- `WORKER_CONCURRENCY`

Optional but operationally relevant:

- `HOST`
- `PORT`
- `CREDENTIAL_KEY_VERSION`

Legacy fallback variable:

- `ALLOW_LEGACY_SERVER=true` only when an explicit production fallback to
  `server.cjs` is required

## 8. PostgreSQL / Redis / S3 / Credential Key Checklist

### PostgreSQL

- reachable from API and worker
- migrations applied
- tenant-scoped tables protected by RLS
- used as the source of truth for auth, projects, workflows, assets metadata,
  billing, and audit state

### Redis

- reachable from API and worker
- used by BullMQ queues
- not used as durable business state

### S3-compatible storage

- bucket exists
- bucket remains private
- API and worker share the same storage configuration
- generated assets and uploads land here rather than local disk

### Credential master key

- `CREDENTIAL_MASTER_KEY` is present
- key is a base64-encoded 32-byte key
- production startup should fail if it is missing

## 9. Data Migration Dry-Run / Resume

The PR-15 migration scripts remain available for legacy-to-v2 migration work.

Use cases:

- dry-run legacy inventory
- resumable migration runs
- local generated asset migration into S3-compatible storage

Important notes:

- dry-run should be used before a real migration
- checkpoint/resume state allows retrying without restarting all work
- migration tooling is retained for compatibility and backfill support, not as a
  normal runtime path

See:

- `npm run migrate:legacy:v2:dry-run`
- `npm run migrate:legacy:v2`
- `scripts/migrate-legacy-v2/README.md`

## 10. Pre-Deployment Checklist

- dependencies installed cleanly
- `npm run build` passes
- `npm test` passes
- required workspace builds pass
- `npm run db:migrate` completes successfully
- PostgreSQL is reachable
- Redis is reachable
- S3-compatible storage is reachable
- credential master key is present
- API and worker environment variables are aligned
- legacy runtime is not being used as the default production entry

## 11. Rollback Plan

Preferred rollback order:

1. Stop or drain the failing v2 rollout
2. Preserve PostgreSQL, Redis, and S3 state
3. If a temporary legacy fallback is required, start:
   - `npm run legacy:server`
   - or `npm run legacy:start`
4. For production fallback, explicitly set:
   - `ALLOW_LEGACY_SERVER=true`
5. Treat legacy fallback as temporary and return to v2 as soon as possible

Rollback warning:

- legacy fallback should not become the restored steady-state production path

## 12. Known Limits

- root `npm run build` still represents the frontend build, not a full combined
  backend artifact pipeline
- root `npm test` still skips some database-backed integration suites under the
  root test aggregation; targeted workspace tests remain the authoritative
  checks for those packages
- the repository still retains legacy runtime files for migration and fallback
  purposes
- a combined `start:v2` entry exists, but many production environments may
  still prefer separate API and worker process supervision
- legacy documentation still exists in the repository and should be read in
  context

## 13. Suggested Maintenance Tasks

Reasonable post-cutover maintenance work includes:

- split API and worker into distinct deployment images or services if operations
  need stronger isolation
- keep legacy deployment docs clearly labeled to avoid confusing new operators
- consider moving legacy runtime files into a dedicated `legacy/` area when safe
- continue tightening CI so targeted workspace integration suites are always run
  in the right environments
- periodically rehearse migration and rollback procedures

The v2 mainline rebuild itself is complete; follow-up work should now be
maintenance, operations hardening, and documentation hygiene rather than
another broad rewrite phase.
