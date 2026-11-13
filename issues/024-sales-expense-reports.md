## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add the operational analysis reports from PRD §Reporting: sales by customer, sales by item, and expenses by category. These reuse the AR/AP aging views already delivered in the sales and purchases slices and provide date-filtered totals with drill-down to source records.

## Acceptance criteria

- [ ] Sales by customer and sales by item aggregate posted invoice activity for a selectable date range.
- [ ] Expenses by category aggregate posted expenses and bill lines for a selectable date range.
- [ ] Report totals reconcile to the ledger and subledger records and exclude drafts/unposted documents.
- [ ] The report UI supports filters, totals, and drill-down to source documents.
- [ ] API tests cover seeded totals and date boundaries; a Playwright spec verifies a report and drill-down.
- [ ] AR/AP aging is not duplicated here; it remains in `issues/012-ar-aging.md` and `issues/014-bill-payments-ap-aging.md`.

## Blocked by

- Blocked by `issues/008-invoices.md`
- Blocked by `issues/011-customer-payments.md`
- Blocked by `issues/015-quick-expenses.md`

## User stories addressed

- User story 28
- User story 34
- User story 51 (with AR/AP aging from earlier slices)
