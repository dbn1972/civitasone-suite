/**
 * raw-session-guc-guard.mjs — fixture-based unit tests (PERF-001 fix-up).
 *
 * Exercises the exported `checkTenantGucViolations()` / `checkAdvisoryLockViolations()`
 * functions directly against in-memory source strings, mirroring
 * tests/architecture/tenant-router-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/raw-session-guc-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  checkTenantGucViolations,
  checkAdvisoryLockViolations,
} from "../../scripts/ci/raw-session-guc-guard.mjs";

describe("raw-session-guc-guard: checkTenantGucViolations()", () => {
  it("reports a raw SQL `SET app.tenant_id = ...` (the exact PR #1098 defect) as a violation", () => {
    const source = `
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO budget.finance_heads (id, tenant_id) VALUES ('x', 'y');
`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].snippet).toContain("SET app.tenant_id");
  });

  it("reports raw `SET SESSION app.tenant_id = ...` as a violation", () => {
    const source = `SET SESSION app.tenant_id = '00000000-0000-0000-0000-000000000000';`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
  });

  it("reports set_config(..., false) (explicit session scope) as a violation", () => {
    const source = `select set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("set_config");
  });

  it("reports set_config(..., false) from a TS raw-SQL string as a violation", () => {
    const source = `
await sql.unsafe(\`select set_config('app.tenant_id', '\${T}', false)\`);
`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toHaveLength(1);
  });

  it("does NOT flag `SET LOCAL app.tenant_id = ...` — the safe pattern", () => {
    const source = `
DO $body$
BEGIN
  SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
END
$body$;
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag set_config(..., true) — the established safe pattern (migration 0025 / raw-tenant-guc.ts)", () => {
    const source = `
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
  UPDATE plan.audit_plans SET status = 'completed' WHERE id = '1';
END
$body$;
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag a raw SET mentioned only inside a SQL comment", () => {
    const source = `
-- Scoped to this migration script's session only.
-- Historical note: this used to be a raw SET app.tenant_id = 'x'; before the fix.
SELECT set_config('app.tenant_id', 'x', true);
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag a raw SET mentioned only inside a TS comment", () => {
    const source = `
// old code used to do: SET app.tenant_id = 'x';
await tx.unsafe(\`select set_config('app.tenant_id', '\${T}', true)\`);
`;
    expect(checkTenantGucViolations(source, false)).toEqual([]);
  });

  it("does NOT flag an unrelated SET (not app.*/tenant.*)", () => {
    const source = `SET lock_timeout = '5s';`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });
});

describe("raw-session-guc-guard: checkAdvisoryLockViolations()", () => {
  it("reports a session-scoped pg_advisory_lock as a violation (the hrms-service fixture's pre-fix shape)", () => {
    const source = `await sql.unsafe(\`select pg_advisory_lock(\${SEED_LOCK_KEY})\`);`;
    const violations = checkAdvisoryLockViolations(source, false);
    expect(violations).toHaveLength(1);
  });

  it("reports pg_try_advisory_lock_shared as a violation", () => {
    const source = `SELECT pg_try_advisory_lock_shared(42);`;
    expect(checkAdvisoryLockViolations(source, true)).toHaveLength(1);
  });

  it("does NOT flag pg_advisory_xact_lock (transaction-scoped, the fixed pattern)", () => {
    const source = `await tx.unsafe(\`select pg_advisory_xact_lock(\${SEED_LOCK_KEY})\`);`;
    expect(checkAdvisoryLockViolations(source, false)).toEqual([]);
  });

  it("does NOT flag pg_advisory_unlock (releasing, not acquiring)", () => {
    const source = `select pg_advisory_unlock(918273645);`;
    expect(checkAdvisoryLockViolations(source, true)).toEqual([]);
  });
});
