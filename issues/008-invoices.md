## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Deliver the core invoice workflow from PRD §Sales: create and edit invoices with customer, line items, tax, and due date; move them through Draft, Sent, and Overdue; send an invoice; and see them in a list and detail view. Sending an invoice posts the balanced receivable, income, and tax lines through the LedgerEngine.

## Acceptance criteria

- [ ] An invoice can be created from a customer and item lines, with computed subtotal, tax, total, and due date.
- [ ] Status transitions support Draft, Sent, Partial, Paid, and Overdue; overdue is derived from due date until payment behavior is added in `011-customer-payments.md`.
- [ ] Marking an invoice as sent posts balanced journal lines and is idempotent; drafts do not post.
- [ ] The invoice list supports filters and the detail view shows customer, lines, totals, status, and actions.
- [ ] API tests cover creation, validation, send, posting, and tenant isolation; a Playwright spec covers creating and sending an invoice.
- [ ] Invoice changes are audited and role-guarded.

## Blocked by

- Blocked by `issues/006-manual-journals-register.md`
- Blocked by `issues/007-customers-items.md`

## User stories addressed

- User story 15
- User story 20
- User story 21
- User story 22
