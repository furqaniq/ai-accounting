## Parent PRD

`issues/prd.md`

**Type:** HITL

## What to build

Create the single static `User-flows.html` deliverable and run the final responsive and industry-neutral review from PRD §Demo, deliverables, and usability. The page diagrams the key flows without a build step, and the review confirms the production UI works at desktop/tablet widths and uses generic labels.

## Acceptance criteria

- [ ] `User-flows.html` is one static file with no build step and covers auth, invoice lifecycle, bank import/reconciliation, reporting, and agent prompt/cron/event/approval flows.
- [ ] The production interface is usable at desktop and tablet widths, with the clerk margin and spine collapsing according to `AGENTS.md`.
- [ ] No page relies on horizontal scrolling for primary actions, and navigation remains usable in collapsed layouts.
- [ ] A label audit finds no vertical-specific modules or hard-coded industry jargon; labels use Items, Customers, and Vendors.
- [ ] The interface follows the Daybook design direction and does not regress to generic cards, gradients, or dashboard-kit patterns.
- [ ] HITL: the client/design reviewer signs off on the flow document and responsive/neutral-label review.

## Blocked by

- Blocked by `issues/034-demo-seed.md`

## User stories addressed

- User story 79
- User story 81
- User story 82
