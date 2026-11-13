## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Implement the organization chart of accounts from PRD §Chart of accounts and general ledger. New organizations receive the default industry-neutral chart. Accountants can add, edit, and deactivate accounts without deleting or corrupting historical postings.

## Acceptance criteria

- [ ] A new organization receives a default asset, liability, equity, income, and expense chart with stable codes.
- [ ] Accountants can create and edit accounts with code, name, type, subtype, and active state; codes are unique per organization.
- [ ] Deactivated accounts disappear from new-entry pickers but remain visible in historical registers and reports.
- [ ] Account changes are organization-scoped, audited, and guarded by role.
- [ ] API tests cover creation, validation, deactivation, and tenant isolation; a Playwright spec covers the account list and form.
- [ ] No industry-specific account names or vertical modules are introduced.

## Blocked by

- Blocked by `issues/002-tenant-isolation-org-switching.md`

## User stories addressed

- User story 11
- User story 12
