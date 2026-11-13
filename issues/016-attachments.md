## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Implement the AttachmentStore from PRD §Deep modules using MinIO. Staff can upload, view, download, and remove receipts or supporting documents on expenses and bills. Metadata is stored in PostgreSQL; files live in object storage, never on the application disk.

## Acceptance criteria

- [ ] Uploads use object storage with organization-scoped metadata and presigned download URLs.
- [ ] Receipts can be attached to expenses and supporting documents to bills, then viewed and removed.
- [ ] File type and size validation, tenant isolation, and safe filenames are enforced.
- [ ] The UI exposes attach/view/remove controls on the relevant detail pages and survives container restarts.
- [ ] Tests cover upload/download/delete with MinIO or an isolated test double; a Playwright spec covers attaching a receipt.
- [ ] No application feature talks to MinIO directly; all access goes through AttachmentStore.

## Blocked by

- Blocked by `issues/013-vendors-bills.md`
- Blocked by `issues/015-quick-expenses.md`

## User stories addressed

- User story 58
- User story 59
