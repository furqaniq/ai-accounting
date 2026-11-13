## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add estimates/quotes with line items and convert an accepted estimate into a draft invoice without re-entering customer or lines. Preserve the estimate-to-invoice link and ensure conversion is guarded against duplicate invoices.

## Acceptance criteria

- [ ] Estimates can be created, edited, listed, and opened with customer, lines, totals, and status.
- [ ] Converting an estimate creates a draft invoice with copied customer and lines, and records the source link.
- [ ] A converted estimate cannot be converted again into a duplicate invoice; the UI explains the existing link.
- [ ] Conversion does not post to the ledger until the resulting invoice is sent.
- [ ] API tests cover conversion and duplicate prevention; a Playwright spec covers estimate-to-invoice.
- [ ] All records are organization-scoped and audited.

## Blocked by

- Blocked by `issues/008-invoices.md`

## User stories addressed

- User story 18
- User story 19
