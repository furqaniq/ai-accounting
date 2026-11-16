# Daybook (working name)

Multi-tenant accounting platform with an AI agent that executes tasks behind one
validated, permission-checked, tenant-scoped tool registry. The spec of record is
[`Requirements.md`](Requirements.md); the derived build plan is
[`issues/prd.md`](issues/prd.md); progress is tracked in [`spine.md`](spine.md).

## Client walkthrough

Open [`User-flows.html`](User-flows.html) directly in a browser (no build step) for the ten
documented flows, the AI-01–AI-17 test matrix with evidence, and the responsive/label review
record. It is the single static 036 review package and is **awaiting client/design sign-off**.

## Quick start (local/demo)

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec backend npm run seed
```

Open <http://localhost:3000> and sign in with any seeded demo account. The seed is
idempotent, so rerunning `docker compose exec backend npm run seed` repairs or
refreshes the demo data without duplicating records.

> Seed credentials are local/demo only. Rotate them (and `JWT_SECRET` and the
> MinIO/Postgres passwords in `.env`) before any non-local use. No secrets are
> committed; `.env` is git-ignored.

### Demo accounts

All accounts use the password `Passw0rd!2026`.

| Organization | Email | Role |
| --- | --- | --- |
| Acme Services Co. | `owner@acme.test` | Owner (also Accountant on Nimbus) |
| Acme Services Co. | `accountant@acme.test` | Accountant/Bookkeeper |
| Acme Services Co. | `staff@acme.test` | Staff |
| Acme Services Co. | `viewer@acme.test` | Viewer (read-only) |
| Nimbus Retail LLC | `owner@nimbus.test` | Owner |
| Nimbus Retail LLC | `accountant@nimbus.test` | Accountant/Bookkeeper |

### Seeded demo data

Both organizations get the same starting shape, with deliberately different
records so tenant isolation is visible:

- The industry-neutral default chart of accounts (1000–6900), including a
  `1020 Checking account` funding the `Operating checking` bank account.
- Customers, vendors, items, and mixed-state invoices, bills, and estimates
  (drafts, sent/open, overdue).
- A reconciled October bank CSV period (`demo-checking-october.csv`) with two
  categorized transactions and a completed `2026-10-01`–`2026-10-31`
  reconciliation. Acme uses Northwind payment/refund rows; Nimbus uses Cedar
  Market payment/refund rows. The paired deposit and refund keep cash, AR, and
  P&L totals unchanged.
- One enabled weekly cron automation per organization, `Weekly cash review`
  (`0 9 * * 1`, UTC), created by that organization's owner.

All demo data is synthetic and industry-neutral; do not put real customer data
in the seeded or Gemini free-tier demo.

### AI provider

The agent runs with the deterministic stub unless `GEMINI_API_KEY` is set in
`.env`; `AI_PROVIDER=auto` switches to Gemini when a key exists. Free-tier Gemini
may use prompt/response content to improve Google products, so keep the demo on
synthetic data until a billed provider project is approved.

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

End-to-end (needs the full Compose stack running and seeded). The agent specs use
the guarded test hook, so recreate the backend with `AGENT_TEST_HOOKS=1`:

```bash
AGENT_TEST_HOOKS=1 docker compose up -d backend
npm install
npm run test:e2e   # Playwright, uses system Chrome
```

Verified commands from the repository root:

```bash
npm run backend:test   # Jest behavior tests
npm run test:e2e       # Playwright against the Compose stack
npm run backend:build  # TypeScript build
npm run frontend:build # Next.js build
```

Jest and Playwright share one database, so never run them at the same time.
Rebuild the Compose images (`docker compose up -d --build backend frontend`)
after backend/frontend code changes, and rerun the seed step before a demo.

## Conventions

- Every API path lives under `/api/v1`; tenancy and RBAC are enforced server-side.
- Behavior is tested TDD-style through public interfaces (HTTP, UI), one vertical
  slice at a time — see the `tdd` skill and `AGENTS.md`.
