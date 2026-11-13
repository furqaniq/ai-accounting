## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add per-action agent execution policy configuration for Owners and Admins: choose auto-execute or require approval for each registered tool. The policy is persisted, audited, and read by ToolRegistry at execution time.

## Acceptance criteria

- [ ] Owner/Admin can view and update auto-execute versus approval-required policy for registered action types.
- [ ] Sensitive defaults (for example `bill.pay`) remain approval-required unless explicitly changed.
- [ ] Changing policy affects subsequent proposals/executions without restarting workers.
- [ ] Non-admin updates are rejected; every change is audited.
- [ ] Jest tests cover policy routing; API and Playwright specs cover changing a policy and observing the resulting behavior.
- [ ] The UI explains the risk of auto-execute for financial actions.

## Blocked by

- Blocked by `issues/029-agent-write-approvals.md`

## User stories addressed

- User story 63
