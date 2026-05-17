# AGENTS.md

## Project Goal

This repository is being rebuilt into **aigc-flow v2**, a production-grade AIGC workflow platform.

The detailed architecture and implementation plan must be kept in:

- `docs/aigc-flow-v2-development-plan.md`

Before making any v2 architecture, backend, database, queue, storage, AI gateway, billing, workflow engine, or migration changes, read this file and the detailed development plan first.

---

## Current Direction

This project is not continuing to expand the legacy `server.cjs` architecture.

The v2 backend must use:

- **PostgreSQL** as the only source-of-truth database.
- **Redis** for queues, rate limiting, temporary cache, locks, sessions, and pub/sub.
- **S3-compatible object storage** for all production assets.
- **Fastify + TypeScript + Zod** for the API service.
- **BullMQ + Redis** for background workers.
- **PostgreSQL Row-Level Security, RLS** for tenant isolation.
- **AI Gateway** for all external and internal model provider calls.
- **Credential Vault** for encrypted API key storage and rotation.
- **Backend Workflow Runner** for production workflow execution.

The legacy frontend may remain during migration, but production workflow execution must gradually move away from the frontend `graphExecutor` and into backend workers.

---

## Target v2 Architecture

```text
apps/
  web/                         # React frontend
  api/                         # Fastify API service
  worker/                      # BullMQ worker service

packages/
  db/                          # PostgreSQL connection, migrations, repositories, RLS helpers
  redis/                       # Redis client, queues, locks, rate limits, pub/sub
  storage/                     # S3-compatible storage provider and asset helpers
  shared/                      # shared DTOs, errors, permissions, IDs
  workflow-core/               # graph validation, compiler, DAG engine, state machine
  ai-gateway-core/             # provider adapters, route resolver, credential vault

infra/
  docker-compose.dev.yml       # PostgreSQL, Redis, MinIO

docs/
  aigc-flow-v2-development-plan.md
```

---

## Non-Negotiable Hard Rules

1. Do **not** keep adding business logic to `server.cjs`.
2. Do **not** create new MySQL stores.
3. Do **not** add new JSON/file fallback storage.
4. Do **not** store generated images, videos, files, or other production assets on local disk as the production path.
5. Do **not** store base64 images, videos, or large binary payloads in PostgreSQL.
6. Do **not** put large prompts, generated media, binary files, or raw provider responses in Redis.
7. Redis must never become the final source of truth.
8. PostgreSQL must be the source of truth for business state, workflow state, billing state, and audit state.
9. S3-compatible object storage must be the source of truth for production binary assets.
10. All tenant-scoped business tables must include `tenant_id`.
11. All tenant-scoped PostgreSQL tables must enable RLS.
12. Business requests must flow through `RequestContext`.
13. Repository or service code must not bypass tenant context.
14. All external AI provider calls must go through AI Gateway.
15. API keys and provider credentials must be encrypted through Credential Vault.
16. No API may return plaintext API keys.
17. No logs may contain plaintext API keys, full authorization headers, passwords, refresh tokens, or unredacted provider secrets.
18. Workflow execution must move from frontend `graphExecutor` to backend workers.
19. Billing must be idempotent through `usage_events` and `billing_ledger`.
20. Worker retries must not double charge users.
21. S3 buckets must be private.
22. Upload and download access must use short-lived presigned URLs.
23. Each PR must be small, reviewable, and scoped to one phase.
24. Do not attempt to complete the entire v2 rebuild in one task.

---

## Preferred Technology Choices

Use these defaults unless a task explicitly says otherwise:

```text
Runtime:
- Node.js LTS
- TypeScript strict mode

API:
- Fastify
- Zod
- JWT / jose or @fastify/jwt

Database:
- PostgreSQL
- node-postgres / pg
- Kysely or typed SQL helpers
- Raw SQL migrations
- No Prisma unless explicitly approved

Redis / Queue:
- Redis
- ioredis
- BullMQ

Object Storage:
- AWS SDK v3 S3 client
- S3-compatible interface
- MinIO for local development

Testing:
- Vitest
- Testcontainers when practical
- Supertest or light-my-request for API tests

Observability:
- pino structured logs
- OpenTelemetry-ready trace IDs
- Prometheus-compatible metrics when implemented
```

---

## Working Style for Every Task

For every assigned task:

1. Read `AGENTS.md`.
2. Read `docs/aigc-flow-v2-development-plan.md`.
3. Restate the exact PR scope before coding.
4. Identify the files likely to be touched.
5. Do not modify unrelated modules.
6. Prefer adding v2 code paths instead of mutating legacy paths.
7. Keep legacy behavior unchanged unless the task explicitly requires a cutover.
8. Include tests where possible.
9. Update docs when architecture, commands, or behavior changes.
10. At the end, summarize:
    - what changed
    - files changed
    - tests run
    - commands that failed, if any
    - risks and follow-up work

---

## PR Discipline

Work phase by phase. Do not jump ahead.

Recommended PR order:

```text
PR-01  v2 monorepo skeleton and local infra
PR-02  PostgreSQL migration system
PR-03  IAM, tenant schema, and PostgreSQL RLS base
PR-04  Auth v2 and RequestContext
PR-05  Projects, flows, flow versions, and workflow-core compiler
PR-06  S3-compatible storage and assets module
PR-07  AI Gateway schema and Credential Vault
PR-08  AI Gateway runtime, starting with text generation
PR-09  Redis / BullMQ worker base
PR-10  Workflow runs minimal backend execution loop
PR-11  SSE workflow event streaming
PR-12  Image and video node execution through backend workers
PR-13  Billing v2 with usage events and idempotent ledger
PR-14  Frontend cutover to v2 workflow run API
PR-15  Legacy data migration scripts
PR-16  Audit logs and observability
PR-17  Remove legacy production entry and old runtime stores
```

When working on one PR, do not implement later PRs early.

---

## Database Rules

1. Use PostgreSQL as the only v2 production database.
2. Use migrations for all schema changes.
3. Do not create tables implicitly at runtime inside business logic.
4. Prefer UUID primary keys generated by PostgreSQL, for example `gen_random_uuid()`.
5. Use `jsonb` for workflow graphs, node configuration, provider metadata, and flexible execution payloads.
6. Do not store large binary data in PostgreSQL.
7. Every tenant-scoped table must have `tenant_id`.
8. Every tenant-scoped table must enable and force RLS where appropriate.
9. Business code must use tenant-aware transactions, such as `withTenantTransaction(ctx, fn)`.
10. Tenant context must be set with `SET LOCAL app.tenant_id` and `SET LOCAL app.user_id` inside a transaction.
11. Do not use a privileged role with `BYPASSRLS` for normal API requests.
12. Migration scripts and maintenance jobs may use a separate service role only when explicitly required.

---

## Redis Rules

Redis may be used for:

- BullMQ queues
- rate limiting
- short-lived cache
- distributed locks
- session cache
- refresh token/session lookup cache
- pub/sub for workflow event streaming

Redis must not be used for:

- final workflow state
- final billing state
- durable audit state
- large payload storage
- generated media storage
- source-of-truth business data

Queue job payloads should contain IDs only, for example:

```json
{
  "tenantId": "...",
  "workflowRunId": "...",
  "nodeRunId": "...",
  "traceId": "..."
}
```

Do not put full graphs, images, base64 strings, provider raw responses, or large prompts into Redis jobs.

---

## S3 / Asset Rules

1. Production binary assets must be stored in S3-compatible object storage.
2. Local disk is allowed only for temporary development experiments, never as the v2 production asset path.
3. Buckets must be private.
4. Do not expose permanent public object URLs by default.
5. Upload and download should use short-lived presigned URLs.
6. Database records should store metadata and object keys, not binary content.
7. Generated image/video/audio/file outputs should be represented as asset records.
8. Workflow node outputs should store `AssetRef` objects, not large media payloads.

Recommended object key format:

```text
tenants/{tenantId}/projects/{projectId}/assets/{assetId}/original.{ext}
tenants/{tenantId}/projects/{projectId}/assets/{assetId}/variants/thumb.webp
tenants/{tenantId}/runs/{runId}/nodes/{nodeRunId}/raw/request.json
tenants/{tenantId}/runs/{runId}/nodes/{nodeRunId}/raw/response.json
tenants/{tenantId}/runs/{runId}/nodes/{nodeRunId}/outputs/{assetId}.{ext}
```

---

## AI Gateway Rules

All provider calls must go through AI Gateway.

Business code must not directly call providers with code like:

```ts
await axios.post("https://provider.example.com/generate", payload)
```

Business code should call internal gateway methods such as:

```ts
await aiGateway.generateText(ctx, request)
await aiGateway.generateImage(ctx, request)
await aiGateway.generateVideo(ctx, request)
```

AI Gateway is responsible for:

- route resolution
- credential lookup and decryption
- request normalization
- provider adapter dispatch
- timeout handling
- retry handling
- fallback handling
- circuit breaker behavior
- Redis-based rate limiting
- raw request/response redaction
- usage event creation
- provider error normalization
- AI call logging

Provider credentials must be accessed only through Credential Vault.

---

## Credential Vault Rules

1. Provider API keys must never be stored in plaintext.
2. Use strong authenticated encryption, such as AES-256-GCM.
3. Production must fail to start if the credential master key or KMS config is missing.
4. GET APIs must only return masked secrets, for example `sk-****abcd`.
5. Credential creation, rotation, deletion, and use should be auditable.
6. Logs must never contain plaintext secrets.
7. Provider raw requests/responses must be redacted before storage.

---

## Workflow Runner Rules

Production workflow execution belongs in backend workers, not the browser.

The frontend may edit graphs and display state, but backend workers must own:

- graph execution
- node scheduling
- node retry
- provider polling
- long-running image/video task handling
- status persistence
- billing usage emission
- final workflow status calculation

The workflow engine should use:

- `workflow_runs`
- `node_runs`
- `workflow_run_events`

Expected node state examples:

```text
pending -> runnable -> running -> succeeded
pending -> runnable -> running -> waiting_provider -> succeeded
running -> failed
running -> canceled
pending -> skipped
```

Workflow execution must survive browser refresh, browser close, API restart, and worker retry.

---

## Billing Rules

Billing must be idempotent.

Use:

- `billing_accounts`
- `usage_events`
- `billing_ledger`

Rules:

1. Never let frontend-provided cost determine final charge.
2. Use server-side pricing rules.
3. Use idempotency keys for all billing operations.
4. Worker retries must not create duplicate charges.
5. Failed or canceled workflows must refund unused reservations where applicable.
6. Use integer point amounts, not floating-point money values.
7. Ledger entries should be append-only.

---

## Security Rules

Do not log:

- plaintext API keys
- passwords
- password hashes unless explicitly needed for internal tests
- refresh tokens
- full Authorization headers
- provider secrets
- raw unredacted provider payloads

Always consider:

- tenant isolation
- authorization checks
- RLS behavior
- credential redaction
- idempotency
- replay safety
- worker retry safety

---

## Validation Expectations

Before finishing a coding task, run the most relevant checks available in the repository.

Examples:

```bash
npm install
npm run build
npm run typecheck
npm test
npm run db:migrate
```

If a command does not exist yet, say so clearly.

If a command fails, report the failure honestly and include the relevant error summary.

Do not claim that tests passed unless they actually ran and passed.

---

## Response Format After Each Task

At the end of each task, report:

```text
Summary:
- ...

Files changed:
- ...

Commands run:
- ...

Tests:
- ...

Risks / follow-up:
- ...
```

If no tests were run, say why.

---

## If Scope Starts Expanding

If a requested change seems to require touching unrelated modules, stop and explain:

1. why the scope is expanding
2. which files would be affected
3. whether the work should be split into a later PR

Do not silently perform a broad rewrite.

---

## Legacy Code Policy

Legacy code may remain during migration, but it must not be expanded as the v2 production path.

Legacy components include, but are not limited to:

- `server.cjs`
- old MySQL stores
- old file/JSON stores
- local generated asset storage as production storage
- frontend `graphExecutor` as the production workflow executor

Legacy modules may be read for migration compatibility, but new v2 runtime logic should live in the v2 structure.

---

## Final v2 Cutover Requirements

The v2 rebuild is not complete until:

```text
[ ] PostgreSQL is the only production source-of-truth database.
[ ] Redis is used only for queue/cache/lock/rate-limit/session/pubsub concerns.
[ ] S3-compatible storage is the only production binary asset store.
[ ] All core tenant-scoped tables have tenant_id.
[ ] RLS is enabled on tenant-scoped tables.
[ ] All provider calls go through AI Gateway.
[ ] API keys are encrypted and never returned in plaintext.
[ ] Backend workers execute production workflows.
[ ] Workflow runs and node runs are persisted.
[ ] Browser refresh/close does not stop execution.
[ ] Generated assets are stored in S3 and referenced by asset IDs.
[ ] Billing is idempotent.
[ ] Legacy MySQL/file stores are no longer imported by the production entry.
[ ] `server.cjs` is no longer the production entrypoint.
```

