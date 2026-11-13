## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Let users resolve an unmatched imported transaction in place: create a new expense, customer payment, or transfer from the transaction, or categorize it directly to a ledger account. The transaction's match state updates and any accounting effect posts through the existing ledger and subledger services.

## Acceptance criteria

- [ ] From a transaction, the user can create an expense, record a customer payment, create an account transfer, or categorize directly to an account.
- [ ] Created records are prefilled with the transaction date, amount, description, and bank account where applicable.
- [ ] Direct categorization posts balanced ledger lines; transfer moves value between the linked accounts.
- [ ] A resolved transaction cannot be resolved twice; the UI shows the linked record or category.
- [ ] API tests cover each resolution path and tenant isolation; a Playwright spec covers one create-in-place flow and one direct-categorize flow.
- [ ] All actions are audited and role-guarded.

## Blocked by

- Blocked by `issues/011-customer-payments.md`
- Blocked by `issues/014-bill-payments-ap-aging.md`
- Blocked by `issues/015-quick-expenses.md`
- Blocked by `issues/017-bank-import.md`

## User stories addressed

- User story 39
- User story 40
