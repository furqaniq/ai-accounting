## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Record manual customer payments and apply them to one or more invoices. Partial and full payments update invoice balances and statuses, and the payment posts balanced cash/receivable journal lines through the LedgerEngine. This closes the receivable loop before aging and reporting.

## Acceptance criteria

- [ ] A payment can be recorded against a customer and applied to one or more open invoices.
- [ ] Partial payment moves an invoice to Partial; full payment moves it to Paid; over-application is rejected.
- [ ] Payment application and invoice balance changes are derived consistently and cannot be edited into an invalid state.
- [ ] Posting produces balanced cash and AR lines through the LedgerEngine exactly once.
- [ ] API tests cover partial, full, over-payment, posting, and tenant isolation; a Playwright spec covers recording a payment.
- [ ] Payment and application records are organization-scoped and audited.

## Blocked by

- Blocked by `issues/008-invoices.md`

## User stories addressed

- User story 15
- User story 24
- User story 25
