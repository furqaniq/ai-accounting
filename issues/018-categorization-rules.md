## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add categorization rules that match imported transaction descriptions and assign a target account, and apply those rules during import with a preview of affected transactions. Users can create, edit, pause, and delete rules from the banking workspace.

## Acceptance criteria

- [ ] Rules support "if description contains X, categorize as Y" with an explicit target account.
- [ ] Import preview shows which transactions will be affected by each rule before confirmation.
- [ ] Rules apply deterministically on import; conflicting rules have a defined precedence and no transaction is categorized twice.
- [ ] Rule CRUD is organization-scoped and role-guarded.
- [ ] BankingImportEngine unit tests cover rule matching and application; a Playwright spec covers rule creation and preview.
- [ ] The import preview remains usable when no rules match.

## Blocked by

- Blocked by `issues/017-bank-import.md`

## User stories addressed

- User story 41
- User story 42
