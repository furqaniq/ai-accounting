## Parent PRD

`issues/prd.md`

**Type:** HITL

## What to build

Let the agent propose a sensitive write action, show the tool and arguments, and route it to an approval inbox by default. Implement the first governed write capability (`invoice.create`) and the ApprovalService guarantees: approval executes exactly once, rejection executes nothing, and both outcomes are logged. Resolve the PRD's open question about whether an explicit Approver role is needed or whether Owner/Admin approve.

## Acceptance criteria

- [ ] The agent can return a proposed `invoice.create` tool call with visible arguments and rationale; the action stays pending until approved.
- [ ] The approvals inbox lists pending proposals and supports approve/reject with clear consequences.
- [ ] Approval executes the tool exactly once under the acting approver's permissions and tenant scope; rejection leaves the books unchanged.
- [ ] Concurrent approval attempts are safe, and the AgentActionLog records the proposal, approver, decision, and execution result.
- [ ] The HITL approver-role decision is documented and reflected in guards and UI.
- [ ] Jest tests cover single execution, rejection, and concurrency; API and Playwright specs cover propose, approve, and reject.
- [ ] No client path can execute a write tool without passing through ToolRegistry and the approval policy.

## Blocked by

- Blocked by `issues/008-invoices.md`
- Blocked by `issues/028-agent-prompt-foundation.md`

## User stories addressed

- User story 61
- User story 62
- User story 64
- User story 65
