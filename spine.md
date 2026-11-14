# Spine — build progress

Living progress record for the Daybook build. Source of truth remains `Requirements.md` → `issues/prd.md` → `issues/NNN-*.md`; this file only records *where we are*. Update it whenever an issue starts, finishes, or is blocked — never let it drift from reality.

## Per-issue workflow (every issue, in number order)

1. **Pick**: lowest-numbered issue whose `Blocked by` is satisfied. Pause at HITL gates (001, 029, 036) for client approval before proceeding.
2. **TDD** (use the `tdd` skill): turn the issue's acceptance criteria into an ordered list of *behaviors*; confirm priorities with the client when it matters. Then one vertical slice at a time — RED (one behavior test) → GREEN (minimal code) → repeat. Refactor only after GREEN. Tests assert behavior through public interfaces (HTTP responses, persisted records, ledger/report totals, UI outcomes), never internals; they must survive refactors.
3. **Playwright at the end of the issue**: add/extend the issue's flow spec in the root Playwright suite (`tests/e2e/`), run `npx playwright test` green against the Dockerized stack, and record the passing specs in the log. Issue 001 creates the Playwright setup; issue 035 is the full regression sweep.
4. **Commit + push with composio-cli** (never a bare `git push`; the folder is not a git repo yet):
   - First push only: create the repo — `composio execute GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER -d '{ name: "<name>", private: true, auto_init: true }'` (confirm name/visibility with the client).
   - Every completion: `composio execute GITHUB_COMMIT_MULTIPLE_FILES -d '{ owner, repo, branch: "main", message: "NNN <issue title> — <tests green>", upserts: { "<path>": "<content>", ... }, deletes: [...] }'` carrying **all** changed files. Verify the returned commit before marking done; never claim pushed otherwise.
5. **Close out**: set the issue to `done` below and append a log row (date · issue · what shipped · test evidence · push ref).

## Status

| # | Issue | Type | Status |
| --- | --- | --- | --- |
| 001 | walking-skeleton | HITL | done — approved by client |
| 002 | tenant-isolation-org-switching | AFK | done — approved, 003 in progress |
| 003 | members-rbac | AFK | done — awaiting go-ahead for 004 |
| 004 | org-settings-audit-log | AFK | not started |
| 005 | chart-of-accounts | AFK | not started |
| 006 | manual-journals-register | AFK | not started |
| 007 | customers-items | AFK | not started |
| 008 | invoices | AFK | not started |
| 009 | estimates-to-invoice | AFK | not started |
| 010 | invoice-pdf | AFK | not started |
| 011 | customer-payments | AFK | not started |
| 012 | ar-aging | AFK | not started |
| 013 | vendors-bills | AFK | not started |
| 014 | bill-payments-ap-aging | AFK | not started |
| 015 | quick-expenses | AFK | not started |
| 016 | attachments | AFK | not started |
| 017 | bank-import | AFK | not started |
| 018 | categorization-rules | AFK | not started |
| 019 | match-transactions | AFK | not started |
| 020 | resolve-unmatched-transactions | AFK | not started |
| 021 | reconciliation-workbench | AFK | not started |
| 022 | complete-undo-reconciliation | AFK | not started |
| 023 | financial-statements | AFK | not started |
| 024 | sales-expense-reports | AFK | not started |
| 025 | report-export | AFK | not started |
| 026 | dashboard | AFK | not started |
| 027 | projects-time-profitability | AFK | not started |
| 028 | agent-prompt-foundation | AFK | not started |
| 029 | agent-write-approvals | HITL | not started |
| 030 | approval-policy | AFK | not started |
| 031 | scheduled-automations | AFK | not started |
| 032 | event-automations | AFK | not started |
| 033 | slash-commands | AFK | not started |
| 034 | demo-seed | AFK | not started |
| 035 | playwright-regression | AFK | not started |
| 036 | user-flows-qa | HITL | not started |

## Log

| Date | Issue | Shipped | Tests | Push |
| --- | --- | --- | --- | --- |
| 2026-11-13 | Planning | Spec reconciled; PRD derived; 36 issue slices written; AGENTS.md + this spine | — | initial planning commit |
| 2026-11-13 | 001 | Walking skeleton: 6-service Compose stack, NestJS+Prisma JWT auth (login/refresh/logout/me, refresh rotation), seeded owner, Daybook login page + three-column shell, README/env examples | Jest 7 passed (health + auth); Playwright 2 passed (login/session/wrong-password) | github.com/furqaniq/ai-accounting |
| 2026-11-13 | 001 | Shell aligned to the `ui/` design sample per HITL feedback: `styles.css` ported as the app stylesheet, Overview markup (spine/topbar/clerk margin), drawers, toasts, favicon | Playwright 2 passed after restyle | github.com/furqaniq/ai-accounting |
| 2026-11-14 | 001 | Login polish per HITL feedback (3 rounds): editorial split layout (ruled ledger-green panel + red-ink margin rule + pale-paper form), Daybook tile logo, demo-account picker (6 seed logins, click-to-fill), copy tightened to "Today's page awaits." | Playwright 3 passed (login/session, wrong-password, demo-picker) | github.com/furqaniq/ai-accounting |
| 2026-11-14 | 001 | HITL approved after 4 polish rounds (login composition, demo-account picker, card-free ledger grid, left margin rule) | Playwright 3 passed | github.com/furqaniq/ai-accounting |
| 2026-11-14 | 002 | Tenant isolation: TenantContext + ScopedDataAccess, `GET /organizations/active`, tenant-scoped `GET /memberships` and `GET /memberships/:id` (404 cross-tenant), seed of 6 §7 accounts across Acme/Nimbus with owner@acme dual-membership, real org switcher with server-resolved role + member count | Jest 17 passed (10 tenant + 7 auth); Playwright 4 passed (org switching) | github.com/furqaniq/ai-accounting |
| 2026-11-14 | 003 | Members & RBAC: role→permission matrix enforced in `JwtAuthGuard` via `@RequirePermission` (owner/admin manage; accountant/staff/viewer read-only), `POST/PATCH/DELETE /memberships` with unknown-user 404, duplicate 409, last-owner 400, `AuditLogEntry` model + request-scoped `AuditService` recording membership.create/role_change/delete, tenant-scoped `GET /audit-log` guarded by `audit:read`, ledger-styled members drawer with role selects, add form and remove; read-only view for non-managers | Jest 30 passed (13 members + 10 tenant + 7 auth); Playwright 5 passed (members drawer + org switching + login) | github.com/furqaniq/ai-accounting |

## Open items

- Client asked to confirm before starting each next issue; 003 complete, 004 (org-settings-audit-log) awaiting go-ahead.
- Test fixtures normalize seed roles in `members.spec.ts` `beforeAll` (direct Prisma cleanup of test-added memberships); revisit if a fixtures helper lands in 034.
