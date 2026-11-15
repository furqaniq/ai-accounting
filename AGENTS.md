# AGENTS.md

## State
- `Requirements.md` is the spec of record. Read it fully before building; reconcile code to it, never edit it to match code.
- `issues/prd.md` is the derived build plan (modules, schema, API contracts, testing). Use it as the working plan; `Requirements.md` wins on conflicts.
- `issues/001-*.md` through `issues/036-*.md` are the vertical-slice implementation issues. Work in number order and respect each `Blocked by`; HITL gates are 001 (scaffold/shell), 029 (approver role), and 036 (design/User-flows QA). Keep local filename references, not GitHub issue numbers.
- **Progress as of 2026-11-16: issues 001–018 are complete. 019 (transaction matching) is next and awaiting the client's go-ahead.** Confirm before starting each new issue.
- Progress lives in `spine.md` — update its status table and log whenever an issue starts, finishes, or is blocked.
- Per-issue workflow: TDD vertical slices (`tdd` skill, behavior tests through public interfaces) → Playwright spec green at issue end → update `spine.md` → commit + push via composio-cli (`GITHUB_COMMIT_MULTIPLE_FILES`, never a bare `git push`). GitHub target is `furqaniq/ai-accounting`, branch `main`, author `Furqan Iqbal <furqan93@gmail.com>`; verify pushed files with `GITHUB_GET_REPOSITORY_CONTENT`.
- Scaffold: `backend/` (NestJS + Prisma), `frontend/` (Next.js App Router), root Playwright, `docker-compose.yml`. Commands: `cp .env.example .env && docker compose up -d --build` → `docker compose exec backend npm run seed` → app on :3000; backend tests `npm run backend:test`; e2e `npm run test:e2e`; builds `npm run backend:build` / `npm run frontend:build`.
- Compose images bake source in (no bind mounts): after backend/frontend code changes run `docker compose up -d --build backend frontend` before Playwright or manual checks.

## Implemented architecture (through 018)
### Backend
- API prefix `/api/v1`; global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`; CORS from `CORS_ORIGINS`, exposing `Content-Disposition`.
- Auth: `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`; JWT access tokens plus hashed, rotating refresh tokens. Every tenant request sends `Authorization: Bearer <token>` and `X-Organization-Id`.
- Modules: `auth`, `tenant`, `accounts`, `ledger`, `sales` (customers, items, invoices, estimates, PDFs, payments, AR aging), `purchases` (vendors, bills, bill payments, quick expenses, AP aging), `attachments` (the MinIO-backed `AttachmentStore`), `banking` (bank accounts, imports, transactions, categorization rules).
- `ScopedDataAccess` is the default tenant boundary: add every new organization-owned model to its `ScopedModel` union and query through it. Direct Prisma calls are for transactional/locking paths only, must still filter `organizationId`, and must never trust a caller-supplied org id.
- `permissions.ts` is the single role → permission matrix. Permission names follow `${domain}:read|manage`; current domains include org, members, audit, accounts, ledger, customers, items, invoices, estimates, payments, vendors, bills, expenses, attachments, banking, plus `reports:read` (granted to every role). Endpoints declare `@RequirePermission`; Owner/Admin/Accountant/Staff manage business records, Viewer is read-only.
- Audit every state change through `AuditService` (`AuditLogEntry`). Agent logs will be separate (`AgentActionLog`). Action names must match `^[a-z]+(\.[a-z_]+)+$` (for example `bill.pay`); hyphens are rejected.
- `LedgerEngine` is the only journal writer. Use `postWithin(tx, ...)` when a feature transaction needs an atomic post, otherwise `postEntry`. Journal references are per-org `JE-####`; posted entries are immutable and corrected by reversal. The unique key `(organizationId, sourceType, sourceId)` makes feature postings idempotent.
- `BankingImportEngine` is the only bank-file parser, mapper, and normalizer; the UI never parses files. It returns preview rows and duplicate fingerprints, and the banking import service persists a batch plus normalized transactions atomically.

### Frontend
- Next.js App Router with plain Daybook CSS (`globals.css`, `shell.css`) and typed wrappers in `frontend/lib/api.ts`. Tailwind/shadcn/TanStack Query are **not installed yet**; introduce them deliberately per Requirements §6 when a slice needs them.
- Session state in localStorage: `daybook.accessToken`, `daybook.refreshToken`, `daybook.activeOrgId`. API base defaults to `http://localhost:3001/api/v1`.
- Shared shell: `components/app-spine.tsx` (spine, nav, org/user controls) and `components/audit-log-drawer.tsx`. Pages cover login, overview, members/settings, accounts, ledger, customers/items, invoices, estimates, payments, AR and AP aging, vendors, bills, bill payments, and expenses, with attachment pockets on expense and bill details, plus the banking workspace with account setup, import mapping, activity filters, and categorization-rule CRUD.
- Preserve the Daybook visual system: ruled tables, double-rule totals, pale sage paper, ledger-green spine, Petrona display/figures, Familjen Grotesk UI. Avoid cards, gradients, and generic SaaS dashboards.

### Domain rules
- Sales: `CUST-####`, `ITEM-####`, `INV-####`, `EST-####`, `PAY-####` are per-org. Invoice drafts are editable; sending posts AR `1100`, income accounts, and sales tax `2100` once. DB invoice statuses are DRAFT/SENT/PARTIAL/PAID; OVERDUE is derived from `dueDate`.
- Estimates convert only when ACCEPTED, create a DRAFT invoice, and store a unique `convertedInvoiceId`; no ledger post until that invoice is sent.
- Invoice PDFs: `GET /invoices/:id/pdf`, `application/pdf`, `INV-####.pdf`; `pdfkit` runtime, `pdf2json` dev-only for text assertions.
- Customer payments: `PAY-####`; one RECEIVED receipt applies across one or more open invoices for one active customer, and the receipt total must equal the applied sum. Row-lock invoice reads; reject over-application. Partial sets PARTIAL, full sets PAID/`paidAt`, and the payment posts Cash `1000` debit / AR `1100` credit once. Payments are create-only; no unapplied credit or reversal yet.
- AR aging: `GET /reports/ar-aging?asOf=YYYY-MM-DD`; buckets current/1–30/31–60/61–90/90+. As-of uses invoice `issueDate` and payment `date` (not `sentAt`/`paidAt`); drafts excluded; `current` includes due today; `1–30` starts one day past due. Totals must reconcile to open invoices.
- Purchases: `VEND-####`, `BILL-####`. Bill lines must use active EXPENSE accounts; tax uses the org default or an explicit rate and posts to purchase tax receivable `1300`. Opening validates active AP `2000` (and `1300` when taxed), row-locks the bill, posts expense debits + tax debit + AP credit once, and sets OPEN. Only DRAFT bills are editable; DB statuses are DRAFT/OPEN/PARTIAL/PAID and OVERDUE is derived. Vendor balance = non-draft bills `total - amountPaid`.
- Bill payments: `BPAY-####`; one SENT payment applies across one or more OPEN/PARTIAL bills for one active vendor, and the payment total must equal the applied sum. Row-lock bill reads; reject drafts, paid bills, mixed vendors, over-application, and mismatched receipts. Partial sets PARTIAL, full sets PAID/`paidAt`, and the payment posts AP `2000` debit / Cash `1000` credit once. Bill payments are create-only; no unapplied credit or reversal yet.
- AP aging: `GET /reports/ap-aging?asOf=YYYY-MM-DD`; same five buckets. As-of uses bill `issueDate` less `BillPaymentApplication` amounts whose payment `date` is on or before the as-of date; drafts and later payments excluded; totals must reconcile to open bills. `reports:read` covers it.
- Quick expenses: `EXP-####`; required active EXPENSE category, optional active vendor, date, two-decimal amount, memo, and optional receipt note. Creating posts category debit / Cash `1000` credit once through `LedgerEngine`. Financial edits reverse the prior entry and post a corrected `:vN` entry; memo/vendor-only edits stay off the ledger. List filters by date range, category, vendor, and search; Viewer read-only.
- Banking rules: `CategorizationRule` stores `descriptionContains`, an active target ledger account, a priority, and an active pause switch. Matching is case-insensitive and whitespace-normalized; lower priority wins, then the older rule, then id, and every transaction uses at most one rule. Rules apply at import time, set `categoryAccountId`/`categoryRuleId` and `CATEGORIZED`, and post one `BANK` journal per transaction (inflow debits the bank and credits the target; outflow does the reverse). Rules never rewrite existing imports, target accounts must be active, and a rule targeting the bank's own ledger account is skipped. No seed rules.
- Banking: `BankAccount` links one active ledger account (ASSET for checking/savings, LIABILITY for credit cards), unique per organization. `BankingImportEngine` accepts CSV/OFX up to 10 MB, auto-detects headers/delimiters, maps date/description/amount or debit/credit/external-id fields, and normalizes to UTC dates and signed amounts (positive inflow, negative outflow). Duplicate fingerprints use the external ID when mapped, otherwise date+amount+description. `POST /bank-imports/preview` returns headers, mapping, normalized rows, and counts without writing; `POST /bank-imports` skips duplicates and invalid rows, persists a `BankImportBatch` with row/imported/duplicate/invalid counts, and links each row to that batch for undo diagnostics. `GET/POST /bank-accounts`; `GET /bank-transactions` filters by account, date, match state, and search; `GET/POST/PATCH/DELETE /categorization-rules`. Transactions start UNMATCHED; rule matches become CATEGORIZED and post `BANK` journals, while transaction matching and manual settlement land in 019–020. `banking:read|manage` gates the domain; audited as `bank.account.create`, `bank.import`, and `bank.rule.create|update|delete`; no live feed or aggregator.
- Attachments: `Attachment` metadata carries `entityType` (EXPENSE/BILL), `entityId`, object key, filename, content type, and size. `AttachmentStore` is the only MinIO caller and owns upload, streamed download, deletion, and 15-minute presigned GET URLs. Uploads are capped at 10 MB and limited to PDF/PNG/JPEG/WebP, validated by extension, declared MIME, and magic bytes, with sanitized filenames. Object keys are `{org}/{entity}/{entityId}/{uuid}/{filename}`; the bucket is created lazily. `GET/POST /attachments`, `GET /attachments/:id/url|download`, `DELETE /attachments/:id`; staff manage, viewer read-only, audited as `attachment.upload`/`attachment.delete`, tenant-scoped, and persisted in the `miniodata` volume.
- **Not built yet:** transaction matching, bank reconciliation, reporting exports/dashboards, AI agent/approvals.

## Design sample (`ui/`)
- Static, no build step, no framework. Shared `styles.css`, `app.js`, `favicon.svg`; pages: `index.html` (Overview), `invoices.html`, `reconcile.html`, `reports.html`, `agent.html` (Clerk).
- Open `ui/index.html` directly, or serve it: `cd ui && python3 -m http.server 8000`.
- This is a visual/demo artifact, not the production frontend. Data is hardcoded in `app.js` and interactions are mock-only; do not wire it to APIs or expand its functionality unless asked.
- Preserve the design direction: working name **Daybook**, agent persona **Clerk**. Tokens live at the top of `styles.css` (pale sage paper, deep ledger-green spine, red-ink margin rule); type is Petrona for display/figures and Familjen Grotesk for UI. The signature is the three-column spine / ledger / clerk-margin layout, ruled tables, and double-rule totals. Avoid cards, gradients, and the generic SaaS dashboard kit.
- The sample covers Overview, invoices, bank reconciliation, reports, and the clerk workspace. It does not cover auth, bills/AP, projects, or settings. Its mock data (Acme Services Co., invoices, reports) is illustrative; real seed data is defined by Requirements §7 and the current `seed.ts`.
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
- MinIO is live for attachments; Redis remains defined in Compose but unused until the agent slices. Target remains: `docker compose up` → seed → log in.

## Seed accounts (§7)
- `owner@acme.test`, `accountant@acme.test`, `staff@acme.test`, `viewer@acme.test`; `owner@nimbus.test`, `accountant@nimbus.test`.
- Password `Passw0rd!2026`; local/demo only, rotate before any non-local use.
- Current seed: default chart (now includes purchase tax receivable `1300`), customers/items, vendors, mixed-state invoices, estimates, and bills (draft/open, including overdue), plus opening-balance journals.
- Not seeded yet: customer/bill payments, quick expenses, attachments, bank accounts/imported bank activity, categorization rules, the reconciled bank CSV period, and agent cron jobs. Those belong to later slices.
- Seed is idempotent and safe to rerun. Rerun it after pulling 013 so existing databases gain account `1300`.

## Testing
- Backend: Jest behavior tests through public HTTP (`npm --prefix backend test`, in-process against local Postgres). E2E: `npx playwright test` (system Chrome) against the running Compose stack; one spec per flow, added at the end of each issue.
- As of 018: backend **117 passed / 21 suites**, Playwright **18 passed**. Rerun both after each change; do not trust stale counts.
- Flows (§8): auth + cross-tenant isolation, RBAC, invoice lifecycle, expense/bill lifecycle, bank import + reconcile/undo, reporting totals, agent prompt/cron/event, approval.
- Tenancy + RBAC tests must hit the API directly, not only the UI.
- Jest runs with `maxWorkers: 1` and Playwright `workers: 1`: both mutate the same database. Never run them concurrently.
- E2E specs clean up their own fixtures. Delete child rows (journal lines/entries, bill/invoice lines/applications) before parents, and never delete seed rows. Remove `test-results/` before committing.

## Gotchas
- Gemini free tier may use prompts/responses to improve Google products; synthetic data only until a billed project is approved.
- `User-flows.html` must be one static file with no build step.
- New features stay tenant-scoped, audited, and free of hard-coded industry terms.
- Dates that represent calendar days are `@db.Date`; store/parse them as UTC midnight (`toDate`, ISO `YYYY-MM-DD` slices). Do not let local timezones shift bill/invoice/aging boundaries.
- Money is Prisma `Decimal(14,2)`; never do ledger math in JS floats. Quantities/rates are Decimal and line amounts round to 2 dp.
- Per-org document numbers are allocated by querying the highest existing suffix and retrying unique collisions; preserve that pattern for new document types.
- Migrations must stay chronologically ordered by filename: invoices (11:30) → estimates `20261114113500_estimates` → payments `20261114114014_customer_payments` → vendors/bills `20261114120750_vendors_bills` → bill payments `20261115164901_bill_payments` → expenses `20261115222500_expenses` → attachments `20261115233000_attachments` → banking `20261116001000_banking` → categorization rules `20261116011500_categorization_rules`. Renaming a migration requires a matching remote delete when pushing, and fresh shadow-DB `migrate deploy` must still succeed.
- MinIO: the backend container reaches `minio:9000`, while presigned URLs use `MINIO_PUBLIC_ENDPOINT=localhost:9000` so the browser can fetch them. The bucket is auto-created on first upload. Jest uses the in-memory `AttachmentStore` (`ATTACHMENT_DRIVER=memory`); Playwright uses real MinIO, so `minio` must be running and files persist in `miniodata`.
- Bank imports are signed cash movement: positive is money in, negative is money out. Rule priority is ascending (0–1000; lower first), ties break by `createdAt` then id; imports post `BANK` journals with `sourceId` = transaction id, so duplicate imports cannot double-post. Rule edits/deletes never recategorize existing transactions. CSV mapping is required when headers are ambiguous; OFX fields are standard. Dates normalize to UTC midnight. Never move CSV/OFX parsing into the frontend.
- Playwright label/heading selectors are ambiguous across drawers and tables; use `{ exact: true }`, `{ level: 1 }`, or scope to a region. `Payments` also matches `Bill payments`. Wait for drawers to finish animating before screenshots; close them with `Escape`.
