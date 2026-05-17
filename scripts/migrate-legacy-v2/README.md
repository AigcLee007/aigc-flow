# Legacy to v2 Migration Scripts

This directory contains the PR-15 migration tooling for moving legacy data into the v2 PostgreSQL and S3-compatible storage model.

## Scope

- Migrate legacy `flow_projects` style canvas data into v2 `projects`, `flows`, and `flow_versions`
- Compile migrated graphs with `workflow-core`
- Migrate legacy generated asset files from local storage into S3-compatible storage plus the v2 `assets` table
- Produce user/auth metadata mapping drafts without migrating passwords or sessions
- Produce billing dry-run summaries without writing v2 billing ledger rows
- Support `--dry-run`, `--resume`, `--limit`, `--tenant-id`, `--user-id`, `--legacy-source`, and `--report`

## What This Does Not Do

- It does not change `server.cjs` runtime behavior
- It does not rewrite legacy stores to read or write v2 tables
- It does not migrate plaintext passwords or legacy sessions
- It does not write billing reconciliation data into `billing_ledger`
- It does not remove legacy runtime paths; that remains PR-17

## Prerequisites

- For `--dry-run`, no PostgreSQL or S3 credentials are required
- For a real migration run, configure:
  - `DATABASE_URL`
  - `S3_BUCKET`
  - `S3_REGION`
  - `S3_ENDPOINT` when using MinIO or another S3-compatible local target
  - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unless your environment uses instance credentials
- Provide a target `--tenant-id`
- Optionally provide `--user-id` if migrated rows should record an existing v2 actor
- For legacy MySQL reads, configure the existing `MYSQL_URL` or `MYSQL_HOST`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`

## Dry-Run Example

```bash
npm run migrate:legacy:v2:dry-run -- --tenant-id 00000000-0000-0000-0000-000000000001 --legacy-source ./scripts/migrate-legacy-v2/fixtures --report ./scripts/migrate-legacy-v2/reports/dry-run.json
```

## Real Migration Example

```bash
npm run migrate:legacy:v2 -- --tenant-id <tenant-id> --user-id <existing-v2-user-id> --legacy-source ./storage --report ./scripts/migrate-legacy-v2/reports/migration.json
```

## Checkpoint and Resume

- State is stored in `scripts/migrate-legacy-v2/.migration-state.json`
- Completed project and asset items are recorded there
- `--resume` reloads that state and skips already migrated entries
- The state file is intentionally gitignored
- Use `.migration-state.example.json` as a format reference only

## Reports

`--report` writes a JSON report with:

- planned project/flow/asset counts
- migrated counts
- skipped counts
- warnings
- errors
- billing summary snapshot when legacy billing data is present

## Rollback and Manual Checks

- Review the report before switching any traffic
- Spot-check a few migrated `flow_versions.graph_json` and `compiled_graph_json` rows
- Spot-check migrated S3 objects and matching `assets.object_key`
- Because assets are stored with deterministic keys, reruns are overwrite-safe on the object path
- If a graph cannot compile, the script records an error instead of crashing the entire batch

## Known Limitations

- Legacy `flowProjectStore.cjs` is treated as one legacy project plus one migrated flow per row
- Auth migration is metadata-only in this PR; passwords and sessions require a separate confirmed strategy
- Billing migration is summary-only in this PR; ledger cutover requires reconciliation outside this script
- Assets are migrated as tenant-scoped objects without reconstructing a full legacy project linkage
