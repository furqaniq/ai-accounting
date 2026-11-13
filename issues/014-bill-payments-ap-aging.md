## Parent PRD

`issues/prd.md`

**Type:** AFK

## What to build

Record partial and full bill payments against open bills, update AP balances and bill statuses, post balanced cash/AP journal lines, and add the AP aging report from PRD §Purchases. This completes the payable loop with the same standards as customer payments.

## Acceptance criteria

- [ ] A bill payment can be applied to one or more open bills; over-payment is rejected.
- [ ] Partial and full payments update bill balances/status consistently and post cash/AP lines through the LedgerEngine exactly once.
- [ ] AP aging includes current, 1–30, 31–60, 61–90, and 90+ buckets with an as-of date and drill-down.
- [ ] API tests cover partial/full/over-payment, posting, aging boundaries, and tenant isolation; a Playwright spec covers payment and aging.
- [ ] All records are organization-scoped and audited.

## Blocked by

- Blocked by `issues/013-vendors-bills.md`

## User stories addressed

- User story 15
- User story 31
- User story 33
