## Parent PRD

`issues/prd.md`

**Type:** HITL

## What to build

Create the runnable walking skeleton described in PRD §Architecture and boundaries: a monorepo with the Next.js frontend, NestJS backend, PostgreSQL, Redis, MinIO, and the documented Compose ports. Deliver a seeded owner login, JWT access/refresh session handling, the Daybook app shell, health checks, and a README that takes a new developer from clone to logged-in session. This is the architecture and design-review gate before feature work.

## Acceptance criteria

- [ ] `docker compose up` starts frontend, backend, PostgreSQL, Redis, MinIO, and Adminer on the documented ports; backend and frontend health checks pass.
- [ ] A seeded owner can log in with email/password, receives short-lived access and refresh tokens, can restore a session, and can log out.
- [ ] The authenticated shell follows the Daybook design direction from `AGENTS.md` and is usable on desktop and tablet.
- [ ] `.env.example` documents required configuration, including `GEMINI_API_KEY`; no secrets are committed.
- [ ] Backend smoke tests and a Playwright login spec pass, and the README commands are verified from a clean checkout.
- [ ] HITL: architecture and shell design are reviewed and approved before dependent slices start.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 1
- User story 2
- User story 76 (initial Compose/login path)
- User story 81 (shell responsiveness)
