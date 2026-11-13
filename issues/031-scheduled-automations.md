## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Deliver cron automations from PRD §Queue and rate-limit behavior and §Agent tool surface: create a scheduled automation, pause/resume, edit, and delete it; register BullMQ repeatable jobs keyed by automation ID; expose the automations UI; and register the governed `automation.create` tool so the agent can propose a routine. A test hook triggers a job without waiting for real time.

## Acceptance criteria

- [ ] Users can create a scheduled automation (for example, Mondays at 9:00), pause/resume it, edit its schedule, and delete it.
- [ ] Editing an automation replaces its repeatable job instead of duplicating it; deletion removes the job.
- [ ] `automation.create` is a registered governed tool with schema validation, permission checks, tenant scoping, and the approval policy.
- [ ] Runs append AgentActionLog entries with trigger source, tool calls, and outcome; the automations UI shows enabled state and last run.
- [ ] The test hook triggers a scheduled run deterministically in test/demo environments.
- [ ] API and Playwright specs cover create, pause, edit, delete, and one executed run.
- [ ] The seed's per-org automation is added in `issues/034-demo-seed.md`.

## Blocked by

- Blocked by `issues/023-financial-statements.md`
- Blocked by `issues/028-agent-prompt-foundation.md`

## User stories addressed

- User story 66
- User story 67
- User story 69
