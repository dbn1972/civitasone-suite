/**
 * Shared sqlClient test double for hrms-service tests that fully replace
 * `../shared/db.js` via `vi.mock` (rather than spreading the real module
 * through `importOriginal`, which several other test files in this service
 * do and which already carries the real, fully-capable client).
 *
 * Shaped to match what `withRawTenantGuc` (packages/db/src/raw-tenant-guc.ts)
 * actually calls on it, so these tests exercise the SAME transactional /
 * tenant-GUC-scoping code path production traffic does, instead of silently
 * no-op'ing. `shared/audit.ts`'s writeAuditLog calls `withRawTenantGuc`
 * for every mutating (non-GET) response -- via app.ts's onResponse hook, so
 * it runs regardless of which module's routes a given test file is actually
 * about -- and withRawTenantGuc needs:
 *   - `sqlClient.begin(fn)` to invoke `fn` with a transaction handle `tx`
 *   - `tx` to be callable as a tagged template (its first statement is
 *     `` tx`SELECT set_config('app.tenant_id', ...)` ``)
 *   - `tx.unsafe(text, params)` for the caller's own query (here, the
 *     audit.hr_action_log INSERT)
 *
 * TX-015: before this factory existed, ~28 of these full-replacement
 * doubles only exposed `.end()`, so writeAuditLog's
 * `typeof sqlClient.begin === "function"` check was always false and these
 * tests silently fell back to the pre-TX-013 `.unsafe()` call shape --
 * never actually exercising withRawTenantGuc's tenant-scoping logic.
 *
 * None of these files' route code under test touches `sqlClient`/`sqlPool`
 * directly (only the audit-log write does), so the double only needs to be
 * realistic enough for that path -- it does not need to route business-query
 * results back to a per-test queue the way tests/id-cards-routes.test.ts and
 * tests/medical-routes.test.ts do (those two modules' routes DO call
 * `sqlPool.query`/`sqlClient.unsafe` directly for real business logic, so
 * their own doubles distinguish the audit INSERT from the route's own query
 * via an `isAuditInsert` check -- mirror that pattern instead of this one if
 * a future module here needs the same treatment).
 *
 * Three call sites live under `src/` (src/__tests__/department-routes.test.ts,
 * src/integration/hrms-payroll.integration.test.ts,
 * src/modules/apar/f3-consumer.test.ts) and so cannot import this file:
 * tsconfig.json scopes `rootDir` to `./src`, and this fixture lives under the
 * sibling `tests/` directory -- `tsc --noEmit` rejects any file inside `src/`
 * that reaches outside it. Those three files inline the same shape locally
 * instead (see the identical construction below) rather than moving this
 * fixture into `src/`, which would pull test-only code into the compiled
 * `dist/` output alongside application code.
 *
 * The base is a plain arrow function, not `vi.fn(...)`: TypeScript's
 * "properties on const functions" inference (since 3.1) only recognizes a
 * function/arrow *expression* as the declaration being extended, not the
 * value returned by a call like `vi.fn(...)` -- so `sqlClientFn.end = ...`
 * below only type-checks because `sqlClientFn` itself is declared as `(...)
 * => ...`, matching the working precedent in tests/id-cards-routes.test.ts /
 * tests/medical-routes.test.ts. The individual members can still be
 * `vi.fn(...)`-wrapped (giving callers `.mock.calls` if a test ever needs
 * it) since only the *base* triggered the inference gap.
 */
import { vi } from "vitest";

export function createMockSqlClient() {
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return sqlClientFn;
}
