# AGENTS.md

## State
- `Requirements.md` is the spec of record. Read it fully before building; reconcile code to it, never edit it to match code.
- `issues/prd.md` is the derived build plan (modules, schema, API contracts, testing). Use it as the working plan; `Requirements.md` wins on conflicts.
- `issues/001-*.md` through `issues/036-*.md` are the vertical-slice implementation issues. Work in number order and respect each `Blocked by`; HITL gates are 001 (scaffold/shell), 029 (approver role), and 036 (design/User-flows QA). Keep local filename references, not GitHub issue numbers.
- Progress lives in `spine.md` — update its status table and log whenever an issue starts, finishes, or is blocked.
- Per-issue workflow: TDD vertical slices (`tdd` skill, behavior tests through public interfaces) → Playwright spec green at issue end → commit + push via composio-cli (`GITHUB_COMMIT_MULTIPLE_FILES`, never a bare `git push`).
- Scaffold exists: `backend/` (NestJS + Prisma), `frontend/` (Next.js App Router), root Playwright, `docker-compose.yml`. Real commands: `cp .env.example .env && docker compose up -d --build` → `docker compose exec backend npm run seed` → app on :3000; backend tests `npm run backend:test`; e2e `npm run test:e2e`; builds `npm run backend:build` / `npm run frontend:build`. The shell currently uses Daybook CSS tokens from `ui/` directly; introduce Tailwind/shadcn/TanStack deliberately per Requirements §6 when feature slices need them.

## Design sample (`ui/`)
- Static, no build step, no framework. Shared `styles.css`, `app.js`, `favicon.svg`; pages: `index.html` (Overview), `invoices.html`, `reconcile.html`, `reports.html`, `agent.html` (Clerk).
- Open `ui/index.html` directly, or serve it: `cd ui && python3 -m http.server 8000`.
- This is a visual/demo artifact, not the production frontend. Data is hardcoded in `app.js` and interactions are mock-only; do not wire it to APIs or expand its functionality unless asked.
- Preserve the design direction: working name **Daybook**, agent persona **Clerk**. Tokens live at the top of `styles.css` (pale sage paper, deep ledger-green spine, red-ink margin rule); type is Petrona for display/figures and Familjen Grotesk for UI. The signature is the three-column spine / ledger / clerk-margin layout, ruled tables, and double-rule totals. Avoid cards, gradients, and the generic SaaS dashboard kit.
- The sample covers Overview, invoices, bank reconciliation, reports, and the clerk workspace. It does not cover auth, bills/AP, projects, or settings. Its mock data (Acme Services Co., invoices, reports) is illustrative; real seed data is defined by Requirements §7.
- Responsive behavior: the clerk margin becomes a drawer under 1120px, the spine under 860px. Keep pages usable down to mobile.

## Non-negotiable invariants
- Scope every query by `organizationId` at the service/data layer. Two seeded orgs test isolation.
- Industry-neutral labels only ("Items", "Customers", "Vendors"); no vertical-specific modules.
- Out of MVP: live bank feeds (CSV/OFX only), real payments/payroll/tax filing, multi-currency, inventory valuation/BOM, i18n, mobile. Ask before adding.
- Roles: Owner, Admin, Accountant/Bookkeeper, Staff, Viewer (read-only). Guard every endpoint.
- AI Agent: one backend tool registry, three modes (prompt, cron, event). Model proposes tool + args; validate before execution; never allow raw SQL or free-form code. Financial actions (e.g. `bill.pay`) default to propose-then-approve.
- Separate immutable logs: `AuditLogEntry` (users) vs `AgentActionLog` (agent: trigger, tools, I/O, actor, approval).

## Planned stack (Requirements.md §6)
- Monorepo: `frontend/` (Next.js App Router, TS, Tailwind, shadcn/ui, TanStack Query), `backend/` (NestJS, Prisma, Passport JWT, class-validator), Playwright at root.
- Compose ports: frontend 3000, backend 3001, postgres 5432, redis 6379, minio 9000/9001, adminer 8080.
- Redis + BullMQ for cron, events, and all agent jobs. Agent calls must be queued with backoff + jitter; treat Gemini `429 RESOURCE_EXHAUSTED` as normal load.
- Gemini behind `AiProviderService` (`generate()`, `callWithTools()`); `GEMINI_API_KEY` in `.env`, never committed. Attachments in MinIO, not disk.
- Target: `docker compose up` → seed → log in.

## Seed accounts (§7)
- `owner@acme.test`, `accountant@acme.test`, `staff@acme.test`, `viewer@acme.test`; `owner@nimbus.test`, `accountant@nimbus.test`.
- Password `Passw0rd!2026`; local/demo only, rotate before any non-local use.
- Seed chart of accounts, customers/vendors/items, mixed-state invoices/bills, a reconciled bank CSV period, and one agent cron job per org.

## Testing
- Backend: Jest behavior tests through public HTTP (`npm --prefix backend test`, in-process against local Postgres). E2E: `npx playwright test` (system Chrome) against the running Compose stack; one spec per flow, added at the end of each issue.
- Flows (§8): auth + cross-tenant isolation, RBAC, invoice lifecycle, expense/bill lifecycle, bank import + reconcile/undo, reporting totals, agent prompt/cron/event, approval.
- Tenancy + RBAC tests must hit the API directly, not only the UI.
- Jest for backend unit/integration.

## Gotchas
- Gemini free tier may use prompts/responses to improve Google products; synthetic data only until a billed project is approved.
- `User-flows.html` must be one static file with no build step.
- New features stay tenant-scoped, audited, and free of hard-coded industry terms.
