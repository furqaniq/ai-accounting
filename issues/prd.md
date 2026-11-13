# PRD — AI-Native Accounting Platform (MVP)

Source of record: `Requirements.md` (v0.1, 2026-11-13). This PRD translates that spec into an actionable build plan.

## Problem Statement

Small-business owners and their bookkeepers must stitch together disconnected tools to record sales, track expenses, import bank activity, reconcile accounts, and produce financial reports. The work is repetitive and error-prone, and the "AI" in incumbent products is usually a read-only chat assistant or a narrowly scoped, tier-gated feature. Users cannot simply tell the product what to do and trust it to execute the task safely. At the same time, accountants and auditors need assurance that automation is scoped to the right company, permissioned correctly, reviewable, and reversible.

## Solution

A cloud, multi-tenant accounting platform covering the core "record → categorize → reconcile → report → get paid" loop, with an AI Agent that actually executes tasks across three invocation modes — user prompts, scheduled cron jobs, and domain-event triggers — all backed by one backend tool registry. Every action the agent takes is validated, permission-checked, tenant-scoped, and logged in a separate immutable agent log. Financially sensitive actions (for example, paying a bill) default to propose-then-approve, and users can inspect, pause, edit, or delete automations. The product is industry-neutral and demo-ready: one Docker Compose startup, seeded orgs/accounts, and a Playwright suite proving the key flows.

## User Stories

### Identity, tenancy, and access
1. As a returning user, I want to sign in with email and password, so that I can access my organization's books securely.
2. As a signed-in user, I want short-lived access tokens plus refresh tokens, so that my session is secure without constant re-login.
3. As a user who belongs to more than one organization, I want to switch the active organization, so that I can work across separate businesses or clients.
4. As a user, I want to see only the data of the organization I am currently acting in, so that another tenant's records can never leak into my views or API responses.
5. As an Owner, I want to add users to my organization and assign them roles, so that the right people get the right access.
6. As an Owner or Admin, I want to configure organization name, fiscal year start, base currency display, and default tax rate, so that reports and forms match my business.
7. As a Viewer/Auditor, I want read-only access to records and reports, so that I can audit the books without risk of changing them.
8. As an Admin, I want to review an audit log of user actions (who, what, when, which record), so that changes are traceable.
9. As a user with a role that lacks a permission, I want clear denial when I attempt a restricted action, so that I understand my access limits.
10. As an Owner, I want assurance that cross-organization access is blocked at the data layer, not only in the UI, so that isolation is dependable.

### Chart of accounts and general ledger
11. As an Accountant, I want a default industry-neutral chart of accounts seeded when an organization is created, so that I can start recording transactions immediately.
12. As an Accountant, I want to add, edit, and deactivate accounts while preserving historical postings, so that the chart evolves without corrupting history.
13. As an Accountant, I want to post manual double-entry journal entries that must balance before saving, so that the ledger stays correct.
14. As an Accountant, I want to view an account register with drill-down to source transactions, so that I can investigate balances.
15. As an Accountant, I want invoices, bills, expenses, and payments to post balanced journal lines automatically, so that subsidiary records and the general ledger always agree.

### Sales (accounts receivable)
16. As a Staff user, I want to create and edit customers with contact details and see their balance, so that I can manage relationships and collections.
17. As a Staff user, I want to maintain a generic item/product-and-service catalog (name, price, income account, taxable flag), so that invoices can be built quickly and consistently.
18. As a Staff user, I want to create estimates/quotes with line items, so that I can propose work before invoicing.
19. As a Staff user, I want to convert an estimate into an invoice without re-entering lines, so that accepted work becomes billable quickly.
20. As a Staff user, I want to create invoices with line items, tax, and due dates, so that I can bill accurately.
21. As a Staff user, I want invoice status to move through Draft, Sent, Partial, Paid, and Overdue automatically, so that I always know where each invoice stands.
22. As a Staff user, I want to mark an invoice as sent, so that the customer-facing state is reflected in the system.
23. As a Staff user, I want to export an invoice as a PDF, so that I can share it with a customer.
24. As a Staff user, I want to record a manual customer payment against one or more invoices, so that cash receipts are reflected.
25. As a Staff user, I want partial and full payments to update invoice balances and statuses, so that AR is always accurate.
26. As an Accountant, I want an AR aging report with standard buckets, so that I can prioritize collections.
27. As an Accountant, I want to see overdue invoices and days overdue, so that follow-up is focused.
28. As an Accountant, I want sales by customer and sales by item reports, so that I can understand revenue drivers.

### Purchases (accounts payable)
29. As a Staff user, I want to create and edit vendors with contact details and see their balance, so that I can manage supplier obligations.
30. As a Staff user, I want to enter bills with line items, due dates, and status, so that supplier invoices are tracked.
31. As a Staff user, I want to record partial or full bill payments, so that AP balances stay accurate.
32. As a Staff user, I want a quick-expense form with category, vendor, and receipt attachment, so that small purchases are captured without full bill entry.
33. As an Accountant, I want an AP aging report, so that I can plan outgoing cash.
34. As an Accountant, I want expenses by category, so that spending is visible by type.

### Banking and reconciliation
35. As an Accountant, I want to create in-app bank and credit-card accounts, so that imported activity has a home.
36. As an Accountant, I want to import a bank CSV (and OFX where supported), preview column mapping, and confirm the import, so that I can simulate a bank feed without a paid aggregator.
37. As an Accountant, I want imported transactions listed with date, description, amount, and match state, so that I can work through them efficiently.
38. As an Accountant, I want to match an imported transaction to an existing invoice, bill, payment, or expense, so that books reflect reality without duplicate entry.
39. As an Accountant, I want to create a new expense, payment, or transfer directly from an unmatched transaction, so that unmatched activity can be resolved in place.
40. As an Accountant, I want to categorize a transaction directly to an account, so that simple items do not require full document creation.
41. As an Accountant, I want to define rules ("if description contains X, categorize as Y"), so that repeat transactions are handled consistently.
42. As an Accountant, I want rules applied during import with a preview of affected transactions, so that automation is predictable.
43. As an Accountant, I want to start a reconciliation session with a statement ending balance, so that I can prove the account agrees.
44. As an Accountant, I want to mark transactions cleared and see the difference between statement and book balances, so that I can find discrepancies.
45. As an Accountant, I want to complete reconciliation only when the session balances, so that incorrect reconciliations are prevented.
46. As an Accountant, I want to undo a completed reconciliation with an audit trail, so that mistakes can be corrected.

### Reporting and dashboard
47. As an Accountant, I want a Profit & Loss report for a date range, so that I can review income and expenses.
48. As an Accountant, I want a Balance Sheet as of a date, so that I can review financial position.
49. As an Accountant, I want a Cash Flow Statement, so that I can understand cash movements.
50. As an Accountant, I want a Trial Balance, so that I can verify debits equal credits.
51. As an Accountant, I want AR aging, AP aging, sales by customer/item, and expenses by category, so that I can answer common business questions.
52. As a user, I want CSV and PDF export of reports, so that I can share or archive results.
53. As an Owner, I want a dashboard with cash position, AR/AP totals, income-vs-expense trend, and recent activity, so that I get a quick health check.

### Projects and time (lightweight)
54. As a Staff user, I want to create projects and tag income, expenses, and time to them, so that I can assess project profitability.
55. As a Staff user, I want to enter time with hours, rate, and a billable flag, so that billable work is captured.
56. As a Staff user, I want to roll billable time into an invoice, so that time becomes revenue without manual re-entry.
57. As an Owner, I want a project profitability view, so that I can compare projects.

### Documents and attachments
58. As a Staff user, I want to attach receipts, bills, or statements to transactions, so that supporting documents live with the record.
59. As a user, I want attachments stored in self-hosted object storage and downloadable later, so that files survive container restarts and are not tied to a single machine.

### AI Agent
60. As a user, I want to ask natural-language questions about my organization's data (for example, "what was my cash flow last month?"), so that I can get insight without building a report.
61. As a user, I want to issue a natural-language command (for example, "create an invoice for Acme for 10 hours at $150/hr, due in 30 days"), so that the agent performs the task rather than only describing it.
62. As a user, I want the agent to show which tool it will call and with what arguments before a sensitive action executes, so that I stay in control.
63. As an Owner or Admin, I want to configure per action type whether the agent auto-executes or requires approval, so that risk matches policy.
64. As an approver, I want pending agent proposals listed with inputs and rationale, so that I can approve or reject them.
65. As an approver, I want an approved action to execute exactly once and a rejected action to remain unexecuted, so that outcomes are deterministic.
66. As a user, I want to create a scheduled automation (for example, "every Monday at 9am, email me a cash flow summary"), so that recurring work happens automatically.
67. As a user, I want to pause, edit, or delete any automation, so that I can control what runs on my behalf.
68. As a user, I want domain events (new bank transaction, invoice overdue, bill above a threshold, reconciliation discrepancy) to trigger configured automations, so that the books react without manual polling.
69. As an Owner, I want the agent to be able to register a new cron or trigger automation through a governed tool, so that repeated manual tasks can be turned into automations.
70. As a user, I want every agent action logged with trigger source, tool calls, inputs/outputs, acting user, and approval status, so that autonomous behavior is fully reviewable.
71. As a user, I want to see an "agent is busy, retrying" state instead of a hard failure when the model is rate-limited, so that demos and real work degrade gracefully.
72. As an auditor, I want the agent to be unable to read or write another organization's data, even if prompted to, so that tenant isolation holds for automation too.
73. As a security owner, I want the agent to be unable to run raw SQL or free-form code, so that the blast radius of a bad model output is limited to vetted tools.
74. As a developer, I want the model provider to be swappable without rewriting tool-calling logic, so that we are not locked into one free-tier provider.
75. As a user, I want a live slash-command menu in the agent prompt (`/model`, `/cron`, `/event`), so that I can switch models or start a routine without leaving the conversation.

### Demo, deliverables, and usability
76. As a demo user, I want one command to start the full stack, seed the data, and log in, so that the product can be shown reliably.
77. As a demo user, I want two seeded organizations with realistic mixed-state records, so that I can see the product working on first login.
78. As a demo user, I want a pre-configured agent automation in each org, so that the differentiator is immediately visible.
79. As a client reviewer, I want a single static `User-flows.html` file diagramming key flows, so that I can walk through the product without a build step.
80. As a developer, I want a Playwright suite covering the documented flows, so that regressions in critical paths are caught.
81. As a user on a desktop or tablet, I want a usable responsive interface, so that I can work on common screen sizes.
82. As any user, I want generic labels and no industry-specific jargon, so that the product fits any small business.

## Implementation Decisions

### Architecture and boundaries
- Monorepo with two deployables: a Next.js App Router frontend and a NestJS backend, plus Playwright tests at the root. PostgreSQL is the system of record; Redis/BullMQ provides scheduling and async execution; MinIO stores attachments.
- All API traffic is versioned REST under a single backend base path. The active organization is transmitted per request (validated against the caller's memberships on every request) and is never trusted from the client without a membership check.
- Tenant scoping is a cross-cutting concern enforced in one place at the data-access layer, so feature modules cannot accidentally omit it. Raw Prisma access outside that layer is discouraged; code review should reject queries without organization scoping.
- Immutable logs: user actions write `AuditLogEntry`; agent activity writes `AgentActionLog`. Neither is updated or deleted; corrections are appended.
- Secrets and configuration come from environment variables. `GEMINI_API_KEY` and other credentials are never committed.

### Deep modules (build and test in isolation)
- **TenantContext / ScopedDataAccess** — encapsulates organization resolution, membership validation, and automatic query scoping behind a small interface. All feature services depend on it rather than composing tenant filters themselves. This is the primary isolation guarantee.
- **LedgerEngine** — encapsulates double-entry validation, journal posting, reversal, and account-balance derivation behind `post`, `reverse`, and `balance`. Sales, purchases, banking, and projects all post through it; reports read from its output.
- **BankingImportEngine** — encapsulates file parsing (CSV and OFX), column/field mapping, normalization, duplicate detection, and rule application behind a single import call. The UI never parses files.
- **MatchingEngine** — encapsulates candidate retrieval and scoring for transaction-to-record matches behind `suggest`. Reconciliation and the agent both consume it.
- **ReconciliationSession** — a state machine covering start, mark-cleared, complete, and undo, with invariants (cannot complete unbalanced; cannot mutate a completed session except via undo).
- **ToolRegistry** — the single source of agent capabilities. It owns tool schemas, handler dispatch, role/permission checks, argument validation, tenant scoping, and the execute-vs-propose policy. Adding a capability means registering one tool, not editing the orchestrator.
- **AiProviderService** — provider-agnostic wrapper exposing `generate` and `callWithTools`. Only this module knows about Gemini-specific request/response shapes and rate-limit errors.
- **ApprovalService** — encapsulates pending-proposal creation, approval/rejection, single-execution guarantees, and status transitions.
- **AutomationService / Scheduler** — encapsulates cron and event automation definitions, repeatable-job registration, pause/edit/delete, and event-to-automation routing.
- **ReportingEngine** — encapsulates report assembly from ledger and subledger data behind named report methods, shared by REST endpoints and agent tools.
- **AttachmentStore** — encapsulates MinIO presigned upload/download, metadata, and deletion so no feature module talks to object storage directly.

### Module surface (major units)
- Identity and access: Authentication, Organization/Membership, RBAC, Audit.
- Accounting core: Chart of Accounts, Ledger, Period/date handling.
- Subledgers: Customers/Items/Estimates/Invoices/Payments; Vendors/Bills/BillPayments/Expenses; Projects/TimeEntries.
- Banking: BankAccounts, BankTransactions, Import, Rules, Matching, Reconciliation.
- Reporting: report generators, export, dashboard aggregates.
- Documents: attachments.
- Agent: AiProvider, ToolRegistry, Orchestrator, Queue worker, Automations, Approvals, Agent log.
- Platform: seed, health, configuration.

### Agent tool surface (initial)
Read-only/insight: `insight.query`, `report.generate`.
Sales: `invoice.create`, `invoice.send`, `invoice.markPaid`.
Purchases: `expense.create`, `bill.create`, `bill.pay`.
Banking: `transaction.categorize`, `transaction.match`, `reconciliation.start`, `reconciliation.suggestMatches`, `reconciliation.complete`.
Collections: `reminder.draftOverdueEmail`, `reminder.send`.
Automation: `automation.create`.
Each tool declares its argument schema, required permission, and default execution policy (auto vs approve). The agent never receives a database handle or code-evaluation capability.

### Execution flow (all three modes)
1. A trigger arrives: a prompt in chat, a BullMQ repeatable cron tick, or a domain event emitted by a feature service.
2. The orchestrator loads the tenant context and the role-filtered tool list.
3. The provider is called with the prompt/event context and the tool declarations.
4. The model returns text and/or tool calls; the backend validates each call against the tool schema.
5. The policy layer classifies the action as execute-now or pending-approval.
6. Execution happens through the registered handler using the acting user's permissions and tenant scope, or a pending `AgentActionLog` entry is created.
7. The outcome, inputs, outputs, trigger source, actor, and status are appended to the agent log. Prompt responses surface the relevant log reference.

### Agent composer and slash commands
- The agent prompt is the primary entry point. Typing `/` at the start of the composer opens a live, keyboard-navigable menu filtered by prefix; Arrow keys move, Enter selects, and Escape dismisses.
- `/model` opens a model selector and applies the chosen alias to subsequent prompt jobs in the current session. The alias is validated server-side against an allowlist; it does not silently change saved automations.
- `/cron` opens the new-automation form preset to schedule mode; `/event` opens it preset to event mode. Both submit through the existing automation CRUD path and `automation.create` policy, so the client cannot execute a routine directly.
- Slash commands only prefill or route UI state. Every execution still passes through ToolRegistry validation, permission checks, tenant scoping, and the approval policy.
- The composer uses the red-ink accent for a thickened, gently pulsing border; the pulse is disabled under reduced-motion preferences.

### Queue and rate-limit behavior
- All agent work runs in BullMQ workers, never synchronously in the HTTP request. Chat requests enqueue a job and return a handle/stream state.
- Jobs use exponential backoff with jitter and a bounded attempt count. Provider `429 RESOURCE_EXHAUSTED` is treated as a retryable condition, surfaced to the UI as a busy/retry state rather than a terminal error.
- Repeatable jobs are keyed by automation ID so editing an automation replaces its schedule rather than duplicating it.

### Data model (new schema)
- `Organization` (name, fiscal year start, base currency display, default tax rate).
- `User` and `OrgMembership` (user, organization, role), with a user able to hold roles in multiple organizations.
- `Account` (organization, code, name, type, subtype, active), `JournalEntry` (organization, date, memo, source type/id), `JournalLine` (entry, account, debit, credit).
- `Customer`, `Vendor`, `Item` (organization-scoped, contact/catalog fields, balance derivations).
- `Estimate`/`EstimateLine`, `Invoice`/`InvoiceLine`, `Bill`/`BillLine`, `Expense`, `Payment` (direction/type, applied-to references), with status fields and organization scope.
- `BankAccount` (linked ledger account), `BankTransaction` (imported date, description, amount, match state, categorized account), `ReconciliationSession` (account, period, statement balance, status), `CategorizationRule` (match criteria and target account).
- `Project`, `TimeEntry` (hours, rate, billable, invoice linkage).
- `Attachment` (organization, related record, object key, content type, size).
- `AuditLogEntry`, `AgentAutomation` (mode, schedule or event definition, tool config, enabled), `AgentActionLog` (trigger, tools, input/output, actor, approval status, error).
- Every business table carries `organizationId`; composite indexes include it. Log tables are append-only and include actor/trigger metadata.

### API contracts (behavioral)
- Auth: login, refresh, logout, current-session.
- Organizations: list my organizations, switch active org context, read/update settings, manage members and roles.
- CRUD and lifecycle endpoints for accounts, journal entries, customers, items, estimates, invoices, payments, vendors, bills, bill payments, expenses, projects, time entries, bank accounts, bank transactions, rules, reconciliations, and attachments.
- Reporting endpoints accept date/as-of filters and return structured totals plus export variants.
- Agent endpoints: chat/prompt submission, job status, agent log listing/detail, automations CRUD and pause/resume, pending approvals list, approve/reject. Prompt submission accepts an optional model alias from a server-side allowlist; the default comes from organization configuration and unknown aliases are rejected.
- Every non-auth endpoint requires authentication, resolves the active organization, and enforces the role requirement declared by the handler. Mutating endpoints validate DTOs and reject unknown fields.

### Seed and demo
- Seed script creates the two organizations, the full role set, default chart of accounts, customers/vendors/items, invoices/bills in varied states, a reconciled bank CSV period, and one agent cron automation per organization.
- Seed credentials are documented as local/demo only and must be rotated before any non-local deployment.
- Startup target: `docker compose up` brings up frontend, backend, PostgreSQL, Redis, MinIO, and optionally Adminer; a seed step then enables login with the documented accounts.

### Testing hooks
- The backend exposes a test-only mechanism to trigger cron automations and domain events without waiting for real time, guarded so it is disabled outside test/demo environments.
- The stack must be runnable locally with the same compose topology used by tests.

## Testing Decisions

A good test asserts externally observable behavior: HTTP responses from the API, persisted records, ledger/report totals, and UI outcomes. Tests should not assert private helper calls, internal query shapes, or implementation-specific class structure. Fixtures come from the deterministic seed plus per-test creation through public APIs.

Modules to test in isolation (Jest, backend):
- TenantContext/ScopedDataAccess: an organization A caller can never read or mutate organization B rows, including when IDs are supplied directly.
- LedgerEngine: unbalanced entries are rejected; balanced entries post expected lines; reversals restore balances; account balances and trial balance agree.
- BankingImportEngine: CSV/OFX parsing, mapping, duplicate handling, and rule application produce normalized transactions.
- MatchingEngine: suggestions are ranked sensibly and never cross tenant boundaries.
- ReconciliationSession: cannot complete while unbalanced; undo restores prior state; completed sessions reject direct mutation.
- ToolRegistry: schema validation rejects bad args; permission checks reject disallowed roles; tenant scope is injected; policy routing sends sensitive tools to approval.
- AiProviderService: model aliases are validated against an allowlist; unknown aliases are rejected and defaults resolve from configuration.
- ApprovalService: approval executes exactly once; rejection does not execute; concurrent approval attempts are safe.
- ReportingEngine: P&L, balance sheet, cash flow, trial balance, and aging totals reconcile against seeded ledger data.
- AttachmentStore: presigned upload/download lifecycle and metadata persistence (with MinIO available or an isolated test double).

End-to-end (Playwright, against the Dockerized stack, one spec per flow):
- Auth and cross-tenant isolation, including direct API attempts.
- RBAC enforcement for Staff and Viewer restrictions.
- Invoice lifecycle from estimate through payment and AR aging.
- Expense with receipt upload, plus bill creation/payment and AP aging.
- Bank import, matching/categorization, reconciliation completion, and undo.
- Reporting totals against seeded data.
- Agent prompt mode: correct tool executes and appears in the UI and agent log.
- Agent cron mode: automation created and triggered via the test hook, then verified.
- Agent event mode: event fired, expected proposal/action produced and logged.
- Agent composer slash commands: live prefix filtering and keyboard selection; `/cron` and `/event` preset the correct automation mode; `/model` changes the model for the next prompt; commands still enforce the same tool and permission path.
- Approval flow: propose-then-approve action stays pending until explicitly approved.

Prior art: this is a greenfield repo, so there is no existing test suite to mirror. The shared seeded fixture and the flow list in Requirements.md §8 are the baseline; new specs should reuse the seed accounts rather than inventing parallel fixtures.

## Out of Scope

- Live bank-feed aggregation (Plaid/Yodlee-style); MVP uses manual CSV/OFX import.
- Real payroll processing, tax calculation/filing/remittance, and real payment processing (Stripe/ACH); these may be stubbed but not functional.
- Multi-currency and localization/i18n.
- Inventory valuation (FIFO/LIFO), COGS automation, BOM, and manufacturing features.
- Native mobile apps.
- Forecasting and what-if scenario modeling beyond what the agent can approximate from history.
- Parallel/multi-step approval workflows and accountant-firm multi-client portals.
- Public API/marketplace and third-party integrations.
- Billing/subscription tiering; the agent is ungated in the MVP.
- Real-time collaboration or presence features.

## Further Notes

- Assumptions carried from Requirements.md §10 that should be confirmed: single currency/locale; bank feed means CSV/OFX import; Gemini free tier is acceptable for synthetic demo data; "industry neutral" means generic labels only; the five listed roles are sufficient (no separate Approver role).
- Gemini free-tier terms may allow prompt/response content to be used to improve Google products. Use synthetic/seeded data only until a billed project or alternative provider is approved.
- The agent must degrade gracefully under free-tier rate limits; the UI should make retry behavior visible rather than appearing broken.
- Deliverables alongside the code: `README.md` with the clone → compose up → seed → login path, and `User-flows.html` as a single static file with no build step.
- Open question to confirm before build: whether an explicit Approver role is needed in MVP or whether Owner/Admin approve agent proposals.
- Recommended next steps after PRD approval: scaffold the monorepo and compose stack, implement TenantContext + auth + RBAC first, then LedgerEngine, then subledgers and banking, then reporting, then the agent tool registry and its three modes, with tests added alongside each module.
