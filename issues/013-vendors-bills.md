## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add the payable-side master data and bill workflow from PRD §Purchases: organization-scoped vendors with contact details and derived balance, plus bills with line items, due dates, totals, and status. Approving/opening a bill posts balanced expense/AP lines through the LedgerEngine.

## Acceptance criteria

- [ ] Vendors can be created, edited, listed, searched, and viewed with contact details and balance.
- [ ] Bills can be created with vendor, lines, tax where applicable, due date, and status; totals are computed.
- [ ] Opening/approving a bill posts balanced AP and expense lines exactly once; drafts do not post.
- [ ] The bill list and detail view show status, due date, totals, and actions.
- [ ] API tests cover bill lifecycle, posting, and tenant isolation; a Playwright spec covers creating and opening a bill.
- [ ] Vendor and bill changes are audited and role-guarded; labels remain industry-neutral.

## Blocked by

- Blocked by `issues/006-manual-journals-register.md`

## User stories addressed

- User story 15
- User story 29
- User story 30
