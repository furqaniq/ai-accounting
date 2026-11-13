## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Build the LedgerEngine and the first ledger-facing workflow: manual double-entry journal entries and an account register with drill-down. Unbalanced entries are rejected before saving. The register shows posted lines, running balances, and links back to the source journal entry. Later sales, purchase, and banking slices post through the same engine.

## Acceptance criteria

- [ ] `post`, `reverse`, and `balance` are implemented behind the LedgerEngine boundary; no feature module writes journal tables directly.
- [ ] Manual entries require balanced debits and credits and cannot be posted with an empty or invalid line.
- [ ] The register shows account lines, running balance, and source drill-down, with date/account filters.
- [ ] Reversals restore balances and leave the original entry auditable; posted history is not edited in place.
- [ ] Jest tests cover unbalanced rejection, balanced posting, reversal, and balance derivation.
- [ ] API and Playwright specs cover creating an entry and inspecting the register.
- [ ] All entries and reads are organization-scoped and audited.

## Blocked by

- Blocked by `issues/005-chart-of-accounts.md`

## User stories addressed

- User story 13
- User story 14
- User story 15 (ledger foundation)
