## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Build the ReportingEngine and the core financial statements from PRD §Reporting and dashboard: Profit & Loss for a date range, Balance Sheet as of a date, Cash Flow Statement, and Trial Balance. Reports read from ledger output, reconcile to subledger activity, and render in the Daybook report layout.

## Acceptance criteria

- [ ] P&L, Balance Sheet, Cash Flow, and Trial Balance endpoints accept the documented date/as-of filters and return structured totals.
- [ ] Trial Balance debits equal credits; Balance Sheet balances; report totals reconcile against seeded ledger and subledger data.
- [ ] Cash Flow uses defined cash/bank accounts and explains movements rather than duplicating the P&L.
- [ ] The reports UI supports tabs, date controls, account grouping, and drill-down where useful.
- [ ] ReportingEngine unit tests cover the four statements and edge cases (empty period, prior period).
- [ ] API and Playwright specs verify seeded totals and navigation; all reads are tenant-scoped.
- [ ] CSV/PDF export is delivered separately in `issues/025-report-export.md`.

## Blocked by

- Blocked by `issues/006-manual-journals-register.md`
- Blocked by `issues/008-invoices.md`
- Blocked by `issues/011-customer-payments.md`
- Blocked by `issues/013-vendors-bills.md`
- Blocked by `issues/014-bill-payments-ap-aging.md`
- Blocked by `issues/015-quick-expenses.md`
- Blocked by `issues/017-bank-import.md`

## User stories addressed

- User story 47
- User story 48
- User story 49
- User story 50
