## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Build the owner dashboard from PRD §Reporting and dashboard: cash position, AR and AP totals, income-versus-expense trend, and recent activity. Every figure comes from the reporting and subledger APIs, with links into the relevant records.

## Acceptance criteria

- [ ] Dashboard shows cash across bank accounts, AR total, AP total, an income/expense trend for a selectable period, and recent activity.
- [ ] Every value is derived from APIs rather than hard-coded sample data and is organization-scoped.
- [ ] Cards/rows link to the relevant report, invoice, bill, or transaction views.
- [ ] Empty states are usable for a new organization.
- [ ] API tests verify aggregates against seeded data; a Playwright spec verifies the dashboard and a drill-down.
- [ ] The layout follows the Daybook design direction and remains usable on tablet.

## Blocked by

- Blocked by `issues/011-customer-payments.md`
- Blocked by `issues/014-bill-payments-ap-aging.md`
- Blocked by `issues/017-bank-import.md`
- Blocked by `issues/023-financial-statements.md`
- Blocked by `issues/024-sales-expense-reports.md`

## User stories addressed

- User story 53
