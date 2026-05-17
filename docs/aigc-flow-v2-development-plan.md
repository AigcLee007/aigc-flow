# AIGC-Flow v2 彻底重构开发计划：Codex / Antigravity 执行版

> 项目：`AigcLee007/aigc-flow`  
> 文档用途：发给 Codex、Antigravity 或其他 AI Coding Agent，作为连续重构 PR 的总控计划。  
> 目标日期：2026-05-17  
> 重构性质：不是修补旧后端，而是建设 v2 生产级后端内核。  

---

## 0. 给 Codex / Antigravity 的总控说明

你正在重建 `AigcLee007/aigc-flow` 的 v2 后端。目标不是继续修补旧 `server.cjs`，也不是在旧 MySQL / JSON fallback 上继续叠功能，而是建立新的生产级系统内核。

### 0.1 目标技术栈

- PostgreSQL：唯一事实数据库，负责业务状态、用户、权限、流程定义、流程执行、计费、审计。
- Redis：负责 BullMQ 队列、分布式限流、短期缓存、会话、锁、事件广播。
- S3-compatible Object Storage：负责所有图片、视频、音频、文件、provider raw request/response 附件。
- Fastify + TypeScript + Zod：v2 API 服务。
- Kysely + node-postgres：类型安全 SQL builder 与 PostgreSQL 连接。
- BullMQ + ioredis：异步任务队列与 worker 执行。
- AWS SDK v3 S3 Client：兼容 AWS S3、MinIO、Cloudflare R2、阿里 OSS S3-compatible 等对象存储。
- Vitest + Testcontainers：测试 PostgreSQL、Redis、MinIO 集成逻辑。
- Pino + OpenTelemetry + Prometheus Metrics：日志、链路追踪、指标。

### 0.2 总原则

1. 不要继续扩大 `server.cjs`。
2. 不要继续新增 MySQL store。
3. 不要继续使用 JSON file fallback 作为任何生产路径。
4. 不要把图片、视频、二进制文件存入 PostgreSQL。
5. 不要把大 prompt、大 response、base64 结果塞进 Redis。
6. PostgreSQL 是唯一事实数据库。
7. Redis 只能保存临时状态，不能成为最终事实来源。
8. S3 是唯一生产资产存储。
9. 所有核心业务表必须有 `tenant_id`。
10. 所有租户级表必须开启 PostgreSQL Row-Level Security。
11. 所有业务请求必须通过 `RequestContext` 设置 `app.tenant_id` 和 `app.user_id`。
12. 所有外部 AI provider 调用必须走 `ai-gateway`。
13. 所有 API Key 必须进入 `api_credentials` 加密存储。
14. 任何 GET API 不得返回 API Key 明文。
15. 工作流生产执行必须由 `apps/worker` 完成，前端 `graphExecutor` 只能作为本地预览或被废弃。
16. 计费必须通过 `usage_events + billing_ledger` 幂等结算。
17. Worker 重试不能重复扣费。
18. S3 bucket 必须 private，上传下载通过 presigned URL。
19. 每个 PR 必须包含 migration、测试和文档更新。
20. 每个 PR 只完成指定范围，不要顺手重写无关模块。

---

## 1. 背景与重构结论

当前项目已经具备多路 AIGC 生成、邮箱登录、积分计费、模型路由、流程画布等能力，但后端仍然保留明显的原型期结构：

- 后端入口过重，`server.cjs` 承载了 API、业务逻辑、模型调用、计费、管理后台和资产处理。
- 数据层混合了 MySQL store、本地 JSON fallback、本地文件资产等路径。
- 用户与权限体系偏扁平，缺少生产级多租户、成员、角色、权限边界。
- API 接入散落，尚未形成强制的 AI Gateway。
- 流程执行主要依赖前端 graph executor，不适合长任务、重试、恢复、审计和计费。
- 生成资产缺少统一 S3 对象存储事实来源。
- 计费缺少严格幂等、预占、结算、退款流程。

因此，本次不是普通重构，而是：

```text
aigc-flow v2 后端内核重建：
PostgreSQL 做唯一事实数据库，Redis 做队列/缓存/限流/会话，S3 做唯一生产资产存储。
旧 MySQL / JSON / 本地文件只作为迁移来源，不再作为生产路径。
```

---

## 2. v2 目标架构

```text
                    ┌────────────────────────┐
                    │        Web UI           │
                    │ React / Flow Canvas     │
                    └───────────┬────────────┘
                                │
                     REST / SSE / WebSocket
                                │
                                ▼
┌──────────────────────────────────────────────────────┐
│                    apps/api                           │
│ Fastify + TypeScript + Zod                            │
│                                                       │
│  Auth / IAM / Tenant / RBAC                           │
│  Projects / Flows / Versions                          │
│  Workflow Run API                                     │
│  AI Gateway API                                       │
│  Asset API                                            │
│  Billing API                                          │
│  Admin API                                            │
│  Audit / Observability                                │
└───────────────┬──────────────────────┬───────────────┘
                │                      │
                │ PostgreSQL           │ Redis
                ▼                      ▼
┌────────────────────────┐   ┌─────────────────────────┐
│ PostgreSQL              │   │ Redis                   │
│ source of truth         │   │ queue/cache/locks       │
│ RLS tenant isolation    │   │ BullMQ/rate/session     │
│ JSONB workflow graph    │   │ pub/sub events          │
└────────────────────────┘   └───────────┬─────────────┘
                                         │ jobs
                                         ▼
                            ┌─────────────────────────┐
                            │ apps/worker              │
                            │ Workflow executor        │
                            │ Provider poller          │
                            │ Asset ingester           │
                            │ Billing settlement       │
                            └───────────┬─────────────┘
                                        │
                                        │ object put/get
                                        ▼
                            ┌─────────────────────────┐
                            │ S3-compatible storage    │
                            │ AWS S3 / MinIO / R2      │
                            │ images/videos/files/raw  │
                            └─────────────────────────┘
```

### 2.1 三个核心事实边界

```text
PostgreSQL = 业务事实状态
Redis      = 临时执行基础设施
S3         = 二进制和大对象事实存储
```

PostgreSQL 保存：

- users
- tenants
- roles / permissions
- projects
- flows
- flow_versions
- workflow_runs
- node_runs
- billing_accounts
- usage_events
- billing_ledger
- ai_routes
- api_credentials
- ai_call_logs
- assets metadata
- audit_logs

Redis 保存：

- BullMQ jobs
- 分布式限流 token / counters
- session 快速缓存
- refresh token blacklist 或 jti blacklist
- workflow stream pub/sub
- 短期 locks

S3 保存：

- 用户上传文件
- AI 生成图片
- AI 生成视频
- 音频
- 缩略图
- provider raw request/response 附件
- workflow 大型中间产物

---

## 3. 目标目录结构

```text
aigc-flow/
  apps/
    web/
      src/
      package.json

    api/
      src/
        main.ts
        app.ts
        config/
          env.ts
        http/
          request-context.ts
          error-handler.ts
          routes.ts
        modules/
          auth/
          tenants/
          users/
          projects/
          flows/
          workflow-runs/
          ai-gateway/
          assets/
          billing/
          admin/
          audit/
        observability/
          logger.ts
          metrics.ts
          tracing.ts
      package.json

    worker/
      src/
        main.ts
        queues/
          workflow.queue.ts
          provider-poll.queue.ts
          asset.queue.ts
          billing.queue.ts
        processors/
          workflow-start.processor.ts
          node-execute.processor.ts
          provider-poll.processor.ts
          asset-ingest.processor.ts
          billing-settle.processor.ts
      package.json

  packages/
    db/
      src/
        db.ts
        transaction.ts
        rls.ts
        migrator.ts
        repositories/
      migrations/
        000001_extensions.sql
        000002_iam.sql
        000003_projects_flows.sql
        000004_ai_gateway.sql
        000005_assets.sql
        000006_workflow_runs.sql
        000007_billing.sql
        000008_audit_outbox.sql
      package.json

    redis/
      src/
        redis.ts
        queues.ts
        rate-limit.ts
        locks.ts
        pubsub.ts

    storage/
      src/
        storage-provider.ts
        s3-storage-provider.ts
        asset-key.ts
        presign.ts

    workflow-core/
      src/
        graph-schema.ts
        compiler.ts
        topo-sort.ts
        state-machine.ts
        node-executor.ts

    ai-gateway-core/
      src/
        types.ts
        route-resolver.ts
        credential-vault.ts
        adapters/
          openai-compatible.adapter.ts
          gemini.adapter.ts
          custom-http.adapter.ts
          image-task.adapter.ts
          video-task.adapter.ts

    shared/
      src/
        errors.ts
        ids.ts
        dto.ts
        permissions.ts

  scripts/
    migrate-from-legacy/
      mysql-to-postgres.ts
      json-to-postgres.ts
      local-assets-to-s3.ts

  infra/
    docker-compose.dev.yml
    minio/
    postgres/
    redis/

  docs/
    v2-architecture.md
    v2-data-model.md
    v2-api-contract.md
    v2-migration-plan.md
    v2-codex-development-plan.md
```

---

## 4. 本地开发基础设施

### 4.1 Docker Compose

新建：`infra/docker-compose.dev.yml`

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: aigc_flow
      POSTGRES_PASSWORD: aigc_flow_dev
      POSTGRES_DB: aigc_flow
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio123456
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

volumes:
  pg_data:
  minio_data:
```

### 4.2 `.env.v2.example`

```env
NODE_ENV=development

DATABASE_URL=postgres://aigc_flow:aigc_flow_dev@localhost:5432/aigc_flow
REDIS_URL=redis://localhost:6379

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=aigc-flow-dev
S3_ACCESS_KEY_ID=minio
S3_SECRET_ACCESS_KEY=minio123456
S3_FORCE_PATH_STYLE=true

JWT_ACCESS_SECRET=dev_access_secret_change_me
JWT_REFRESH_SECRET=dev_refresh_secret_change_me
CREDENTIAL_MASTER_KEY=base64-32-byte-key-for-dev-only

PUBLIC_API_BASE_URL=http://localhost:3365
```

### 4.3 生产启动强校验

生产环境缺少以下配置必须启动失败：

```text
DATABASE_URL
REDIS_URL
S3_BUCKET
S3_REGION
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
CREDENTIAL_MASTER_KEY 或 KMS config
```

如不使用 IAM Role，则还必须存在：

```text
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
```

---

## 5. PostgreSQL 数据模型

### 5.1 基础扩展

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
```

主键约定：

```sql
id uuid primary key default gen_random_uuid()
```

通用字段：

```sql
tenant_id uuid not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

---

### 5.2 IAM / 多租户

```sql
CREATE TABLE users (
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

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug citext UNIQUE NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
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

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  key text NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE permissions (
  key text PRIMARY KEY,
  description text
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);
```

基础角色：

```text
system_admin
platform_admin
tenant_owner
tenant_admin
flow_developer
operator
viewer
```

基础权限：

```text
tenant:read
tenant:manage
member:read
member:manage
project:read
project:create
project:update
project:delete
flow:read
flow:create
flow:update
flow:publish
flow:delete
flow:run
run:read
run:cancel
asset:read
asset:create
asset:delete
billing:read
billing:manage
provider:read
provider:manage
credential:manage
audit:read
admin:system
```

---

### 5.3 PostgreSQL RLS 租户隔离

所有带 `tenant_id` 的表都开启 RLS。

示例：

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_projects
ON projects
USING (
  tenant_id = current_setting('app.tenant_id', true)::uuid
)
WITH CHECK (
  tenant_id = current_setting('app.tenant_id', true)::uuid
);
```

应用层每个业务事务必须执行：

```sql
SET LOCAL app.tenant_id = '<tenant uuid>';
SET LOCAL app.user_id = '<user uuid>';
```

实现要求：

```ts
export async function withTenantTransaction<T>(
  ctx: RequestContext,
  fn: (trx: Transaction<Database>) => Promise<T>
): Promise<T> {
  // begin transaction
  // SET LOCAL app.tenant_id = ctx.tenantId
  // SET LOCAL app.user_id = ctx.userId
  // execute fn
  // commit / rollback
}
```

规则：

- 普通业务连接必须受 RLS 约束。
- migration / backfill / system job 使用单独 service role。
- API 普通请求严禁使用 BYPASSRLS。
- 所有 repository 测试必须包含越权访问用例。

---

### 5.4 Projects / Flows / Flow Versions

```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE flows (
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

CREATE TABLE flow_versions (
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

CREATE INDEX idx_flow_versions_graph_gin
ON flow_versions USING gin (graph_json);

CREATE INDEX idx_flow_versions_compiled_graph_gin
ON flow_versions USING gin (compiled_graph_json);
```

说明：

- `graph_json` 保存前端 React Flow 原始图。
- `compiled_graph_json` 保存后端执行器可稳定理解的 DAG。
- Worker 不直接理解 UI 结构，必须执行 compiled graph。

---

### 5.5 Prompt 资产库

```sql
CREATE TABLE prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  name text NOT NULL,
  description text,
  current_version_id uuid,
  visibility text NOT NULL DEFAULT 'tenant',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE prompt_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  prompt_template_id uuid NOT NULL REFERENCES prompt_templates(id),
  version int NOT NULL,
  engine text NOT NULL DEFAULT 'jinja',
  template_text text NOT NULL,
  variables_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_template_id, version),
  UNIQUE (prompt_template_id, checksum)
);
```

---

### 5.6 AI Gateway 数据模型

```sql
CREATE TABLE ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  default_base_url text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id),
  model_key text NOT NULL,
  display_name text NOT NULL,
  modality text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_window int,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_key)
);

CREATE TABLE api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES ai_providers(id),
  name text NOT NULL,
  encrypted_secret bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL,
  secret_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  rotated_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  provider_id uuid NOT NULL REFERENCES ai_providers(id),
  model_id uuid REFERENCES ai_models(id),
  credential_id uuid REFERENCES api_credentials(id),
  route_key text NOT NULL,
  modality text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  weight int NOT NULL DEFAULT 100,
  fallback_group text,
  base_url_override text,
  request_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limit jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, route_key)
);

CREATE TABLE ai_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_run_id uuid,
  node_run_id uuid,
  provider_id uuid REFERENCES ai_providers(id),
  model_id uuid REFERENCES ai_models(id),
  route_id uuid REFERENCES ai_routes(id),
  status text NOT NULL,
  request_asset_id uuid,
  response_asset_id uuid,
  error jsonb,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  cost_raw numeric(18, 8),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`api_credentials` 禁止出现：

```text
secret_plaintext
api_key_plaintext
raw_secret
```

任何 credential GET API 只能返回：

```json
{
  "id": "...",
  "name": "OpenAI main key",
  "maskedSecret": "sk-****abcd",
  "lastUsedAt": "..."
}
```

---

### 5.7 Assets / S3

```sql
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  workflow_run_id uuid,
  node_run_id uuid,
  owner_user_id uuid REFERENCES users(id),
  kind text NOT NULL,
  mime_type text NOT NULL,
  storage_provider text NOT NULL DEFAULT 's3',
  bucket text NOT NULL,
  object_key text NOT NULL,
  original_filename text,
  size_bytes bigint,
  checksum_sha256 text,
  width int,
  height int,
  duration_ms int,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (bucket, object_key)
);

CREATE TABLE asset_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  width int,
  height int,
  size_bytes bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, variant_key)
);
```

S3 object key 规范：

```text
tenants/{tenantId}/projects/{projectId}/assets/{assetId}/original.{ext}
tenants/{tenantId}/projects/{projectId}/assets/{assetId}/variants/thumb.webp
tenants/{tenantId}/runs/{runId}/nodes/{nodeRunId}/raw/request.json
tenants/{tenantId}/runs/{runId}/nodes/{nodeRunId}/raw/response.json
tenants/{tenantId}/runs/{runId}/nodes/{nodeRunId}/outputs/{assetId}.{ext}
```

生产规则：

- bucket private。
- 不返回永久 public URL。
- 下载通过 `GET /api/v2/assets/:assetId/download-url`。
- 上传通过 `POST /api/v2/assets/presigned-upload`。
- presigned URL 默认 5 到 15 分钟过期。
- provider raw response 可落 S3，但必须脱敏。

---

### 5.8 Workflow Runs / Node Runs

```sql
CREATE TABLE workflow_runs (
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

CREATE TABLE node_runs (
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

CREATE TABLE workflow_run_events (
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

CREATE INDEX idx_node_runs_status
ON node_runs (tenant_id, status, workflow_run_id);

CREATE INDEX idx_workflow_run_events_run_seq
ON workflow_run_events (workflow_run_id, sequence);
```

Workflow run 状态机：

```text
pending -> running -> succeeded
pending -> running -> failed
pending -> running -> canceled
pending -> canceled
```

Node run 状态机：

```text
pending -> runnable -> running -> succeeded
pending -> runnable -> running -> waiting_provider -> running -> succeeded
pending -> runnable -> running -> failed
pending -> skipped
running -> canceled
waiting_provider -> canceled
```

---

### 5.9 Billing

```sql
CREATE TABLE billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  balance_points bigint NOT NULL DEFAULT 0,
  reserved_points bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_run_id uuid REFERENCES workflow_runs(id),
  node_run_id uuid REFERENCES node_runs(id),
  provider_id uuid REFERENCES ai_providers(id),
  model_id uuid REFERENCES ai_models(id),
  usage_type text NOT NULL,
  quantity numeric(18, 6) NOT NULL DEFAULT 0,
  raw_cost numeric(18, 8),
  charged_points bigint NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE billing_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL REFERENCES billing_accounts(id),
  direction text NOT NULL,
  amount_points bigint NOT NULL,
  balance_after bigint NOT NULL,
  reserved_after bigint NOT NULL,
  reason text NOT NULL,
  ref_type text,
  ref_id uuid,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
```

计费流程：

```text
workflow 创建时 reserve
node 成功后 usage_event
billing worker settle
失败或取消 refund
所有操作用 idempotency_key 去重
```

禁止：

- AI Gateway 直接扣最终费用。
- Worker 重试重复扣费。
- 前端传 `pointCost` 决定最终扣费。
- 使用 float 表示积分余额。

---

## 6. Redis 设计

### 6.1 BullMQ 队列

```text
workflow.start
node.execute
provider.poll
asset.ingest
billing.settle
email.send
audit.flush
```

Job payload 只能放 ID：

```json
{
  "tenantId": "...",
  "workflowRunId": "...",
  "nodeRunId": "...",
  "traceId": "..."
}
```

禁止把这些东西放 Redis job payload：

- 大型 prompt
- base64 图片
- 完整 provider response
- 完整 graph json
- 用户上传文件内容

---

### 6.2 限流 key 设计

```text
rl:tenant:{tenantId}:global
rl:tenant:{tenantId}:provider:{providerKey}
rl:route:{routeId}
rl:user:{userId}:run-create
rl:auth:login:{ip}
```

限流场景：

- API 创建 workflow run 限流。
- tenant 总调用限流。
- provider 上游限流。
- route 级别限流。
- 登录/验证码限流。

---

### 6.3 Session / token

```text
session:{sessionId} -> userId, tenantId, roles, expiresAt
refresh:{tokenId} -> userId, sessionId
blacklist:jti:{jti} -> 1
```

建议：

- Access token 使用短有效期 JWT。
- Refresh token 信息落 PostgreSQL，Redis 做快速校验缓存。
- Logout 后 refresh token 立即撤销。

---

### 6.4 分布式锁

```text
lock:workflow-run:{runId}
lock:node-run:{nodeRunId}
lock:billing-account:{tenantId}
lock:credential-rotate:{credentialId}
```

锁只能用于防抖和减少重复工作，最终一致性仍然靠 PostgreSQL transaction、unique constraint 和状态机判断。

---

### 6.5 事件广播

Worker 每写一条 `workflow_run_events`，同时 Redis pub/sub：

```text
channel:workflow-run:{runId}
```

API SSE 订阅 Redis channel 推给前端。

前端断线后通过 PostgreSQL 补事件：

```text
GET /api/v2/workflow-runs/:runId/events?afterSequence=123
```

---

## 7. S3 Asset Service 设计

### 7.1 API

```text
POST   /api/v2/assets/presigned-upload
POST   /api/v2/assets/complete-upload
GET    /api/v2/assets/:assetId
GET    /api/v2/assets/:assetId/download-url
DELETE /api/v2/assets/:assetId
```

### 7.2 上传流程

```text
1. 前端请求 presigned upload。
2. API 创建 asset，status=uploading。
3. API 返回 PUT presigned URL + required headers。
4. 前端直传 S3。
5. 前端调用 complete-upload。
6. API HEAD object 校验 size/checksum/mime。
7. asset status=available。
```

### 7.3 AI 生成结果入库流程

```text
1. provider 返回 URL / base64 / binary。
2. worker 下载或接收结果。
3. worker putObject 到 S3。
4. worker 创建 assets 记录。
5. node_runs.output_json 只存 assetId，不存大文件。
```

### 7.4 统一资产引用格式

```ts
type AssetRef = {
  assetId: string;
  kind: "image" | "video" | "audio" | "file" | "text";
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
};
```

---

## 8. AI Gateway 设计

### 8.1 统一内部接口

```ts
export interface AiGateway {
  generateText(
    ctx: RequestContext,
    req: TextGenerationRequest
  ): Promise<AiGatewayResult>;

  generateImage(
    ctx: RequestContext,
    req: ImageGenerationRequest
  ): Promise<AiGatewayResult>;

  generateVideo(
    ctx: RequestContext,
    req: VideoGenerationRequest
  ): Promise<AiGatewayResult>;

  pollTask(
    ctx: RequestContext,
    req: PollTaskRequest
  ): Promise<PollTaskResult>;
}
```

### 8.2 Provider Adapter

```ts
export interface ProviderAdapter {
  providerKey: string;

  generateText?(
    req: NormalizedTextRequest,
    ctx: ProviderCallContext
  ): Promise<ProviderResult>;

  generateImage?(
    req: NormalizedImageRequest,
    ctx: ProviderCallContext
  ): Promise<ProviderResult>;

  generateVideo?(
    req: NormalizedVideoRequest,
    ctx: ProviderCallContext
  ): Promise<ProviderResult>;

  pollTask?(
    req: ProviderPollRequest,
    ctx: ProviderCallContext
  ): Promise<PollTaskResult>;
}
```

### 8.3 Gateway 职责

AI Gateway 必须负责：

```text
route resolver
credential decrypt
request normalization
provider adapter dispatch
timeout
retry
fallback
circuit breaker
Redis rate limit
raw request/response 脱敏后落 S3
usage_event 生成
ai_call_logs 写入
标准错误码转换
```

业务代码禁止：

```ts
await axios.post("https://provider.xxx/generate", payload);
```

只能：

```ts
await aiGateway.generateImage(ctx, request);
```

### 8.4 标准错误码

```text
PROVIDER_TIMEOUT
PROVIDER_RATE_LIMIT
PROVIDER_AUTH_FAILED
PROVIDER_BAD_REQUEST
PROVIDER_INTERNAL_ERROR
ROUTE_NOT_FOUND
CREDENTIAL_NOT_FOUND
CREDENTIAL_DECRYPT_FAILED
TENANT_RATE_LIMITED
```

---

## 9. Workflow Engine 设计

### 9.1 编译阶段

前端画布继续使用 React Flow，但生产执行必须移到后端。

```ts
type CompiledWorkflow = {
  schemaVersion: "v2";
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  entryNodeIds: string[];
  outputNodeIds: string[];
};

type CompiledNode = {
  id: string;
  type:
    | "input"
    | "prompt"
    | "text.generate"
    | "image.generate"
    | "video.generate"
    | "condition"
    | "asset.transform"
    | "output";
  config: Record<string, unknown>;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  retryPolicy: {
    maxAttempts: number;
    backoffMs: number;
  };
  timeoutMs: number;
};
```

Compile 必须做：

```text
验证节点类型
验证边合法
验证无环
拓扑排序
计算每个节点 dependencies
校验变量引用
校验 prompt template 变量
校验资产输入输出类型
生成 checksum
```

---

### 9.2 执行阶段

API：

```text
POST /api/v2/flows/:flowId/runs
```

API transaction：

```text
1. 校验权限 flow:run。
2. 读取 flow.current_version。
3. 创建 workflow_runs。
4. 根据 compiled_graph 创建 node_runs。
5. entry nodes 标记 runnable。
6. enqueue node.execute。
7. 返回 runId。
```

Worker 执行：

```text
1. 获取 nodeRun。
2. SELECT ... FOR UPDATE 锁住 node_run。
3. 检查状态是否 runnable/running 可执行。
4. 组装 input_json。
5. 执行节点。
6. 写 output_json 或 error_json。
7. 写 workflow_run_events。
8. 解锁下游节点。
9. 下游满足依赖则 enqueue。
10. 所有节点 terminal 后 finalize workflow_run。
```

长任务：

```text
image/video provider 返回 task_id
node_run.status = waiting_provider
enqueue provider.poll with delay
poll 成功后回到 running/succeeded
poll 失败后 retry/fail
```

---

## 10. API v2 设计

### 10.1 Auth

```text
POST /api/v2/auth/register
POST /api/v2/auth/login
POST /api/v2/auth/logout
POST /api/v2/auth/refresh
GET  /api/v2/auth/me
```

### 10.2 Tenant

```text
GET    /api/v2/tenants/current
GET    /api/v2/tenants/:tenantId/members
POST   /api/v2/tenants/:tenantId/members
PATCH  /api/v2/tenants/:tenantId/members/:memberId
DELETE /api/v2/tenants/:tenantId/members/:memberId
```

### 10.3 Project / Flow

```text
GET    /api/v2/projects
POST   /api/v2/projects
GET    /api/v2/projects/:projectId
PATCH  /api/v2/projects/:projectId
DELETE /api/v2/projects/:projectId

GET    /api/v2/projects/:projectId/flows
POST   /api/v2/projects/:projectId/flows
GET    /api/v2/flows/:flowId
PATCH  /api/v2/flows/:flowId
POST   /api/v2/flows/:flowId/publish
GET    /api/v2/flows/:flowId/versions
```

### 10.4 Workflow Run

```text
POST   /api/v2/flows/:flowId/runs
GET    /api/v2/workflow-runs/:runId
GET    /api/v2/workflow-runs/:runId/events
GET    /api/v2/workflow-runs/:runId/stream
POST   /api/v2/workflow-runs/:runId/cancel
POST   /api/v2/workflow-runs/:runId/retry
```

### 10.5 AI Gateway Admin

```text
GET    /api/v2/admin/ai/providers
POST   /api/v2/admin/ai/providers
GET    /api/v2/admin/ai/models
POST   /api/v2/admin/ai/models
GET    /api/v2/admin/ai/routes
POST   /api/v2/admin/ai/routes
PATCH  /api/v2/admin/ai/routes/:routeId
DELETE /api/v2/admin/ai/routes/:routeId
```

### 10.6 Credential Vault

```text
GET    /api/v2/admin/credentials
POST   /api/v2/admin/credentials
PATCH  /api/v2/admin/credentials/:credentialId
POST   /api/v2/admin/credentials/:credentialId/rotate
DELETE /api/v2/admin/credentials/:credentialId
```

### 10.7 Assets

```text
POST   /api/v2/assets/presigned-upload
POST   /api/v2/assets/complete-upload
GET    /api/v2/assets/:assetId
GET    /api/v2/assets/:assetId/download-url
DELETE /api/v2/assets/:assetId
```

### 10.8 Billing

```text
GET    /api/v2/billing/account
GET    /api/v2/billing/ledger
GET    /api/v2/billing/usage
POST   /api/v2/admin/billing/adjust
```

---

## 11. 旧系统迁移计划

迁移分三类：

```text
MySQL -> PostgreSQL
local JSON -> PostgreSQL
local generated files -> S3
```

### 11.1 旧 `flow_projects` 迁移

旧结构：

```text
flow_projects:
  id
  user_id
  title
  nodes_json
  edges_json
  viewport_json
  version
```

迁移到：

```text
projects
flows
flow_versions
```

规则：

```text
每个旧 user 创建一个 default tenant。
每个旧 flow_project 创建一个 project + flow。
旧 nodes/edges/viewport 合成 graph_json。
执行 compileGraph 生成 compiled_graph_json。
version = 1。
status = draft。
```

伪代码：

```ts
for (const legacyFlowProject of legacyFlowProjects) {
  const user = await mapLegacyUser(legacyFlowProject.user_id);
  const tenant = await ensureDefaultTenantForUser(user);

  const project = await createProject({
    tenantId: tenant.id,
    name: legacyFlowProject.title,
  });

  const flow = await createFlow({
    tenantId: tenant.id,
    projectId: project.id,
    title: legacyFlowProject.title,
  });

  const graphJson = {
    nodes: JSON.parse(legacyFlowProject.nodes_json),
    edges: JSON.parse(legacyFlowProject.edges_json),
    viewport: JSON.parse(legacyFlowProject.viewport_json),
  };

  const compiled = compileGraph(graphJson);

  const version = await createFlowVersion({
    tenantId: tenant.id,
    flowId: flow.id,
    version: 1,
    graphJson,
    compiledGraphJson: compiled,
    checksum: sha256(JSON.stringify(graphJson)),
  });

  await setFlowCurrentVersion(flow.id, version.id);
}
```

---

### 11.2 旧 image_routes / video_routes 迁移

迁移到：

```text
ai_providers
ai_models
ai_routes
api_credentials
```

规则：

```text
base_url + transport -> provider
upstream_model -> ai_model
point_cost -> ai_routes.pricing
api_key_env -> api_credentials with source=env_reference
api_key -> 加密后写 api_credentials
route_id -> ai_routes.route_key
```

迁移后旧表里的 `api_key` 必须清空或不再读取。

---

### 11.3 旧 generation records 迁移

推荐先迁移到 legacy 表：

```sql
CREATE TABLE legacy_generation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  legacy_id text NOT NULL,
  legacy_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

这样可以避免为了历史记录硬塞 workflow_run。

更完整方案：

```text
每条旧 generation record 创建：
workflow_runs status=succeeded/failed
node_runs node_type=legacy.generation
assets
usage_events 可选
```

---

### 11.4 本地资产迁移到 S3

流程：

```text
1. 扫描旧 generated asset 本地目录。
2. 计算 sha256。
3. 根据旧 record 建 asset。
4. 上传 S3。
5. 写 assets 表。
6. 更新 legacy record asset mapping。
```

迁移脚本必须支持断点续传：

```sql
CREATE TABLE legacy_asset_backfill_status (
  legacy_path text PRIMARY KEY,
  asset_id uuid,
  upload_status text NOT NULL,
  checksum_sha256 text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 12. PR 级开发计划

以下 PR 顺序是强制顺序。每个 PR 只完成指定范围。

---

### PR-01：建立 v2 monorepo 骨架

#### 目标

```text
apps/api
apps/worker
packages/db
packages/redis
packages/storage
packages/shared
packages/workflow-core
packages/ai-gateway-core
infra/docker-compose.dev.yml
```

#### Codex Prompt

```text
请在当前仓库中建立 v2 monorepo 骨架。

要求：
1. 保留现有前端代码，但移动或映射到 apps/web。
2. 新建 apps/api，使用 Fastify + TypeScript。
3. 新建 apps/worker，使用 TypeScript。
4. 新建 packages/db、packages/redis、packages/storage、packages/shared、packages/workflow-core、packages/ai-gateway-core。
5. 新建 infra/docker-compose.dev.yml，包含 PostgreSQL、Redis、MinIO。
6. 新建 .env.v2.example。
7. 新增 npm scripts：
   - dev:infra
   - dev:api
   - dev:worker
   - db:migrate
   - test
8. 本 PR 不迁移旧业务逻辑，不修改旧 server.cjs 的行为。

验收：
- npm install 成功。
- docker compose 能启动 postgres/redis/minio。
- apps/api /health 返回 ok。
- apps/worker 能启动并连接 Redis。
```

#### 验收清单

```text
[ ] apps/api 可启动
[ ] apps/worker 可启动
[ ] Docker Compose 包含 PostgreSQL / Redis / MinIO
[ ] .env.v2.example 完整
[ ] 旧 server.cjs 行为未改
```

---

### PR-02：PostgreSQL migration 系统

#### 目标

```text
packages/db migrations
schema_migrations
db:migrate
```

#### Codex Prompt

```text
实现 PostgreSQL migration 系统。

要求：
1. 使用 node-postgres + 原生 SQL migrations。
2. 新增 schema_migrations 表。
3. migrations 按文件名顺序执行。
4. 每个 migration 在事务中执行。
5. 失败时打印具体 migration 文件名。
6. 添加 000001_extensions.sql，启用 pgcrypto 和 citext。
7. 添加测试：重复执行 db:migrate 不会重复执行已完成 migration。

不要引入 Prisma。
不要修改旧 MySQL 逻辑。
```

#### 验收清单

```text
[ ] schema_migrations 存在
[ ] migration 可重复执行
[ ] 失败时 rollback
[ ] 000001_extensions.sql 正常执行
```

---

### PR-03：IAM + tenant schema + RLS 基座

#### 目标

```text
users
tenants
tenant_memberships
roles
permissions
role_permissions
RLS helper
```

#### Codex Prompt

```text
新增 IAM / tenant PostgreSQL schema。

要求：
1. 新增 users、tenants、tenant_memberships、roles、permissions、role_permissions 表。
2. 所有 tenant scoped 表开启 RLS。
3. 在 packages/db 新增 withTenantTransaction(ctx, fn)。
4. withTenantTransaction 必须 SET LOCAL app.tenant_id 和 app.user_id。
5. 添加 seed：创建默认 permissions 和系统角色。
6. 添加测试：
   - 未设置 app.tenant_id 时查询 tenant scoped 表失败或返回空。
   - tenant A 不能读 tenant B 数据。
   - withTenantTransaction 可正常读自己的数据。
```

#### 验收清单

```text
[ ] IAM tables 创建完成
[ ] RLS 已启用
[ ] withTenantTransaction 可用
[ ] 越权测试通过
```

---

### PR-04：Auth v2

#### 目标

```text
/api/v2/auth/register
/api/v2/auth/login
/api/v2/auth/refresh
/api/v2/auth/logout
/api/v2/auth/me
```

#### Codex Prompt

```text
实现 Auth v2。

要求：
1. 使用 PostgreSQL users 表。
2. 密码使用 argon2id 或 bcrypt。
3. access token 短有效期。
4. refresh token 服务端可撤销。
5. Redis 存 session 快速缓存。
6. 登录后返回用户所属 tenants。
7. RequestContext 包含 requestId、traceId、userId、tenantId、roles、permissions。
8. 所有 /api/v2 业务路由必须经过 requestContext。

测试：
- 注册、登录、refresh、logout。
- logout 后 refresh token 失效。
- 未登录访问受保护接口返回 401。
```

#### 验收清单

```text
[ ] 注册成功
[ ] 登录成功
[ ] refresh token 可撤销
[ ] logout 后 refresh 失败
[ ] RequestContext 统一生成
```

---

### PR-05：Projects / Flows / Flow Versions

#### 目标

```text
projects
flows
flow_versions
compileGraph
```

#### Codex Prompt

```text
实现 projects / flows / flow_versions。

要求：
1. 新增 PostgreSQL tables。
2. 所有表启用 RLS。
3. graph_json 和 compiled_graph_json 使用 jsonb。
4. 实现 workflow-core：
   - validateGraph
   - compileGraph
   - topologicalSort
   - checksumGraph
5. 新增 API：
   - GET /api/v2/projects
   - POST /api/v2/projects
   - GET /api/v2/projects/:projectId
   - POST /api/v2/projects/:projectId/flows
   - GET /api/v2/flows/:flowId
   - PATCH /api/v2/flows/:flowId
   - POST /api/v2/flows/:flowId/publish
6. 发布 flow 时创建 flow_versions，不覆盖旧版本。

测试：
- 创建 project/flow。
- 发布 flow 生成 version。
- 有环 graph 发布失败。
- tenant 越权访问失败。
```

#### 验收清单

```text
[ ] project CRUD 最小闭环
[ ] flow CRUD 最小闭环
[ ] publish 生成不可变 version
[ ] graph 有环检测通过
[ ] RLS 越权失败
```

---

### PR-06：S3 Storage + Assets

#### 目标

```text
assets
asset_variants
S3 provider
MinIO dev
presigned upload/download
```

#### Codex Prompt

```text
实现 S3-compatible asset service。

要求：
1. 新增 assets、asset_variants 表并启用 RLS。
2. packages/storage 定义 StorageProvider interface。
3. 实现 S3StorageProvider，支持 MinIO path-style。
4. API：
   - POST /api/v2/assets/presigned-upload
   - POST /api/v2/assets/complete-upload
   - GET /api/v2/assets/:assetId
   - GET /api/v2/assets/:assetId/download-url
   - DELETE /api/v2/assets/:assetId
5. bucket 必须 private。
6. API 不返回永久 public URL，只返回短期 signed URL。
7. object key 必须包含 tenantId 和 assetId。
8. complete-upload 时必须 HEAD object 校验存在。

测试：
- 申请上传 URL。
- 上传到 MinIO。
- complete 后 assets.status=available。
- 其他 tenant 无法获取 download-url。
```

#### 验收清单

```text
[ ] MinIO 上传成功
[ ] signed upload URL 可用
[ ] signed download URL 可用
[ ] asset metadata 入库
[ ] 其他 tenant 不能访问
```

---

### PR-07：AI Gateway schema + Credential Vault

#### 目标

```text
ai_providers
ai_models
api_credentials
ai_routes
credential encryption
```

#### Codex Prompt

```text
实现 AI Gateway 数据模型和 Credential Vault。

要求：
1. 新增 ai_providers、ai_models、api_credentials、ai_routes、ai_call_logs。
2. api_credentials 使用 AES-256-GCM 加密。
3. CREDENTIAL_MASTER_KEY 缺失时生产环境启动失败。
4. CredentialVault 支持：
   - createCredential
   - getSecretForProviderCall
   - rotateCredential
   - maskCredential
5. 所有 credential GET API 只能返回 maskedSecret。
6. 新增 admin API 管理 provider/model/route/credential。
7. 写 audit log 预留接口，后续 PR 可接入。

测试：
- 创建 credential 后数据库没有明文。
- GET credential 不返回明文。
- route 可以引用 credential。
```

#### 验收清单

```text
[ ] credential 入库加密
[ ] GET credential 不泄漏明文
[ ] master key 缺失时生产启动失败
[ ] route 可引用 credential
```

---

### PR-08：AI Gateway Runtime，先接文本模型

#### 目标

```text
aiGateway.generateText
routeResolver
adapter
Redis rate limit
```

#### Codex Prompt

```text
实现 AI Gateway runtime，先支持 text generation。

要求：
1. packages/ai-gateway-core 定义 ProviderAdapter。
2. 实现 RouteResolver：
   - tenant route 优先
   - system route fallback
   - priority + weight
   - status active
3. 实现 Redis rate limit。
4. 实现一个 OpenAI-compatible text adapter。
5. 实现 aiGateway.generateText。
6. raw request/response 脱敏后写入 S3 asset，并在 ai_call_logs 引用。
7. 生成 usage_event，但暂不结算。
8. 标准化错误码：
   - PROVIDER_TIMEOUT
   - PROVIDER_RATE_LIMIT
   - PROVIDER_AUTH_FAILED
   - PROVIDER_BAD_REQUEST
   - PROVIDER_INTERNAL_ERROR

测试：
- route resolve 成功。
- provider 429 时触发 rate limit。
- credential 解密后调用。
- raw response 不含 API key。
```

#### 验收清单

```text
[ ] generateText 走 gateway
[ ] provider adapter 可插拔
[ ] route resolver 支持 tenant/system fallback
[ ] usage_event 创建
[ ] raw response 脱敏入 S3
```

---

### PR-09：Redis / BullMQ Worker 基座

#### 目标

```text
workflow.start
node.execute
provider.poll
billing.settle
asset.ingest
```

#### Codex Prompt

```text
建立 BullMQ worker 基座。

要求：
1. packages/redis 定义 queue factory。
2. apps/worker 注册 queues：
   - workflow.start
   - node.execute
   - provider.poll
   - asset.ingest
   - billing.settle
3. 每个 job payload 必须只包含 ID，不包含大对象。
4. worker 日志必须包含 jobId、tenantId、traceId。
5. 添加 graceful shutdown。
6. 添加 failed job 记录。
7. apps/api 增加 /api/v2/admin/queues/health。

测试：
- API 能 enqueue job。
- worker 能消费 job。
- worker 失败会 retry。
```

#### 验收清单

```text
[ ] queues 初始化成功
[ ] worker 可消费 job
[ ] retry 生效
[ ] graceful shutdown 生效
[ ] job payload 无大对象
```

---

### PR-10：Workflow Runs 最小闭环

#### 目标

```text
workflow_runs
node_runs
workflow_run_events
text node execution
```

#### Codex Prompt

```text
实现后端 workflow runner 最小闭环。

范围：
只支持 input、text.generate、output 三种节点。

要求：
1. 新增 workflow_runs、node_runs、workflow_run_events 表。
2. POST /api/v2/flows/:flowId/runs 创建 run。
3. 创建 run 时根据 compiled_graph_json 创建 node_runs。
4. entry nodes 入队 node.execute。
5. worker 执行 input node、text.generate node、output node。
6. text.generate 调用 AI Gateway。
7. 每个状态变化写 workflow_run_events。
8. GET /api/v2/workflow-runs/:runId 返回 run + nodeRuns。
9. GET /api/v2/workflow-runs/:runId/events 返回事件。

测试：
- 创建一个 input -> text.generate -> output 的 flow。
- run 最终 succeeded。
- node_runs 有 output_json。
- workflow_run_events sequence 连续。
```

#### 验收清单

```text
[ ] run 创建成功
[ ] node_runs 创建成功
[ ] text node 调用 AI Gateway
[ ] output node 汇总结果
[ ] workflow_run_events sequence 连续
```

---

### PR-11：SSE 实时状态推送

#### 目标

```text
/events?afterSequence
/stream
Redis pub/sub
```

#### Codex Prompt

```text
实现 workflow run 实时事件推送。

要求：
1. worker 写 workflow_run_events 后 publish 到 Redis channel。
2. API 实现 GET /api/v2/workflow-runs/:runId/stream，使用 SSE。
3. SSE 连接建立时先从 PostgreSQL 补 afterSequence 之后的事件。
4. 然后订阅 Redis pub/sub 推送增量。
5. 前端断线重连时带 lastEventId。

测试：
- run 过程中前端能收到 node status。
- 断线后重连不会丢事件。
```

#### 验收清单

```text
[ ] SSE 可连接
[ ] Redis pub/sub 可推送
[ ] afterSequence 可补事件
[ ] 断线重连不丢事件
```

---

### PR-12：Image / Video 节点迁移到后端

#### 目标

```text
image.generate
video.generate
provider.poll
assets output
```

#### Codex Prompt

```text
扩展 workflow runner，支持 image.generate 和 video.generate。

要求：
1. AI Gateway 增加 generateImage、generateVideo、pollTask。
2. 支持同步返回 asset 和异步返回 provider_task_id。
3. 异步任务进入 provider.poll queue。
4. provider 成功后结果必须写入 S3 assets。
5. node_runs.output_json 只存 AssetRef，不存 base64 或大 URL。
6. provider 原始响应脱敏后存 S3。
7. 失败时进入 retry，超过 maxAttempts 后 node failed。

测试：
- mock provider 同步返回图片。
- mock provider 异步返回 taskId，再 poll 成功。
- 输出资产存在 S3 和 assets 表。
```

#### 验收清单

```text
[ ] image.generate 支持
[ ] video.generate 支持
[ ] provider.poll 支持
[ ] 结果资产化
[ ] output_json 只存 AssetRef
```

---

### PR-13：Billing v2

#### 目标

```text
reserve
usage_event
settle
refund
ledger
```

#### Codex Prompt

```text
实现 Billing v2。

要求：
1. 新增 billing_accounts、usage_events、billing_ledger。
2. BillingService：
   - reserveWorkflowRun
   - createUsageEvent
   - settleUsageEvent
   - refundReservation
3. billing_ledger 使用 idempotency_key 唯一约束。
4. workflow run 创建时 reserve。
5. node 成功后 usage_event。
6. billing.settle worker 结算。
7. workflow failed/canceled 时 refund 未使用 reservation。
8. 所有金额使用 bigint points，不用 float。

测试：
- 同一 usage_event 重复投递只扣一次。
- worker retry 不重复扣费。
- workflow cancel 后 refund。
- tenant 余额不足时 run 创建失败。
```

#### 验收清单

```text
[ ] reserve 成功
[ ] usage_event 创建
[ ] settle 幂等
[ ] cancel/failed refund
[ ] 余额不足无法创建 run
```

---

### PR-14：前端切 v2 Run API

#### 目标

```text
前端运行按钮不再用本地 graphExecutor 生产执行
```

#### Codex Prompt

```text
将前端运行流程迁移到 /api/v2 workflow runner。

要求：
1. 增加 feature flag USE_V2_WORKFLOW_RUNNER=true。
2. 打开 flag 时：
   - 保存 flow
   - 发布 flow version
   - POST /api/v2/flows/:flowId/runs
   - 连接 /stream 显示节点状态
3. graphExecutor.ts 只保留本地 preview 或标记 deprecated。
4. 运行结果从 workflow_runs/node_runs/assets 读取。
5. 图片和视频展示使用 asset download-url。

测试：
- 刷新页面后 run 状态仍可恢复。
- 关闭浏览器后 worker 继续执行。
```

#### 验收清单

```text
[ ] 前端运行走 v2 API
[ ] 页面刷新后 run 状态可恢复
[ ] 浏览器关闭后 worker 继续执行
[ ] asset download-url 展示正常
```

---

### PR-15：Legacy Data Migration

#### 目标

```text
MySQL/JSON/local assets -> PostgreSQL/S3
```

#### Codex Prompt

```text
实现旧数据迁移脚本。

要求：
1. scripts/migrate-from-legacy/mysql-to-postgres.ts
2. scripts/migrate-from-legacy/json-to-postgres.ts
3. scripts/migrate-from-legacy/local-assets-to-s3.ts
4. 支持 dry-run。
5. 支持 checkpoint，可重复执行。
6. 迁移内容：
   - users
   - billing accounts
   - flow_projects -> projects/flows/flow_versions
   - image_routes/video_routes -> ai_providers/ai_models/ai_routes/api_credentials
   - generation records -> legacy_generation_records 或 workflow_runs
   - local generated assets -> S3 assets
7. 生成 migration report。

验收：
- dry-run 输出数量。
- 重复执行不会重复导入。
- 随机抽样旧 flow 可在 v2 打开。
```

#### 验收清单

```text
[ ] dry-run 可用
[ ] checkpoint 可用
[ ] flow_projects 迁移成功
[ ] routes/credentials 迁移成功
[ ] local assets 上传 S3
[ ] 迁移报告生成
```

---

### PR-16：Audit + Observability

#### 目标

```text
audit_logs
structured logs
trace_id
metrics
```

#### Codex Prompt

```text
实现审计和可观测性。

要求：
1. 新增 audit_logs 表。
2. 对这些动作写 audit：
   - login
   - credential create/rotate/delete
   - route create/update/delete
   - flow publish
   - workflow cancel
   - billing adjust
   - member role change
3. pino JSON logs。
4. 每个 request 生成 requestId、traceId。
5. traceId 贯穿 API、queue job、worker、AI Gateway。
6. /metrics 暴露 Prometheus metrics。
7. 指标包含：
   - queue depth
   - workflow status count
   - node execution latency
   - provider latency
   - provider error count
   - billing settle failures

禁止：
- 日志中出现 API Key。
- 日志中出现完整 Authorization header。
- 日志中出现未脱敏 provider raw secret。
```

#### 验收清单

```text
[ ] audit_logs 写入
[ ] pino JSON logs
[ ] traceId 贯穿 API -> queue -> worker
[ ] /metrics 可访问
[ ] 敏感字段脱敏
```

---

### PR-17：删除旧生产入口

#### 目标

```text
server.cjs 不再作为生产入口
旧 MySQL/file store 从生产路径移除
```

#### Codex Prompt

```text
完成 v2 cutover。

要求：
1. package.json start 指向 apps/api。
2. 旧 server.cjs 移到 legacy/ 或删除。
3. 旧 *Store.file.cjs、*Store.mysql.cjs 不再被生产入口 import。
4. 删除 MYSQL_* 生产配置说明。
5. README 改为 PostgreSQL + Redis + S3。
6. 保留 migration scripts 读取旧数据，但不参与 runtime。
7. 添加启动检查：
   - PostgreSQL 必须可连接
   - Redis 必须可连接
   - S3 bucket 必须可访问
   - CREDENTIAL_MASTER_KEY 必须存在

验收：
- grep 生产代码中没有 MYSQL_URL。
- grep 生产代码中没有 auth-data.json / billing-data.json fallback。
- npm run start:v2 可启动。
```

#### 验收清单

```text
[ ] production start 指向 apps/api
[ ] 旧 server.cjs 不再进入生产路径
[ ] 旧 MySQL/file store 不再进入生产路径
[ ] README 更新
[ ] 启动强检查通过
```

---

## 13. 强制禁止清单

Codex / Antigravity 必须遵守：

```text
禁止在 API handler 里直接写 SQL。
禁止业务代码绕过 repository。
禁止任何模块绕过 ai-gateway 调 provider。
禁止 API Key 明文入库。
禁止 API Key 明文返回前端。
禁止生产环境写本地 generated files。
禁止把 base64 图片放 PostgreSQL。
禁止把大 prompt/raw response 放 Redis。
禁止 Redis 成为 workflow 最终状态。
禁止 worker 重试导致重复扣费。
禁止只靠 user_id 做隔离。
禁止新增 MySQL 表。
禁止新增 JSON fallback。
禁止继续扩大 server.cjs。
禁止让 worker 直接理解前端 React Flow UI 节点结构。
禁止把 flow version 覆盖更新。
禁止用 float 表示积分余额。
禁止日志中出现 API Key 或完整 Authorization header。
```

---

## 14. 代码规范与实现约定

### 14.1 TypeScript

```text
[ ] strict: true
[ ] noImplicitAny: true
[ ] API DTO 必须使用 Zod
[ ] service 输入输出必须有类型
[ ] repository 不返回 any
[ ] 错误必须使用统一 AppError
```

### 14.2 模块边界

```text
route -> service -> repository
route 不直接访问 db
service 不直接访问 req.headers
repository 不做权限判断，只做数据访问
权限判断在 service 或 middleware
```

### 14.3 RequestContext

```ts
type RequestContext = {
  requestId: string;
  traceId: string;
  userId: string | null;
  tenantId: string | null;
  roles: string[];
  permissions: string[];
  isSystemAdmin: boolean;
};
```

所有 service 必须接收 `ctx`：

```ts
async function listFlows(ctx: RequestContext, projectId: string) {
  assertPermission(ctx, "flow:read");
  return flowRepo.listByProject(ctx, projectId);
}
```

### 14.4 错误格式

统一错误响应：

```json
{
  "error": {
    "code": "FLOW_NOT_FOUND",
    "message": "Flow not found",
    "requestId": "...",
    "details": {}
  }
}
```

### 14.5 测试要求

每个 PR 至少覆盖：

```text
[ ] 正常路径
[ ] 权限失败
[ ] tenant 越权
[ ] 幂等重复提交
[ ] provider/queue/storage 失败路径
```

---

## 15. 最终验收标准

v2 完成后必须满足：

```text
[ ] PostgreSQL 是唯一事实数据库。
[ ] Redis 只做队列、缓存、锁、限流、session、pub/sub。
[ ] S3 是唯一生产资产存储。
[ ] 所有核心表有 tenant_id。
[ ] 所有 tenant scoped 表启用 RLS。
[ ] 所有业务请求通过 RequestContext 设置 app.tenant_id。
[ ] 所有 flow 有 version。
[ ] 所有 workflow run 有 node_runs。
[ ] 浏览器关闭后任务继续执行。
[ ] 节点失败可重试。
[ ] image/video 长任务通过 provider.poll worker 完成。
[ ] 生成结果落 S3 assets。
[ ] API Key 加密存储。
[ ] AI 调用统一经过 ai-gateway。
[ ] Redis 限流覆盖 tenant/provider/route。
[ ] usage_event + billing_ledger 幂等。
[ ] 前端运行按钮走 /api/v2/flows/:flowId/runs。
[ ] 旧 MySQL/file store 不在生产入口。
[ ] server.cjs 不再作为生产入口。
```

---

## 16. 最推荐执行顺序

```text
1. monorepo + infra
2. PostgreSQL migration system
3. IAM / tenant / RLS
4. Auth v2
5. projects / flows / versions
6. assets + S3
7. AI Gateway schema + credential vault
8. AI Gateway runtime
9. Redis/BullMQ worker
10. workflow_runs / node_runs / text node 最小闭环
11. SSE 状态推送
12. image/video node
13. billing v2
14. 前端切 v2 API
15. legacy migration
16. observability/audit
17. 删除旧生产入口
```

一句话原则：

```text
先建 PostgreSQL/RLS/Redis/S3 三件套，
再建 AI Gateway 和 Worker，
再把前端 graphExecutor 的生产执行权收回后端，
最后迁移旧数据并删除 MySQL/JSON/file fallback。
```

---

## 17. 给 Codex 的每次会话开场 Prompt

```text
你正在重建 AigcLee007/aigc-flow 的 v2 后端。目标不是修补旧 server.cjs，而是建设新的生产级后端内核。

目标技术栈：
- PostgreSQL 作为唯一事实数据库
- Redis 作为 BullMQ 队列、限流、短期缓存、会话、事件广播
- S3-compatible object storage 作为唯一生产资产存储
- Fastify + TypeScript + Zod
- Kysely + node-postgres
- AWS SDK v3 S3 client
- BullMQ + ioredis
- Vitest + Testcontainers

核心原则：
1. 不要继续扩展 server.cjs。
2. 不要继续新增 MySQL store。
3. 不要继续使用 JSON file fallback。
4. 不要把生成图片、视频、文件存本地作为生产路径。
5. 所有核心业务数据必须有 tenant_id。
6. PostgreSQL 表必须启用 RLS，业务请求通过 SET LOCAL app.tenant_id 设置租户上下文。
7. Redis 只能保存临时状态，不能成为最终事实来源。
8. 所有外部 AI provider 调用必须走 ai-gateway。
9. API Key 必须进入 api_credentials 加密存储，任何 GET API 不得返回明文。
10. 工作流生产执行必须由 apps/worker 完成，前端 graphExecutor 只能作为本地预览或被废弃。
11. 计费必须通过 usage_events + billing_ledger 幂等结算，worker 重试不能重复扣费。
12. S3 bucket 私有，上传下载通过 presigned URL。
13. 每个 PR 必须包含 migration、测试、文档更新。
14. 完成 v2 后，旧 server.cjs、旧 MySQL store、旧 file store 必须从生产入口删除。

当前任务只完成我指定的 PR 范围，不要顺手重写无关模块。
```

---

## 18. 参考资料与设计依据

本计划基于：

- 用户提供的 Gemini DeepResearch 附件：《生产级AIGC工作流平台深度重构战略报告：基于Aigc-Flow项目的系统架构演进》。
- 当前 aigc-flow 项目的重构诉求：彻底引入 PostgreSQL、Redis、S3，对后端数据、用户管理、API 接入、流程执行进行生产级重建。
- PostgreSQL Row-Level Security 官方文档：`https://www.postgresql.org/docs/current/ddl-rowsecurity.html`
- PostgreSQL JSON / JSONB 官方文档：`https://www.postgresql.org/docs/current/datatype-json.html`
- AWS S3 Presigned URL 官方文档：`https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html`
- BullMQ Rate Limiting 官方文档：`https://docs.bullmq.io/guide/rate-limiting`
- Redis Rate Limiter 官方文档：`https://redis.io/docs/latest/develop/use-cases/rate-limiter/`
- OpenTelemetry JavaScript 官方文档：`https://opentelemetry.io/docs/languages/js/`
