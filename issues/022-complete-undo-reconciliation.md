## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Complete the ReconciliationSession state machine: allow completion only when the difference is zero, lock the completed session against direct mutation, and support an audited undo that restores the prior state.

## Acceptance criteria

- [ ] Completion is rejected while the statement/cleared difference is non-zero.
- [ ] A completed session records its balances and cannot be mutated except through undo.
- [ ] Undo restores the session to an editable state, reverts the completion snapshot, and appends an audit entry.
- [ ] The UI disables completion until balanced and exposes undo only for completed sessions.
- [ ] Unit tests cover the completion invariant and undo; API and Playwright specs cover complete and undo.
- [ ] Session actions remain tenant-scoped and role-guarded.

## Blocked by

- Blocked by `issues/021-reconciliation-workbench.md`

## User stories addressed

- User story 45
- User story 46
