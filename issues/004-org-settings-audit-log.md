## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add organization settings and the user audit log from PRD §Data model and §API contracts. Authorized users can edit organization name, fiscal year start, base currency display, and default tax rate. Every user mutation appends an immutable `AuditLogEntry` with actor, action, record, and timestamp, and Admins can review the log.

## Acceptance criteria

- [ ] Organization settings can be read and updated with validation; non-admin updates are rejected.
- [ ] `AuditLogEntry` is append-only: there is no update or delete endpoint, and corrections are appended.
- [ ] Member, role, and settings mutations create audit entries with actor, organization, record, action, and time.
- [ ] The audit log UI supports review and basic filtering, and is scoped to the active organization.
- [ ] API tests verify persistence and immutable behavior; a Playwright spec verifies settings changes appear in the audit log.
- [ ] All new endpoints are organization-scoped and role-guarded.

## Blocked by

- Blocked by `issues/003-members-rbac.md`

## User stories addressed

- User story 6
- User story 8
