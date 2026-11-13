## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Build the reconciliation workbench from PRD §Banking and reconciliation: start a session for a bank account and period with a statement ending balance, mark imported transactions cleared, and see the running difference between the statement and cleared/book balances. Persist the session so work can resume.

## Acceptance criteria

- [ ] A reconciliation session can be started for an organization bank account with a period and statement ending balance.
- [ ] Transactions can be marked and unmarked as cleared; the difference recalculates immediately and is persisted.
- [ ] The workbench shows statement balance, cleared total, book balance, and difference in the Daybook visual language.
- [ ] Only one active session per account/period is allowed, and sessions are organization-scoped.
- [ ] Unit tests cover difference calculations and clearing state; API and Playwright specs cover starting and clearing a session.
- [ ] All session actions are audited.

## Blocked by

- Blocked by `issues/017-bank-import.md`

## User stories addressed

- User story 43
- User story 44
