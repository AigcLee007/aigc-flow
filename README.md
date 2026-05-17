<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This repository now has two runtime tracks:

- v2 production runtime:
  - `apps/api`
  - `apps/worker`
  - PostgreSQL + Redis/BullMQ + S3-compatible storage
- legacy fallback runtime:
  - `server.cjs`
  - old MySQL / file-backed stores
  - retained only for migration support and explicit rollback/debug use

View your app in AI Studio: https://ai.studio/apps/drive/1MB-T6-X8pVklMaEwAk7UBHpKmeGDrBJi

## Run locally

### v2 development and production-path startup

Use the v2 services for all current production-path work:

1. Install dependencies:
   `npm install`
2. Start local infra:
   `npm run dev:infra`
3. Start the v2 API:
   `npm run dev:api`
4. Start the v2 worker:
   `npm run dev:worker`
5. For the combined v2 production-style entry locally:
   `npm run start:v2`

Current root scripts:

- `npm start` -> v2 combined entry
- `npm run start:v2` -> v2 API + v2 worker
- `npm run start:api` -> v2 API only
- `npm run start:worker` -> v2 worker only

See [docs/v2-local-development.md](./docs/v2-local-development.md) for the
current v2 setup and endpoints.

### Legacy fallback runtime

The legacy runtime is no longer the default production path.

- `npm run legacy:server`
- `npm run legacy:start`

Use legacy runtime commands only for migration support, rollback drills, or
explicit debugging of the old stack.

### Legacy local setup

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy [.env.example](./.env.example) to `.env`
3. Fill in your image route keys, SMTP settings, and either:
   `MYSQL_URL`
   or `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`
   If you use docker-compose, the default host-side ports are:
   `PORT=3365`
   `MYSQL_HOST_PORT=3310`
4. Start the legacy app only if you explicitly need it:
   `npm run legacy:start`

### Resend email

This project uses SMTP for email login codes, so Resend works out of the box through its SMTP gateway:

- `SMTP_HOST=smtp.resend.com`
- `SMTP_PORT=465`
- `SMTP_SECURE=true`
- `SMTP_USER=resend`
- `SMTP_PASS=<your Resend API key>`
- `SMTP_FROM=Nano Banana Pro <noreply@yourdomain.com>`

### Default ports

- `5188` - Vite frontend dev server
- `3365` - Node.js backend / BaoTa reverse proxy target
- `3310` - Host-side MySQL bind for docker-compose

## MySQL migration

If you already have `auth-data.json` and `billing-data.json`, you can import them into MySQL after configuring the database variables in `.env`:

`npm run migrate:mysql`

The legacy server will use MySQL automatically when MySQL env vars are present.
If MySQL is not configured, it falls back to the legacy JSON stores for local
development. This is not part of the v2 production runtime.

## v2 runtime

The v2 production entry is now:

- `apps/api`
- `apps/worker`

The legacy frontend and `graphExecutor` remain in the repository for migration
compatibility, but backend production execution belongs to the v2 API and
worker stack.
