## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add transaction matching using the MatchingEngine from PRD §Deep modules. For an imported transaction, suggest ranked candidates among invoices, bills, payments, and expenses, and let the user apply a match. A transaction can be matched only once, and suggestions never cross tenant boundaries.

## Acceptance criteria

- [ ] MatchingEngine suggests candidates with amount, date, and description signals and a clear ranking.
- [ ] The transaction detail panel shows suggestions and lets the user match to an invoice, bill, payment, or expense.
- [ ] Applying a match updates the transaction match state and links the record without duplicating postings.
- [ ] Already-matched transactions cannot be matched again; unmatched is the default state.
- [ ] Unit tests cover ranking and tenant scoping; API and Playwright specs cover matching to each supported record type.
- [ ] Existing invoice, bill, expense, and payment records remain unchanged except for the match link.

## Blocked by

- Blocked by `issues/011-customer-payments.md`
- Blocked by `issues/014-bill-payments-ap-aging.md`
- Blocked by `issues/015-quick-expenses.md`
- Blocked by `issues/017-bank-import.md`

## User stories addressed

- User story 38
