## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Deliver the lightweight project and time workflow from PRD §Projects and time. Create projects, tag income/expenses/time to them, enter billable and non-billable time, roll billable time into an invoice, and view project profitability.

## Acceptance criteria

- [ ] Projects can be created, edited, listed, and assigned to invoices, expenses, and time entries.
- [ ] Time entries capture date, hours, rate, billable flag, and optional project; totals derive from hours × rate.
- [ ] Billable time can be selected and rolled into a draft invoice without re-entering line details, with a link back to the time entries.
- [ ] Project profitability compares tagged revenue against tagged costs/expenses and time value.
- [ ] API tests cover project/time CRUD, invoice roll-up, and tenant isolation; a Playwright spec covers time-to-invoice.
- [ ] All records are organization-scoped and audited; labels remain industry-neutral.

## Blocked by

- Blocked by `issues/008-invoices.md`
- Blocked by `issues/015-quick-expenses.md`

## User stories addressed

- User story 54
- User story 55
- User story 56
- User story 57
