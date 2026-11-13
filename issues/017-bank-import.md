## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Deliver the bank activity path from PRD §Banking and reconciliation: create bank and credit-card accounts linked to ledger accounts, import a CSV (and OFX where supported) through a preview-and-mapping wizard, and list normalized transactions with date, description, amount, and match state. Duplicate imports are skipped.

## Acceptance criteria

- [ ] Bank and credit-card accounts can be created and linked to organization ledger accounts.
- [ ] Import accepts CSV/OFX, lets the user map columns/fields, previews normalized transactions, and confirms the import.
- [ ] Duplicate transactions are detected and skipped; imported rows preserve the source batch for undo diagnostics.
- [ ] The transaction list supports date/account/match-state filters and shows the match state.
- [ ] BankingImportEngine unit tests cover parsing, mapping, duplicates, and normalization; API and Playwright specs cover the import path.
- [ ] No live bank feed or third-party aggregator is introduced.

## Blocked by

- Blocked by `issues/005-chart-of-accounts.md`

## User stories addressed

- User story 35
- User story 36
- User story 37
