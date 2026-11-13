## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Build the agent foundation from PRD §Deep modules, §Agent tool surface, and §Execution flow: ToolRegistry, AiProviderService, orchestrator, BullMQ prompt worker, prompt submission/job status endpoints, the read-only `insight.query` and `report.generate` tools, and the immutable AgentActionLog. The chat UI shows the prompt, progress, response, and log reference. Rate limits surface as a retrying state rather than a hard failure.

## Acceptance criteria

- [ ] A prompt is queued to BullMQ, the worker loads tenant context and role-filtered tools, calls the provider with tool declarations, validates any tool call, and executes only registered read-only tools.
- [ ] The provider is swappable behind AiProviderService; Gemini-specific shapes and `429 RESOURCE_EXHAUSTED` handling stay inside it.
- [ ] Prompt submission accepts an optional model alias from a server-side allowlist; unknown aliases are rejected and defaults resolve from configuration.
- [ ] Every prompt/tool/result appends an AgentActionLog entry with trigger source, tools, I/O, actor, status, and log reference; the UI exposes the activity log.
- [ ] Jobs retry with bounded backoff plus jitter and show a busy/retrying state; a test hook can advance retry behavior.
- [ ] Tenant isolation, permission checks, and the no-raw-SQL/no-free-form-code boundary are covered by API and Jest tests.
- [ ] The chat UI is accessible, uses the Daybook composer, and a Playwright spec proves a read-only insight prompt and visible log entry.

## Blocked by

- Blocked by `issues/002-tenant-isolation-org-switching.md`
- Blocked by `issues/003-members-rbac.md`
- Blocked by `issues/023-financial-statements.md`
- Blocked by `issues/024-sales-expense-reports.md`

## User stories addressed

- User story 60
- User story 70
- User story 71
- User story 72
- User story 73
- User story 74
