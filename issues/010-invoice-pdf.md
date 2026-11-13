## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Generate a downloadable invoice PDF from an existing invoice. The PDF includes organization and customer details, invoice number and dates, line items, tax, totals, and payment instructions where configured. This is a document deliverable; it does not send email or process payments.

## Acceptance criteria

- [ ] A tenant-scoped endpoint returns a valid PDF for an existing invoice and rejects cross-tenant invoice IDs.
- [ ] PDF content matches the invoice record, including customer, lines, tax, totals, due date, and organization identity.
- [ ] The invoice detail page exposes a working download action with a sensible filename.
- [ ] Tests verify the returned file type, extracted text/totals, and tenant isolation.
- [ ] The implementation does not add real email delivery or payment processing.

## Blocked by

- Blocked by `issues/008-invoices.md`

## User stories addressed

- User story 23
