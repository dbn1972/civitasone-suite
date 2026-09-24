/**
 * CRITICAL regression (real Postgres, no mocks) — PR #1552 review.
 *
 * migrations/0044_fnf_settlements_unique.sql's unique index on (tenant_id,
 * employee_id) had no date dimension, but an employee CAN be legitimately
 * separated more than once (separate -> reinstate -> separate again) -- see
 * hrms-service/src/modules/employee/commands.ts's separateEmployee(), whose
 * messageId is deliberately keyed on `employeeId:effectiveDate` for exactly
 * that reason. Live-reproduced against real Postgres: settlement #1
 * (resignation, 2025-01-01) inserted; settlement #2 (retirement, 2025-06-30)
 * for the SAME employee -- a different, entirely legitimate exit -- was
 * silently dropped by `ON CONFLICT (tenant_id, employee_id) DO NOTHING`
 * (fnf/consumer.ts). Zero rows written, zero error, zero log.
 *
 * migrations/0045_fnf_settlements_unique_with_date.sql widens the unique key
 * to (tenant_id, employee_id, separation_date). This file proves the fixed
 * behaviour end to end against a REAL Postgres instance -- deliberately NOT
 * mocking `shared/db.js` / `shared/outbox.js` the way
 * fnf-consumer-dedup.test.ts does, because that bug class was only ever
 * caught by live reproduction, never by the existing mocked coverage of the
 * consumer's own onConflictDoNothing handling (which is agnostic to which
 * columns are in the conflict target and so could not have caught a
 * date-dimension regression either way).
 *
 * Requires DATABASE_URL to point at a real, migrated (through at least 0045)
 * Postgres instance -- see vitest.config.ts's REL-035 note; run against your
 * own disposable instance, never the shared long-lived dev DB.
 *
 * Tenant scoping: payroll.fnf_settlements is FORCE ROW LEVEL SECURITY
 * (tenant_isolation_policy: tenant_id = payroll.current_tenant_id(), backed
 * by the `app.tenant_id` GUC). In production, payroll-service's worker.ts
 * wraps every queue.subscribe callback in `runWithTenant(msg.tenantId, ...)`
 * before invoking the handler (registerFnfConsumers itself does not call it
 * directly -- worker.ts's subscribe wrapper is what supplies the tenant GUC
 * for every consumer fleet-wide). This test uses the raw MemoryQueue the
 * same way the existing mock-based tests do, which bypasses that wrapper, so
 * it replicates it explicitly around each publish. Read-back verification
 * queries use `withTenantScope` directly (mirrors
 * sec-009-force-rls.test.ts's own real-DB harness).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerFnfConsumers } from "../src/modules/fnf/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "50000000-eeee-4000-8000-000000000001";
const ACTOR = "60000000-ffff-4000-8000-000000000001";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

function computePayload(
  employeeId: string,
  separationDate: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    employeeId,
    tenantId: TENANT,
    separationDate,
    separationType: "retirement",
    employeeCategory: "non_govt_covered",
    noticeBuyoutMinor: "0",
    leaveEncashmentGrossMinor: "0",
    gratuityGrossMinor: "1000000",
    retrenchmentCompMinor: "0",
    vrsCompMinor: "0",
    arrearsMinor: "0",
    lastDrawnWagesMinor: "5000000",
    completedYears: 10,
    avgSalaryLast10MonthsMinor: "5000000",
    leaveBalanceDays: 0,
    priorLeaveEncashExemptionMinor: "0",
    remainingMonthsToRetirement: 0,
    taxRegime: "new",
    salaryYtdMinor: "0",
    tdsYtdMinor: "0",
    deductions80cMinor: "0",
    deductions80dMinor: "0",
    otherDeductionsMinor: "0",
    fyStartYear: 2026,
    ...overrides,
  };
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.fnfCompute,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerFnfConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 200));

/** Mirrors worker.ts's `runWithTenant(msg.tenantId, () => handler(msg))` wrap. */
async function publishScoped(q: MemoryQueue, payload: Record<string, unknown>): Promise<void> {
  await runWithTenant(TENANT, async () => {
    await q.publish(COMMANDS.fnfCompute, makeMsg(payload));
    await settle();
  });
}

async function settlementRows(employeeId: string): Promise<Array<Record<string, unknown>>> {
  return withTenantScope(db as never, TENANT, async (tx: TxRunner) =>
    rowsOf(
      await tx.execute(sql`
        SELECT id, separation_date::text AS separation_date, separation_type
        FROM payroll.fnf_settlements
        WHERE tenant_id = ${TENANT} AND employee_id = ${employeeId}
        ORDER BY separation_date
      `),
    ),
  );
}

describe("payroll.fnf_settlements unique index — real Postgres (PR #1552 review, live-reproduced fix)", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  it("migration 0045 replaced the 2-column index with a 3-column (tenant_id, employee_id, separation_date) one", async () => {
    // pg_indexes is a system catalog, not subject to the tenant_isolation_policy
    // RLS policy -- no tenant scoping needed for this query.
    const rows = rowsOf(
      await db.execute(sql`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'payroll' AND tablename = 'fnf_settlements'
          AND indexname IN ('fnf_settlements_tenant_employee_uq', 'fnf_settlements_tenant_employee_date_uq')
      `),
    );
    const byName = new Map(rows.map((r) => [r.indexname as string, r.indexdef as string]));

    expect(byName.has("fnf_settlements_tenant_employee_uq")).toBe(false);
    const def = byName.get("fnf_settlements_tenant_employee_date_uq");
    expect(def, "expected the 0045 index to exist").toBeDefined();
    expect(def).toContain("tenant_id");
    expect(def).toContain("employee_id");
    expect(def).toContain("separation_date");
  });

  it("two legitimate settlements for the same employee with different separation dates BOTH persist", async () => {
    const employeeId = randomUUID();
    const q = await buildQueue();
    try {
      await publishScoped(q, computePayload(employeeId, "2025-01-01", { separationType: "resignation" }));
      await publishScoped(q, computePayload(employeeId, "2025-06-30", { separationType: "retirement" }));
    } finally {
      await q.stop();
    }

    const rows = await settlementRows(employeeId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.separation_date).sort()).toEqual(["2025-01-01", "2025-06-30"]);
    expect(rows.map((r) => r.separation_type).sort()).toEqual(["resignation", "retirement"]);
  });

  it("a true duplicate (same employee, same separation date, different messageId) is still deduped to one row", async () => {
    const employeeId = randomUUID();
    const q = await buildQueue();
    try {
      await publishScoped(q, computePayload(employeeId, "2025-03-15"));
      const afterFirst = await settlementRows(employeeId);
      expect(afterFirst).toHaveLength(1);
      const firstId = afterFirst[0]!.id;

      // Same employee + same separation_date, but a genuinely different
      // messageId (makeMsg mints a fresh randomUUID() every call) -- mirrors
      // POST /v1/payroll/fnf/compute's own fresh randomUUID() per request
      // (fnf/routes.ts), i.e. a case markProcessed's inbox dedup does NOT
      // catch on its own. This isolates and proves the DB constraint itself.
      await publishScoped(q, computePayload(employeeId, "2025-03-15"));

      const afterSecond = await settlementRows(employeeId);
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0]!.id).toBe(firstId);
    } finally {
      await q.stop();
    }
  });
});
