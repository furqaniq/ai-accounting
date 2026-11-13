## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Make organization context a first-class, enforced part of every request. Signed-in users can see their memberships and switch the active organization; the backend resolves that membership on every request and scopes all data access through the TenantContext/ScopedDataAccess module from PRD §Deep modules. Seed two organizations and a user who belongs to both so isolation can be tested directly.

## Acceptance criteria

- [ ] The UI shows the active organization and lets a multi-org user switch organizations without re-login.
- [ ] Every authenticated request resolves and validates the active organization membership; the client cannot select an organization it does not belong to.
- [ ] Data access is automatically scoped by `organizationId`; direct-ID reads and writes across tenants return a not-found or forbidden response.
- [ ] Seed includes Acme and Nimbus with separate records and the documented owner accounts.
- [ ] API tests prove cross-tenant isolation without relying on the UI; a Playwright spec proves the switcher and refreshed data views.
- [ ] No cross-tenant identifiers appear in list, detail, or error responses.

## Blocked by

- Blocked by `issues/001-walking-skeleton.md`

## User stories addressed

- User story 3
- User story 4
- User story 10
