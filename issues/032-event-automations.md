## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add event-triggered automations for the domain events in PRD §AI Agent: new bank transaction, invoice overdue, bill above a threshold, and reconciliation discrepancy. Feature services emit events; AutomationService routes matching enabled automations; the test hook fires events without polling.

## Acceptance criteria

- [ ] The listed domain events are emitted from their owning services with tenant and record context.
- [ ] Users can create, pause, edit, and delete event automations with a clear trigger definition.
- [ ] Enabled matching automations run through the same ToolRegistry, approval, and logging path as other modes; unrelated automations do not fire.
- [ ] The test hook emits each event deterministically, and the resulting action/proposal appears in the activity log.
- [ ] API tests cover routing and tenant isolation; a Playwright spec covers creating an event automation and firing it.
- [ ] Event automations can be inspected and controlled without manual polling.

## Blocked by

- Blocked by `issues/012-ar-aging.md`
- Blocked by `issues/013-vendors-bills.md`
- Blocked by `issues/017-bank-import.md`
- Blocked by `issues/022-complete-undo-reconciliation.md`
- Blocked by `issues/031-scheduled-automations.md`

## User stories addressed

- User story 68
