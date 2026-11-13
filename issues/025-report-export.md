## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add CSV and PDF export for the financial statements and operational reports. Exports must preserve the report's date/as-of filters, totals, and account grouping, and must be downloadable from the report UI.

## Acceptance criteria

- [ ] Every core report exposes CSV and PDF export actions.
- [ ] Exported files contain the same filtered data and totals as the on-screen report, with clear headers and organization identity.
- [ ] PDF output uses a readable report layout; CSV output opens cleanly with quoted fields.
- [ ] Export endpoints are tenant-scoped and reject cross-tenant parameters.
- [ ] API tests parse CSV totals and verify PDF content; a Playwright spec covers downloading an export.
- [ ] No separate report logic is duplicated for exports.

## Blocked by

- Blocked by `issues/023-financial-statements.md`
- Blocked by `issues/024-sales-expense-reports.md`

## User stories addressed

- User story 52
