## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add the accounts-receivable aging report and overdue queue from PRD §Sales and §Reporting. The report uses open invoice balances and payment applications as of a selectable date, with standard aging buckets and days overdue. Users can drill from a bucket or overdue row into the invoice.

## Acceptance criteria

- [ ] AR aging buckets include current, 1–30, 31–60, 61–90, and 90+ days, with a selectable as-of date.
- [ ] Totals reconcile to open invoice balances after payments; fully paid invoices are excluded.
- [ ] The overdue queue shows days overdue and links to the invoice detail.
- [ ] API tests cover bucket boundaries, as-of dates, and seeded scenarios; a Playwright spec verifies the report and drill-down.
- [ ] Data is organization-scoped and only read-permitted roles can access it.

## Blocked by

- Blocked by `issues/011-customer-payments.md`

## User stories addressed

- User story 26
- User story 27
