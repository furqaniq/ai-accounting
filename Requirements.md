# Requirements.md
## AI-Native Accounting Platform — MVP Requirements

**Version:** 0.1 (Draft)
**Date:** 2026-11-13
**Status:** For review before build starts

---

## 1. Purpose & Vision

Build a **polished, industry-neutral MVP** of a cloud accounting platform that lets any client see and click through core bookkeeping workflows, differentiated by a built-in **AI Agent** that can execute accounting tasks via (a) natural-language prompts, (b) scheduled/cron jobs, and (c) event triggers — not just "chat about your data" like most incumbents, but actually **perform** the action.

The product must work for *any* SMB (retail, services, agency, consulting, etc.) — no industry-specific fields, workflows, or terminology baked in.

---

## 2. Competitive Research Summary

Research covered QuickBooks Online (primary benchmark), Xero, Zoho Books, Wave, and FreshBooks (Nov 2026 snapshot). Key takeaways used to shape the feature list below:

### 2.1 QuickBooks Online (benchmark)
- Core pillars: chart of accounts/general ledger, invoicing, bank feeds & reconciliation, expense tracking, financial reporting, bill pay, payroll (add-on), inventory, and project profitability — these are its most-used and highest-rated features.
- Reconciliation and bank-feed matching are the most-iterated workflows in 2026 releases (improved matching windows, "undo reconcile" opened up to any admin, smarter categorization that "learns" from corrections).
- AI is branded **"Intuit Intelligence" / "Intuit AI"**, split into specialized agents: *Accounting AI* (categorization, reconciliation support, anomaly detection), *Payments AI* (invoice follow-up/dunning), *Customer AI*, *Project Management AI*, *Finance AI* (forecasting, what-if scenarios), *Payroll AI*, *Sales/Business Tax AI*.
- Notable AI capabilities: conversational business-intelligence chat ("what was my cash flow last month?"), auto-drafting invoices from source documents (SOWs/sales orders), a **user-buildable automation layer** ("tell it what you want done, then set a schedule" / templates like "send overdue reminders" or "flag duplicate bills"), and forecasting/what-if modeling.
- AI features are **gated by plan tier** (Simple Start gets basic categorization only; full agent suite is Advanced/Enterprise) — a gap our MVP can intentionally avoid by making the agent a first-class, ungated part of the product.
- Weaknesses reported by users: feature-gating confusion across tiers, rising subscription cost, occasional reliability/instability complaints, no manufacturing-grade inventory (BOM, shop floor).

### 2.2 Xero
- Every plan includes **unlimited users** (vs. QuickBooks' per-plan user caps) — a structural pricing/access advantage worth noting even if not an MVP blocker.
- Strong multi-currency support and a clean, frequently praised bank-reconciliation UI.
- Large third-party app ecosystem; dominant in AU/NZ/UK markets.

### 2.3 Zoho Books
- Free tier for businesses under $50K annual revenue; cheaper than QuickBooks at every paid tier.
- Deep integration with the broader Zoho One suite (CRM, inventory, etc.) — a differentiator for businesses wanting one vendor for everything, but a complexity trade-off vs. a focused accounting tool.
- Strong footprint in India/Middle East/emerging markets; multi-currency is a selling point.

### 2.4 Wave & FreshBooks (secondary reference)
- Wave: zero-cost core accounting/invoicing, monetized via payment processing — validates that a lean, free-feeling core product is a viable MVP posture.
- FreshBooks: strongest for service/freelance billing, time tracking, and proposals — reinforces that **invoicing + time + expenses** is the minimum credible loop for a services-oriented demo persona.

### 2.5 Implication for our MVP
No competitor positions its AI as a **general-purpose agent that executes tasks on prompt, on a schedule, and on events, across the whole product surface, unlocked from day one**. QuickBooks is closest but gates it by tier and scopes each "agent" narrowly. This is our wedge: ship the modules above as functional basics, and make the **AI Agent** the one place we go deeper than anyone else.

---

## 3. Goals / Non-Goals

**Goals**
- Deliver a clickable, demoable MVP covering the full "record → categorize → reconcile → report → get paid" loop.
- Ship an AI Agent that can act (not just answer) across: prompt/chat, cron schedules, and event triggers.
- Keep the system **industry-neutral**: generic "Items/Products & Services", generic categories, no vertical-specific fields.
- Use **only free/open-source tooling** — no paid SaaS dependencies required to run or demo the MVP.
- Provide seeded test accounts covering distinct roles and two separate tenant organizations (to prove multi-tenant isolation).
- Provide an HTML artifact documenting user flows, and a Playwright test suite covering those flows.

**Non-Goals (explicitly out of scope for MVP)**
- Real bank-feed aggregation (Plaid/Yodlee-style live bank connections) — these are paid APIs. MVP uses **manual CSV/OFX import** to simulate bank feeds.
- Real payroll processing, tax filing/remittance, or payment processing (Stripe/ACH) — stubbed/mocked only.
- Native mobile apps.
- Multi-currency, inventory valuation methods (FIFO/LIFO), and manufacturing/BOM features.
- Localization/i18n (single locale, single currency display for MVP; data model should not actively block future multi-currency).

---

## 4. Feature List / Modules (MVP Scope = Phase 1)

### 4.1 Platform & Identity
- Multi-tenant organizations ("Companies"); a user can belong to multiple orgs with different roles.
- Auth: email/password (JWT access + refresh tokens), seeded demo accounts (no third-party IdP required for MVP).
- Roles & permissions (RBAC): **Owner, Admin, Accountant/Bookkeeper, Staff, Viewer/Auditor** (read-only).
- Org settings: name, fiscal year start, base currency (display-only), default tax rate.
- Audit log: who did what, when, on which record (including actions taken by the AI Agent).

### 4.2 Chart of Accounts & General Ledger
- Standard, industry-neutral default chart of accounts (Assets, Liabilities, Equity, Income, Expenses) seeded on org creation, editable.
- Manual journal entries (double-entry, must balance).
- Account registers / transaction drill-down per account.

### 4.3 Sales Side (AR)
- Customers (CRUD, contact info, balance).
- Items/Products & Services (generic catalog: name, price, income account, taxable flag).
- Estimates/Quotes → convert to Invoice.
- Invoices: line items, tax, due dates, status (Draft/Sent/Partial/Paid/Overdue), PDF export.
- Recording customer payments against invoices (manual/mock — no live payment gateway).
- AR Aging report; overdue tracking.

### 4.4 Purchases Side (AP)
- Vendors (CRUD, contact info, balance).
- Bills (vendor invoices): line items, due dates, status.
- Bill payments (manual/mock).
- Expenses: quick-entry expense with category, vendor, receipt attachment (file upload).
- AP Aging report.

### 4.5 Banking & Reconciliation
- Bank/Credit Card "accounts" in-app with manual CSV import of transactions (simulates a bank feed without a paid aggregator).
- Transaction matching UI (match imported transaction to existing invoice/bill/expense, or create new).
- Reconciliation workflow (statement ending balance vs. book balance, mark-cleared, undo reconcile).
- Rules engine: "if description contains X, categorize as Y" (user-defined, also usable by the AI Agent).

### 4.6 Reporting
- Profit & Loss (P&L), Balance Sheet, Cash Flow Statement, Trial Balance.
- AR/AP Aging, Sales by Customer/Item, Expenses by Category.
- Date-range filters, basic export (CSV/PDF).
- Simple dashboard: cash position, AR/AP totals, income vs. expense trend, recent activity.

### 4.7 Projects (lightweight)
- Generic "Project" entity to tag income/expenses/time for profitability view — kept industry-neutral (no job-costing verticals like construction phases).
- Basic time entry (hours, rate, billable flag) that can roll into an invoice.

### 4.8 Documents & Attachments
- File upload (receipts, bills, statements) attached to any transaction, stored in self-hosted object storage (MinIO).

### 4.9 AI Agent (the differentiator — see Section 5 for detail)
- Prompt/chat interface to invoke actions and ask questions.
- Scheduled tasks (cron-based).
- Event-triggered automations.
- Agent action log distinct from the general audit log (so every autonomous action is traceable and reviewable/approvable).

### 4.10 Deferred to Phase 2/3 (documented, not built in MVP)
- Payroll module (UI stub only: "Coming soon").
- Inventory with COGS/valuation methods.
- Multi-currency.
- Sales tax calculation engine & e-filing prep.
- Real bank-feed aggregation, real payment processing.
- Approval workflows (e.g., parallel bill approvals), accountant-firm multi-client portal.
- Forecasting/what-if scenario modeling (beyond what the AI Agent can approximate from historical data).
- Native mobile apps, marketplace/public API for third-party integrations.

---

## 5. AI Agent — Detailed Requirements

The Agent is a first-class module, not a chat widget bolted onto the UI. It must support three invocation modes against the **same underlying action/tool layer**:

### 5.1 Invocation Modes
1. **Prompt-driven (on-demand):** User types a natural-language instruction in a chat panel (e.g., *"Create an invoice for Acme Corp for 10 hours of consulting at $150/hr, due in 30 days"*, *"Reconcile my checking account for October"*, *"Show me which customers haven't paid in 60+ days and draft reminder emails"*).
2. **Cron-driven (scheduled):** User (or the agent itself, when it notices a repeated manual task) sets up a recurring job, e.g., *"Every Monday at 9am, email me a cash flow summary"*, *"On the 1st of each month, flag any uncategorized transactions from last month."*
3. **Event-driven (trigger-based):** Agent reacts to domain events, e.g., *on new bank transaction imported → suggest category*, *on invoice overdue by N days → draft/send reminder*, *on bill created above $X → flag for approval*, *on reconciliation discrepancy found → explain and propose fix*.

### 5.2 Agent Action/Tool Registry (backend-enforced, not purely prompt-based)
The NestJS backend exposes a fixed set of callable "tools" that the agent (and only the agent, under the acting user's permissions) can invoke — this keeps the agent's capabilities auditable and scoped, rather than letting an LLM generate arbitrary SQL/side effects. Example tool surface:
- `invoice.create`, `invoice.send`, `invoice.markPaid`
- `expense.create`, `bill.create`, `bill.pay`
- `transaction.categorize`, `transaction.match`
- `reconciliation.start`, `reconciliation.suggestMatches`, `reconciliation.complete`
- `report.generate` (P&L, Balance Sheet, Cash Flow, Aging)
- `reminder.draftOverdueEmail`, `reminder.send`
- `automation.create` (lets the agent register its own new cron/trigger job)
- `insight.query` (read-only natural-language Q&A over the org's data)

### 5.3 Safety & Control
- **Execution modes per action type:** *Auto-execute* vs *Propose-then-approve* (configurable per org/role; financial-impact actions like `bill.pay` default to approval-required).
- Every agent action is logged with: trigger source (prompt/cron/event), the tool(s) called, inputs/outputs, acting user context, and approval status.
- Users can view, pause, edit, or delete any scheduled/trigger-based automation.
- Agent is scoped to the current org's data only (tenant isolation enforced at the tool/data-access layer, not just in the prompt).

### 5.4 Model/Runtime (free-resource constraint)
- Default: **Google Gemini API, free tier**, via a Google AI Studio API key (no billing account attached). As of late 2026, Gemini Flash / Flash-Lite (and, where available, 2.5 Pro) are usable at no cost under the free tier; exact RPM/TPM/RPD quotas are per-project and shown live in the AI Studio rate-limit console rather than published as fixed numbers, so the backend must read errors/headers rather than hard-code a quota.
- `AiProviderService` abstraction in NestJS wraps the Gemini client behind a provider-agnostic interface (`generate()`, `callWithTools()`), so swapping to OpenAI/Anthropic/a self-hosted Ollama model later requires no change to the tool-calling logic above it.
- **Rate-limit handling (required, not optional):** the free tier will return `429 RESOURCE_EXHAUSTED` under load. All agent calls go through the BullMQ queue (not direct synchronous calls from the request handler) with exponential backoff + jitter and a visible "Agent is busy, retrying…" state in the UI, so a demo doesn't visibly break under light rate-limiting.
- **Data-use caveat (flag to client):** Google's free-tier terms allow prompt/response content to be used to improve Google's products. For a real accounting product this matters once real customer financial data is involved. For the MVP/demo this is acceptable (seeded/synthetic data only), but Section 10 flags this as a decision needed before any non-demo use — moving to a billed Gemini project (or swapping providers via the abstraction layer) removes that clause.
- Tool-calling/function-calling pattern unchanged: the model proposes a tool + arguments; the backend validates arguments against a schema (zod/class-validator) before execution — the model never executes free-form code or raw SQL directly.

---

## 6. Technical Architecture

### 6.1 Stack (all free/open-source)
| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, TanStack Query |
| Backend | NestJS (TypeScript), Prisma ORM, class-validator/class-transformer, Passport.js (JWT) |
| Database | PostgreSQL |
| Queue/Scheduler | Redis + BullMQ (cron jobs, event-triggered jobs, async agent tasks) |
| AI runtime | Google Gemini API (free tier, AI Studio key), provider-abstraction layer for future swap |
| File storage | MinIO (S3-compatible, self-hosted) |
| Testing | Playwright (E2E), Jest (unit/integration — ships with NestJS) |
| Containerization | Docker + Docker Compose, one service per container |
| Optional dev tooling | Adminer or pgAdmin (DB inspection), GitHub Actions (free CI minutes) |

### 6.2 Docker Compose Services
```
services:
  frontend   (Next.js, port 3000)
  backend    (NestJS, port 3001)
  postgres   (PostgreSQL 16, port 5432, named volume)
  redis      (Redis 7, port 6379)
  minio      (object storage, ports 9000/9001)
  adminer    (optional, DB admin UI, port 8080)
```
The LLM is no longer a local container — the backend calls the Gemini API over the internet using a `GEMINI_API_KEY` environment variable (free-tier key from Google AI Studio, no billing attached). Each remaining service has its own Dockerfile (frontend/backend) or official image (postgres/redis/minio), connected via a shared Docker network, with environment variables for all secrets/config (`.env`, never committed — including `GEMINI_API_KEY`).

### 6.3 High-Level Data Model (entities)
`Organization`, `User`, `OrgMembership(role)`, `Account` (chart of accounts), `JournalEntry`/`JournalLine`, `Customer`, `Vendor`, `Item`, `Invoice`/`InvoiceLine`, `Estimate`, `Bill`/`BillLine`, `Expense`, `Payment`, `BankAccount`, `BankTransaction`, `ReconciliationSession`, `CategorizationRule`, `Project`, `TimeEntry`, `Attachment`, `AuditLogEntry`, `AgentAutomation` (cron/trigger definitions), `AgentActionLog` (execution + approval status).

### 6.4 Non-Functional Requirements
- **Multi-tenancy:** every query scoped by `organizationId`; enforced at the service layer, tested explicitly (see Section 8).
- **Security:** hashed passwords (argon2/bcrypt), JWT short-lived access + refresh tokens, input validation on all DTOs, role guards on every endpoint, rate limiting on auth endpoints.
- **Auditability:** immutable audit log for user actions and a parallel log for agent actions.
- **Responsiveness:** usable on desktop and tablet widths at minimum.
- **Config-driven:** no hard-coded industry terms; all labels generic ("Items", "Customers", "Vendors").

---

## 7. Test User Accounts (seed data)

Two organizations are seeded to prove tenant isolation, each with the same role set:

| Organization | Email | Password | Role |
|---|---|---|---|
| Acme Services Co. | owner@acme.test | Passw0rd!2026 | Owner |
| Acme Services Co. | accountant@acme.test | Passw0rd!2026 | Accountant/Bookkeeper |
| Acme Services Co. | staff@acme.test | Passw0rd!2026 | Staff |
| Acme Services Co. | viewer@acme.test | Passw0rd!2026 | Viewer/Auditor (read-only) |
| Nimbus Retail LLC | owner@nimbus.test | Passw0rd!2026 | Owner |
| Nimbus Retail LLC | accountant@nimbus.test | Passw0rd!2026 | Accountant/Bookkeeper |

Each org is pre-seeded with: a default chart of accounts, a handful of customers/vendors/items, a few invoices/bills in varying states, a sample bank CSV import already reconciled through a prior period (so new users see realistic data on first login), and one pre-configured AI Agent automation (e.g., a weekly cash flow summary cron job) to demo on day one.

*(Seed credentials are for local/demo use only — must be disabled or rotated before any non-local deployment.)*

---

## 8. Testing Strategy (Playwright)

End-to-end suites, one spec file per flow, run against the Dockerized stack:
1. **Auth & tenancy:** login, logout, wrong-password handling, confirm Org A user cannot see Org B data via UI or direct API calls.
2. **RBAC enforcement:** Staff cannot access reports/settings reserved for Owner/Accountant; Viewer cannot create/edit anything.
3. **Invoice lifecycle:** create estimate → convert to invoice → send → record payment → appears correctly in AR aging/P&L.
4. **Expense & bill lifecycle:** create expense with receipt upload; create bill → pay bill → appears in AP aging.
5. **Bank import & reconciliation:** import sample CSV → match/categorize transactions → complete reconciliation → undo reconciliation.
6. **Reporting:** generate each report type, verify totals reconcile against seeded data.
7. **AI Agent — prompt mode:** issue a natural-language command, verify the correct tool executed and the resulting record appears in the UI and in the Agent action log.
8. **AI Agent — cron mode:** create a scheduled automation, fast-forward/trigger it (via test hook), verify it ran and logged correctly.
9. **AI Agent — event trigger mode:** trigger the underlying event (e.g., import a transaction, mark an invoice overdue), verify the automation fired and produced the expected proposal/action.
10. **Approval flow:** an action configured as "propose-then-approve" must appear pending and only execute after explicit approval.

---

## 9. Deliverables

1. This `Requirements.md`.
2. Dockerized monorepo (or two repos) with `docker-compose.yml` bringing up all services with one command.
3. Seed script populating the two demo organizations and accounts from Section 7.
4. Playwright test suite (Section 8) runnable via `npx playwright test` against the Dockerized stack.
5. **User-flows.html** — a single static HTML file (no build step required) diagramming the key flows from Section 8 for client walkthroughs, linking back to this requirements doc.
6. `README.md` with setup instructions (clone → `docker compose up` → seed → login with test accounts).

---

## 10. Open Questions / Assumptions (confirm before build)

1. Assume a **single currency, single locale** for MVP (per Non-Goals) — confirm acceptable for the demo audience.
2. Assume "bank feed" = manual CSV/OFX import, not a live bank connection (Plaid-equivalents are paid) — confirm this is acceptable for the client demo narrative.
3. Using the **Gemini API free tier** means: (a) no guaranteed fixed rate limit — the app must gracefully queue/retry under load, and (b) per Google's free-tier terms, prompt/response content may be used to improve Google's products. Both are fine for a synthetic-data demo; confirm this is acceptable, or we move to a billed Gemini project / different provider via the existing abstraction layer before any real customer data touches the agent.
4. Assume "industry neutral" means generic labels/fields only — no vertical-specific modules (e.g., no restaurant table management, no construction job-costing) in MVP.
5. Please confirm the five roles in Section 4.1/7 match what you want to demo (happy to add an "Approver" role if parallel-approval workflows should move into MVP scope rather than Phase 2).
