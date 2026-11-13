## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Deliver organization membership management and role-based access control for the five roles in PRD §Non-negotiable invariants. Owners can add existing users to the organization, assign or change roles, and remove members while preserving at least one Owner. Every non-auth endpoint declares and enforces a required permission, and denied actions surface a clear UI message.

## Acceptance criteria

- [ ] An Owner or Admin can add a member, change a member's role, and remove a member; removing the last Owner is rejected.
- [ ] Role checks are enforced at the API layer for Owner, Admin, Accountant/Bookkeeper, Staff, and Viewer; Viewer mutations are always rejected.
- [ ] The members UI reflects roles and permissions, and denied actions show a clear, non-destructive error.
- [ ] Direct API tests cover allowed and denied actions for every role, not just the UI.
- [ ] Membership changes and role assignments write audit entries.
- [ ] A Playwright spec covers adding a member, changing a role, and a Viewer attempting a restricted action.

## Blocked by

- Blocked by `issues/002-tenant-isolation-org-switching.md`

## User stories addressed

- User story 5
- User story 7
- User story 9
