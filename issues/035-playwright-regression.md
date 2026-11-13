## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Deliver the end-to-end Playwright suite described in PRD §Testing Decisions: one spec per critical flow, running against the Dockerized stack and the deterministic seed. Tenancy and RBAC checks must also hit the API directly, not only the UI.

## Acceptance criteria

- [ ] Specs cover auth and cross-tenant isolation, RBAC, invoice lifecycle, expense and bill lifecycle, bank import/matching/reconciliation/undo, reporting totals, agent prompt/cron/event modes, slash commands, and approvals.
- [ ] Direct API assertions cover cross-tenant access and role denials instead of relying only on UI behavior.
- [ ] Tests reuse the seeded fixture and test hooks; no real-time sleeps or live bank/payment integrations are required.
- [ ] `npx playwright test` passes from a clean checkout against the Compose stack.
- [ ] Failures identify the flow and leave enough evidence (trace/screenshot) to diagnose.
- [ ] The suite remains deterministic when run repeatedly.

## Blocked by

- Blocked by `issues/034-demo-seed.md`

## User stories addressed

- User story 80
