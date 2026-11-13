## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Create the deterministic demo seed and one-command startup path from PRD §Seed and demo. Seed two organizations with the documented users and roles, default charts of accounts, customers/vendors/items, mixed-state invoices and bills, a reconciled bank CSV period, and one cron automation per organization. Document the clone → compose up → seed → login path in the README.

## Acceptance criteria

- [ ] Seed creates Acme and Nimbus with the documented owner/accountant/staff/viewer accounts and password; credentials are labeled local/demo only.
- [ ] Each organization has a default chart of accounts, customers, vendors, items, invoices and bills in varied states, a reconciled bank CSV period, and one agent cron automation.
- [ ] Seed is deterministic and safe to rerun without duplicating records.
- [ ] `docker compose up` followed by the documented seed step produces a working login and demo data; no secrets are committed.
- [ ] A smoke test verifies both organizations, seeded login, and the distinguishing data; the README matches the verified commands.
- [ ] Seed data uses synthetic information only and avoids industry-specific terminology.

## Blocked by

- Blocked by all functional slices from `issues/002-tenant-isolation-org-switching.md` through `issues/033-slash-commands.md`.

## User stories addressed

- User story 76
- User story 77
- User story 78
