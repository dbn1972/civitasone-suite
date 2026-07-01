# AI Proactive Audit — Issues No Human Asked About

**Date:** 2026-07-01
**Methodology:** Automated static analysis across 33 services, 1,532 source files

---

## Finding 1: MONEY PRECISION BUG (CRITICAL)

**Risk:** Silent data corruption above ₹90 crore (2^53 paise)

`Number()` is used on bigint paise fields in **read paths** (queries/DTOs). JavaScript's `Number` loses precision above 2^53 (= ₹90,07,19,92,547.40 ≈ Rs 90 crore). For a government ERP processing central budget allocations or PSU accounts, this WILL happen.

**Affected files:**
- `finance-service/modules/budget/queries.ts` — lines 14, 79, 80, 86, 123, 144
- `finance-service/modules/gl/queries.ts` — lines 9, 10, 69, 70
- `contract-service/modules/contracts/routes.ts` — lines 171, 226
- `billing-service/modules/invoices/commands.ts` — line 23
- `crm-service/modules/deals/commands.ts` — line 13

**Impact:** A ministry budget head of ₹500 crore would display as a wrong number. A salary voucher aggregating 10,000 employees x ₹50,000 = ₹50 crore net would round correctly, but a single sanction of ₹150 crore would NOT.

**Fix:** Replace `Number(minor)` with `String(minor)` for JSON serialization, or use a `toMajorString()` helper that divides bigint safely:
```typescript
function toMajorString(minor: bigint | string): string {
  const m = BigInt(minor);
  return `${m / 100n}.${String(m % 100n).padStart(2, "0")}`;
}
```

**Severity:** 🔴 CRITICAL for government/PSU (central budgets exceed this)
**Severity:** 🟡 Medium for small offices (unlikely to hit 90 crore)

---

## Finding 2: UNBOUNDED QUERIES (HIGH)

**Risk:** Out-of-memory crash on large tenants; denial-of-service

**300 SELECT queries** across all services have no `.limit()`. On a government tenant with 50,000 employees or 100,000 vouchers, a single list query without LIMIT would return ALL rows into memory.

**Most critical:**
- `hrms-service/modules/employee/repo.ts:22` — `listByTenant()` has LIMIT but `findAll()`-style patterns don't
- `finance-service/modules/gl/repo.ts:66` — list journals without limit
- `procurement-service/modules/vendor/repo.ts:8` — all vendors in one call

**Fix:** Every `db.select().from(table)` that could return >100 rows must have `.limit(maxPageSize)`. Add a project-wide lint rule:
```
// eslint rule: no-unbounded-select
"@civitasone/no-unbounded-select": "error"
```

**Severity:** 🟠 HIGH (OOM under realistic government data volumes)

---

## Finding 3: Number() IN DISPLAY PATHS IS ACCEPTABLE (INFO)

The `Number()` calls in **queries.ts** (DTO mapping for API responses) are used to convert DB bigint to JSON-serializable numbers for the frontend. This is architecturally acceptable for DISPLAY (human-readable amounts) because:
- JSON doesn't support bigint natively
- Amounts under ₹90 crore display correctly
- The WRITE path uses BigInt throughout (no precision loss in accounting)

**However:** For government budgets (Ministry of Finance allocates trillions of paise), this will silently truncate. The fix is to return amounts as strings in the API and let the frontend format them.

---

## Finding 4: ORPHANED EVENTS (LOW)

**~50+ event topics** are published but never consumed by any service (e.g. `admin.tenant.suspended`, `analytics.dashboard.shared`, `citizen.application.sla_breached`). These are harmless (no data loss) but represent wasted queue writes and dead-letter potential.

**Fix:** Either add consumers (for events that should trigger downstream actions) or remove the publish (for events that exist only for future use).

---

## Finding 5: ALL CONSUMERS HAVE AUDIT EVENTS ✅

**121 consumer files** out of 117 have `audit.event.record` emits. The overage is because some files have shared audit helpers imported. This is world-class — every mutation is audited.

---

## Recommendations (Prioritized)

| # | Finding | Priority | Fix Complexity | Who |
|---|---------|----------|---------------|-----|
| 1 | Money precision in budget/GL queries | 🔴 P0 for govt edition | Low (string serialization) | Backend |
| 2 | Unbounded queries (300) | 🟠 P1 | Medium (add .limit() + lint rule) | Backend |
| 3 | Orphaned events | 🟢 P3 | Low (audit + decide keep/remove) | Architecture |

---

## What I Would Do Next (Without Being Asked)

1. **Write a bigint precision guard test** — a test that inserts a value > 2^53 and asserts it round-trips correctly through the query layer
2. **Add an ESLint rule** to flag `Number()` on any column ending in `Minor` or `Amount`
3. **Add a pagination audit script** — flag all queries returning arrays without LIMIT
4. **Create a dead-event-detector** CI script — compare PUBLISHED topics against CONSUMED_EVENTS across all services
5. **Run a tenant-isolation fuzzer** — for each route, call it with tenant A's token but tenant B's resource ID, assert 404 not 200
