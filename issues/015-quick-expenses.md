## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add the quick-expense form from PRD §Purchases: date, vendor, category/expense account, amount, memo, and optional receipt placeholder. Expenses post to the ledger and appear in a filterable list so small purchases can be captured without a full bill.

## Acceptance criteria

- [ ] Expenses can be created, edited where appropriate, listed, filtered, and opened in detail.
- [ ] The form requires a category from the chart of accounts and supports a vendor; totals and dates are validated.
- [ ] Saving posts the expense through the LedgerEngine with balanced lines.
- [ ] The expense list shows category, vendor, amount, and date, with a total for the current filter.
- [ ] API tests cover validation, posting, and tenant isolation; a Playwright spec covers quick-expense entry.
- [ ] Expense changes are audited and role-guarded.

## Blocked by

- Blocked by `issues/013-vendors-bills.md`

## User stories addressed

- User story 15
- User story 32
