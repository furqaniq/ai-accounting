# Daybook (working name)

Multi-tenant accounting platform with an AI agent that executes tasks behind one
validated, permission-checked, tenant-scoped tool registry. The spec of record is
[`Requirements.md`](Requirements.md); the derived build plan is
[`issues/prd.md`](issues/prd.md); progress is tracked in [`spine.md`](spine.md).

## Quick start (local/demo)

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npm run seed
```

Open <http://localhost:3000> and sign in with the seeded demo owner:

- `owner@acme.test` / `Passw0rd!2026`

> Seed credentials are local/demo only. Rotate them before any non-local use.

## Services

| Service   | Port                |
| --------- | ------------------- |
| Frontend  | 3000 (Next.js)      |
| Backend   | 3001 (NestJS, `/api/v1`) |
| PostgreSQL| 5432                |
| Redis     | 6379                |
| MinIO     | 9000 / 9001 (console) |
| Adminer   | 8080                |

## Development

Infrastructure only (for running the backend/frontend on the host):

```bash
docker compose up -d postgres redis minio
```

Backend (from `backend/`, uses `backend/.env`):

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed
npm run dev        # http://localhost:3001/api/v1/health
npm test           # Jest behavior tests
```

Frontend (from `frontend/`):

```bash
npm install
npm run dev        # http://localhost:3000
```

End-to-end (needs the full Compose stack running and seeded):

```bash
npm install
npm run test:e2e   # Playwright, uses system Chrome
```

## Conventions

- Every API path lives under `/api/v1`; tenancy and RBAC are enforced server-side.
- Behavior is tested TDD-style through public interfaces (HTTP, UI), one vertical
  slice at a time — see the `tdd` skill and `AGENTS.md`.
