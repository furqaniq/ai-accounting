## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Add the live slash-command menu to the agent composer from PRD §Agent composer and slash commands: `/model`, `/cron`, and `/event`. The menu filters by prefix, supports arrow/Enter/Escape and click selection, and routes each command through the existing governed paths. `/model` changes the model alias for subsequent prompts; `/cron` and `/event` open the automation form preset to schedule or event mode. The composer uses the Daybook red-ink thickened pulsing border, disabled under reduced-motion.

## Acceptance criteria

- [ ] Typing `/` opens a live, accessible menu filtered by prefix; keyboard navigation, Enter, Escape, and click selection work.
- [ ] `/model` opens a model selector and applies an allowlisted alias to subsequent prompt jobs without altering saved automations.
- [ ] `/cron` presets the automation form to schedule mode; `/event` presets it to event mode; both submit through the existing automation API and `automation.create` policy.
- [ ] Slash commands cannot bypass ToolRegistry, permissions, tenant scoping, or approval policy.
- [ ] Unknown commands produce a clear message; command selection clears the composer appropriately.
- [ ] The composer border uses the Daybook red-ink pulse and stops under `prefers-reduced-motion`.
- [ ] Playwright specs cover filtering, keyboard selection, all three commands, and reduced-motion behavior.

## Blocked by

- Blocked by `issues/028-agent-prompt-foundation.md`
- Blocked by `issues/031-scheduled-automations.md`
- Blocked by `issues/032-event-automations.md`

## User stories addressed

- User story 75
