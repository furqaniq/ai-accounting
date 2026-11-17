# 037 — Production deployment (Vercel + Render + Neon)

**Status:** done — live demo deployed and smoke-tested 2026-11-17
**Blocked by:** 036 (client approved the revised User-flows document on 2026-11-17)
**Depends on:** 034 (deterministic demo seed), 035 (regression sweep)

## Goal

Put the Daybook MVP online with the client-requested split:

- **Frontend:** Vercel
- **Backend:** Render
- **Postgres:** Neon

Keep the supporting runtime services explicit: Render Key Value for BullMQ and MinIO for
attachments. Deliver a static `AI-Accounting-Deployment.html` review document in the same
Daybook walkthrough style as `AI-Accounting-User-Flows.html`.

## Production topology

| Layer | Resource | Runtime / plan | Address |
| --- | --- | --- | --- |
| Frontend | `ai-accounting` on Vercel | Next.js 16, Hobby | https://ai-accounting-beta.vercel.app |
| API | `daybook-api` on Render | NestJS Docker, free | https://daybook-api-9nwb.onrender.com |
| Database | `ai-accounting` on Neon | Postgres 16, free | `daybook` database, direct TLS |
| Queue | `daybook-redis` on Render | Key Value, free | internal `redis://red-...:6379` |
| Files | `daybook-minio` on Render | MinIO image, free | https://daybook-minio.onrender.com |

The frontend is linked to `furqaniq/ai-accounting` with root directory `frontend`. The backend is
linked to the same repository with root directory `backend`, branch `main`, and a Docker build.
It runs `prisma migrate deploy` before `node dist/main.js`.

## Environment contract

Secrets live only in Vercel/Render. The repo contains no production values.

| Variable | Where | Production rule |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Vercel | `https://daybook-api-9nwb.onrender.com/api/v1` |
| `DATABASE_URL` | Render API | Neon direct TLS URI (not pooled) |
| `JWT_SECRET` | Render API | Generated 96-character secret |
| `CORS_ORIGINS` | Render API | `https://ai-accounting-beta.vercel.app` |
| `REDIS_URL` | Render API | Render Key Value internal URL |
| `AI_PROVIDER` | Render API | `stub` (no Gemini key installed) |
| `AGENT_QUEUE_DRIVER` | Render API | `bull` |
| `AGENT_TEST_HOOKS` | Render API | `0` |
| `AGENT_DEFAULT_MODEL` | Render API | `flash` |
| `AGENT_MAX_ATTEMPTS` | Render API | `3` |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_USE_SSL` | Render API | `daybook-minio.onrender.com` / `443` / `true` |
| `MINIO_PUBLIC_ENDPOINT` / `MINIO_PUBLIC_PORT` / `MINIO_PUBLIC_USE_SSL` | Render API | Same public host / `443` / `true` |
| `MINIO_BUCKET` / `MINIO_REGION` | Render API | `daybook-attachments` / `us-east-1` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Render API + MinIO | Generated pair, set in both services |
| `NODE_ENV` | Render API | `production` |

The private Render hostname `daybook-minio` did not resolve from the API container
(`getaddrinfo ENOTFOUND`), so the API uses the public HTTPS endpoint for both SDK operations and
presigned URLs.

## Acceptance

- [x] Neon project, database, and direct connection string created.
- [x] Render Key Value instance created and connected to the API.
- [x] MinIO service created, healthy, and usable for upload/list/presign/download/delete.
- [x] Render API builds from `backend/` and passes `/api/v1/health`.
- [x] Migrations applied to Neon and the deterministic seed run for both organizations.
- [x] Vercel project builds `frontend/` with `NEXT_PUBLIC_API_URL` and serves the production alias.
- [x] Owner login, two memberships, dashboard, reports, and Clerk work in Chrome with no console errors.
- [x] Agent prompt queues through Render Key Value and completes with the deterministic stub.
- [x] CORS allows only the production Vercel origin.
- [x] `AGENT_TEST_HOOKS=0`; no guarded test hook is exposed.
- [x] `AI-Accounting-Deployment.html` is one self-contained static file in the walkthrough style.
- [x] README, AGENTS.md, and spine record the deployment and its limits.

## Verification evidence

| Check | Result |
| --- | --- |
| `GET /api/v1/health` | `200 {"status":"ok"}` |
| Frontend alias | `200` with Vercel response headers |
| Owner login | `200`; Acme + Nimbus memberships |
| Dashboard | `$5,000.00` cash; AR `$1,274.25`; AP `$1,124.50` |
| Agent prompt | job `COMPLETED`; cash summary returned |
| Attachment upload | `201`; list `1`; presigned GET `200`; download `200`; delete `204` |
| Browser | login → Overview → Reports → Clerk; no console/page errors |
| Local suite | Jest 262 passed / 42 suites; Playwright 47 passed / 29 specs (from 035) |

## Known limits

- Render free web services sleep after idle; the first request is cold and cron/event timing is
  best-effort while asleep.
- Render Key Value free has no persistence; in-flight queue state can be lost on restart. Cron
  rows live in Postgres and the backend re-registers enabled schedules at startup.
- MinIO is a free Render service with no persistent disk. Attachments are lost on restart or
  redeploy. Add a disk or move to durable S3-compatible storage before real receipts.
- The published demo credentials remain active. Rotate them or replace the demo seed before real
  data.
- `AI_PROVIDER=stub`; the agent is deterministic and makes no Gemini calls.
- Neon is on the free plan with auto-suspend; backups/PITR retention should be reviewed before
  production use.
- The frontend deployment was created API-first. Redeploy from the current commit in Vercel when
  frontend code changes; backend changes auto-deploy from `main` under `backend/**`.

## Deliverable

- `AI-Accounting-Deployment.html` — static deployment record, architecture, environment contract,
  runbook, verification log, limits, and hardening checklist. No build step; Google Fonts only.
- `AI-Accounting-User-Flows.html` — 036 approval closure (client approved 2026-11-17).
- `README.md`, `AGENTS.md`, `spine.md` — production references and current status.
