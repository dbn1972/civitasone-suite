# Works Module — AI Test Pack Execution Report

**Date:** 2026-08-08  
**Branch:** `fix/ci-scanner-role-superuser`  
**Service:** `@civitasone/works-service`  
**Pack:** Works_Module_Test_Pack (8 prompts + AI_Test_Execution master)

---

## Summary

Executed the full Works Module Test Pack against `services/works-service`. Extended the existing 349-test suite with **35 new focused tests** across 6 new files plus shared fixtures. Final run: **384 passed / 0 failed** in 21 test files.

---

## Commands Run

```bash
cd services/works-service && pnpm test
# Test Files  21 passed (21)
# Tests       384 passed (384)
```

Baseline before this session: 349 passed (15 files).

---

## Files Created / Changed

| File | Action |
|------|--------|
| `tests/fixtures/works-fixtures.ts` | **Created** — deterministic tenant/actor/entity IDs + JWT helpers |
| `tests/masters-registry.test.ts` | **Created** — 17 masters registry completeness |
| `tests/tender-award-finalization.test.ts` | **Created** — DAO/DO award guards + route 422/403 |
| `tests/reporting-aggregates.test.ts` | **Created** — summary/status aggregate reconciliation |
| `tests/route-finalization-guards.test.ts` | **Created** — AA/TS/MB/bill finalization guards |
| `tests/approval-consumer-events.test.ts` | **Created** — AA/TS consumer audit + outbox events |
| `tests/boq-guards-property.test.ts` | **Created** — BoQ quantity guard + fast-check properties |
| `AI_TEST_REPORT_Works_Module.md` | **Created** — this report |

Pre-existing coverage retained: `all-routes.test.ts`, `*-domain.test.ts`, `masters-cqrs.test.ts`, `consumers.test.ts`, `orphan-consumers.test.ts`, `billing-money.consumer.test.ts`, static RLS/outbox tests.

---

## Pack Requirement Mapping

### 01 — Work Approval (`approval/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| AA create/list/finalize | `all-routes.test.ts`, `approval-consumer-events.test.ts` | `approval/routes.ts:38-60`, `approval/consumer.ts:11-64` |
| TS create/finalize + DAO gate (BR-011) | `route-finalization-guards.test.ts`, `approval-domain.test.ts` | `approval/routes.ts:62-77`, `approval/domain.ts:43-50` |
| Original/Revised type (BR-009/012) | `approval-domain.test.ts` | `approval/domain.ts:16-18` |
| One-time finalization | `route-finalization-guards.test.ts`, `approval-domain.test.ts` | `approval/domain.ts:24-28` |
| Idempotent replay | `consumers.test.ts`, `approval-consumer-events.test.ts` | `approval/consumer.ts:46-47` |
| Audit/outbox on create/finalize | `approval-consumer-events.test.ts` | `approval/consumer.ts:40,62` |
| Authority thresholds for AA | **N/A** — not implemented in approval domain; thresholds live in `tender/domain.ts:14-18` | `approval/domain.ts` (no threshold fn) |

### 02 — Work Billing (`billing/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| MB/bill finalization sequence | `billing-domain.test.ts`, `route-finalization-guards.test.ts` | `billing/domain.ts:9-18,45-52` |
| canCreateBill / MB gate | `all-routes.test.ts`, `orphan-consumers.test.ts` | `billing/routes.ts:56-65`, `billing/consumer.ts:74-82` |
| FR-BIL-011 quantity ceiling | `billing-domain.test.ts`, `orphan-consumers.test.ts` | `billing/consumer.ts:157-166` |
| Net payable bigint math | `billing-domain.test.ts`, `billing-money.consumer.test.ts` | `billing/domain.ts:38-39` |
| Account compilation | `orphan-consumers.test.ts` | `billing/consumer.ts:194-218` |
| Finance hand-off event | **N/A** — no finance GL event emitted from billing consumer | `billing/consumer.ts` (no cross-service finance topic) |
| Bill cannot exceed approved work (money) | **N/A** — only quantity ceiling implemented, not gross amount vs award | `billing/domain.ts:31-33` |

### 03 — BOQ (`boq/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Amount calculation | `boq-domain.test.ts`, `boq-guards-property.test.ts` | `boq/domain.ts:20-24` |
| Recapitulation totals | `boq-domain.test.ts`, `boq-guards-property.test.ts` | `boq/domain.ts:42-49` |
| BR-015 freeze (tender exists) | `boq-domain.test.ts` | `boq/domain.ts:55-57` |
| BR-013 TS prerequisite | `boq-domain.test.ts` | `boq/domain.ts:62-64` |
| Delete guard (measurement/award) | `orphan-consumers.test.ts` | `boq/consumer.ts:156-174` |
| Quantity change guard after measurement | `boq-guards-property.test.ts` | `boq/consumer.ts:116-120` |
| Duplicate line prevention | **N/A** — no unique constraint check in consumer | `boq/consumer.ts:14-54` |
| Concurrent update (optimistic lock) | **N/A** — no version field on BoQ items | `boq/schema.ts` |

### 04 — Work Execution (`execution/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Closure eligibility BR-029–034 | `execution-domain.test.ts`, `orphan-consumers.test.ts` | `execution/domain.ts:27-40` |
| Progress bounds | `execution-domain.test.ts`, `orphan-consumers.test.ts` | `execution/consumer.ts:98-101` |
| Parent/split consistency BR-032 | `execution-domain.test.ts`, `orphan-consumers.test.ts` | `execution/domain.ts:61-73` |
| Physical completion BR-035 | `execution-domain.test.ts` | `execution/domain.ts:45-47` |
| Asset handover on completion | `orphan-consumers.test.ts` | `execution/consumer.ts:251-275` |
| Issue lifecycle (open→close) | **Partial** — issue create tested; `issueClose` consumer not wired in routes | `execution/consumer.ts:19-45`, `topics.ts:41` |
| Photo/evidence RBAC | **Partial** — route auth in `all-routes.test.ts`; no object-level ACL | `execution/routes.ts` |

### 05 — Works Masters (`masters/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| All 17 registry masters | `masters-registry.test.ts`, `all-routes.test.ts` | `masters/registry.ts:27-45` |
| CQRS masterCreate (not proposalCreate) | `masters-cqrs.test.ts` | `masters/commands.ts`, `masters/consumer.ts` |
| Money field decode (rate/cost) | `masters-cqrs.test.ts`, `billing-money.consumer.test.ts` | `masters/registry.ts:42-44` |
| Unknown masterType rejection | `masters-cqrs.test.ts` | `masters/consumer.ts` |
| Cross-tenant master leak | **Partial** — tenantId from queue message; no live RLS integration test | `masters/consumer.ts:19` |
| Reference integrity on delete | **N/A** — masters are create-only (no delete route) | `masters/routes.ts` |

### 06 — Work Proposal (`proposal/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Work number / category / COA | `proposal-domain.test.ts`, `all-routes.test.ts` | `proposal/domain.ts` |
| DAO finalize preconditions | `proposal-domain.test.ts` | `proposal/domain.ts:canDaoFinalize` |
| Split rules | `proposal-domain.test.ts`, `orphan-consumers.test.ts` | `proposal/domain.ts:canDeleteSplit` |
| Split totals reconciliation | **N/A** — no split-total validator in domain | `proposal/domain.ts` |
| One-time DAO finalization at route | **Partial** — domain tested; route 422 not isolated (mock gap) | `proposal/routes.ts` |

### 07 — Works Reporting (`reporting/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Summary aggregates | `reporting-aggregates.test.ts` | `reporting/routes.ts:13-23` |
| Status counts by lifecycle | `reporting-aggregates.test.ts` | `reporting/routes.ts:27-31` |
| Tenant-scoped reads | `reporting-aggregates.test.ts` | `reporting/routes.ts:14,30` |
| Read-only (GET only) | `reporting-aggregates.test.ts` | `reporting/routes.ts:8-32` |
| Date range filters | **N/A** — not implemented | `reporting/routes.ts` |
| Pagination on reports | **N/A** — not implemented | `reporting/routes.ts` |

### 08 — Tender & Award (`tender/`)

| Requirement | Test(s) | Evidence |
|-------------|---------|----------|
| Authority routing by amount | `tender-domain.test.ts`, `tender-award-finalization.test.ts` | `tender/domain.ts:14-18` |
| L1 bidder selection | `tender-domain.test.ts` | `tender/domain.ts:24-28` |
| Pre-tender finalization | `tender-domain.test.ts` | `tender/domain.ts:34-38` |
| DAO→DO sequential award | `tender-award-finalization.test.ts`, `orphan-consumers.test.ts` | `tender/routes.ts:48-72`, `tender/domain.ts:45-56` |
| Quotation add + idempotency | `orphan-consumers.test.ts` | `tender/consumer.ts:75-101` |
| Bid confidentiality | **N/A** — no field-level masking in API | `tender/routes.ts` |
| Vendor/BOQ consistency check | **N/A** — award create does not validate BOQ totals | `tender/consumer.ts:42-71` |

---

## Human-Review Items

1. **Finance hand-off:** Billing finalization does not emit a finance GL/payment event — confirm whether works→finance integration is deferred or missing.
2. **Bill amount vs award ceiling:** Only quantity (FR-BIL-011) is enforced; gross bill amount vs accepted award is not checked in domain or consumer.
3. **BoQ duplicate lines:** No idempotency/unique guard on `(workId, itemCode)` at consumer layer.
4. **Issue close workflow:** `COMMANDS.issueClose` exists in topics but no route/consumer test path found.
5. **Reporting filters:** Product may expect date/office filters on summary/status — not present in `reporting/routes.ts`.
6. **Bid confidentiality:** Tender quotations returned without role-based redaction — policy decision needed for viewer vs operator roles.

---

## Risks

- All new route/consumer tests use mocked DB/queue — no live Postgres RLS or integration stack run in this session.
- Concurrent finalization relies on guarded SQL `WHERE status = expected` in tender award consumer but not verified under race conditions.
- Property tests use bounded fast-check ranges; edge-case decimal quantities near BoQ limits need live DB precision validation.

---

## Quality Status

**Pass** — all 384 unit/route/consumer tests green. Conditional on human-review items above for production release evidence.
