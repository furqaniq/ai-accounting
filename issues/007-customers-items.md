## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add the sales-side master data from PRD §Sales (accounts receivable): organization-scoped customers with contact details and a derived balance, and a generic item catalog with name, price, income account, and taxable flag. This is the catalog that invoice and estimate line editors consume.

## Acceptance criteria

- [ ] Customers can be created, edited, listed, searched, and opened in a detail view with contact details and balance.
- [ ] Items can be created and edited with name, price, income account, and taxable flag; the income account must belong to the organization.
- [ ] Customer balances are derived from sales/payment data rather than manually edited.
- [ ] Validation rejects missing required fields, duplicate codes where applicable, and cross-tenant account references.
- [ ] API tests cover CRUD and tenant isolation; a Playwright spec covers creating a customer and an item.
- [ ] Labels remain industry-neutral.

## Blocked by

- Blocked by `issues/005-chart-of-accounts.md`

## User stories addressed

- User story 16
- User story 17
