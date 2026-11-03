/**
 * UAT L2-N3 (bundle 16) -- the computation side of the run state machine, over
 * the REAL runCreate consumer (processPayrollRun) and real Postgres, with only
 * the HRMS HTTP client mocked (same harness as payroll-register-writer.test.ts).
 *
 *  - a finished computation leaves the run "computed" (ready for approval), no
 *    longer "processing" (which now only means the computation is running);
 *  - a redelivered runCreate never recomputes an approved run or resets it;
 *  - a failing pass only fails a run that is still processing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { PayrollInputEmployee } from "../src/shared/hrms-client.js";

const TENANT = randomUUID();
const FAIL_TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCT = randomUUID();
const DEPT = randomUUID();
const E1 = randomUUID();
const E2 = randomUUID();

function emp(id: string, no: string, basic: string): PayrollInputEmployee {
  return {
    id, employeeNo: no, fullName: no, basicMinor: basic, dateOfJoining: "2020-01-01", payStructureId: STRUCT,
    bankAccountNo: null, bankIfsc: null, pan: null, uan: null, cityClass: "X", taxRegime: "new",
    departmentId: DEPT, pensionScheme: "EPF",
  };
}
const EMPLOYEES = [emp(E1, "CS-E1", "3000000"), emp(E2, "CS-E2", "4500000")];

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    fetchPayrollInput: vi.fn(async (tenantId: string, month: string) => {
      if (tenantId === FAIL_TENANT) throw new NonRetryableError("hrms payroll-input failed: 500");
      return { month, employees: EMPLOYEES, lopDays: {}, overtimeHours: {} };
    }),
    fetchEmployeeSummaries: vi.fn(async () => new Map()),
  };
});

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
const { COMMANDS } = await import("../src/topics.js");
const memQueue = queue as unknown as MemoryQueue;

const inTenant = <T>(tenant: string, fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

type RunState = { status: string; version: number; slips: number; last_error: string | null };
async function runState(tenant: string, runId: string): Promise<RunState | undefined> {
  const rows = (await inTenant(tenant, (tx) => tx.execute(sql`
    SELECT r.status, r.version, r.last_error,
           (SELECT COUNT(*)::int FROM payroll.payroll_slips s WHERE s.run_id = r.id) AS slips
      FROM payroll.payroll_runs r WHERE r.id = ${runId}::uuid
  `))) as unknown as RunState[];
  return rows[0];
}

async function computeRun(tenant: string, runId: string, month: string): Promise<void> {
  await queue.publish(COMMANDS.runCreate, {
    messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: tenant, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: runId, tenantId: tenant, runNo: `RUN-CS-${month}-${runId.slice(0, 4)}`, month, structureId: STRUCT, runType: "regular" },
  });
  await memQueue.drain();
}

async function seedTenant(tenant: string): Promise<void> {
  await inTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, created_by, updated_by) VALUES (${STRUCT}::uuid, ${tenant}::uuid, ${"S"}, ${ACTOR}::uuid, ${ACTOR}::uuid) ON CONFLICT DO NOTHING`);
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, ${"2026-01-01"}::date, 5000)`);
  });
}

async function seedRun(tenant: string, runId: string, month: string, status: string): Promise<void> {
  await inTenant(tenant, (tx) => tx.execute(sql`
    INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, status, created_by, updated_by)
    VALUES (${runId}::uuid, ${tenant}::uuid, ${`RUN-CS-SEED-${month}`}, ${month}, ${STRUCT}::uuid, ${"regular"}, ${status}, ${ACTOR}::uuid, ${ACTOR}::uuid)
  `));
}

beforeAll(async () => {
  await seedTenant(TENANT);
  await seedTenant(FAIL_TENANT);
  registerPayrollConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await queue.stop();
  await sqlClient.end();
});

describe("payroll run computation status (UAT L2-N3)", () => {
  it("a finished computation leaves the run computed, with its slips written", async () => {
    const runId = randomUUID();
    await computeRun(TENANT, runId, "2026-08");
    const s = await runState(TENANT, runId);
    expect(s?.status).toBe("computed");
    expect(s?.slips).toBe(EMPLOYEES.length);
  });

  it("a redelivered runCreate for a computed run resumes it (no duplicate slips) and it stays computed", async () => {
    const runId = randomUUID();
    await computeRun(TENANT, runId, "2026-07");
    await computeRun(TENANT, runId, "2026-07");
    const s = await runState(TENANT, runId);
    expect(s?.status).toBe("computed");
    expect(s?.slips).toBe(EMPLOYEES.length);
  });

  it("a redelivered runCreate never recomputes an approved run or resets its status", async () => {
    const runId = randomUUID();
    await computeRun(TENANT, runId, "2026-06");
    await inTenant(TENANT, (tx) => tx.execute(sql`UPDATE payroll.payroll_runs SET status = ${"approved"} WHERE id = ${runId}::uuid`));
    const before = await runState(TENANT, runId);
    await computeRun(TENANT, runId, "2026-06");
    const after = await runState(TENANT, runId);
    expect(after?.status).toBe("approved");
    expect(after?.version).toBe(before?.version);
    expect(after?.slips).toBe(before?.slips);
  });

  it("a failing pass fails a run that is still processing", async () => {
    const runId = randomUUID();
    await seedRun(FAIL_TENANT, runId, "2026-05", "processing");
    await computeRun(FAIL_TENANT, runId, "2026-05");
    const s = await runState(FAIL_TENANT, runId);
    expect(s?.status).toBe("failed");
    expect(s?.last_error).toContain("hrms payroll-input failed");
  });

  it("a failing redelivered pass does not overwrite a computed or approved run", async () => {
    for (const [month, status] of [["2026-04", "computed"], ["2026-03", "approved"]] as const) {
      const runId = randomUUID();
      await seedRun(FAIL_TENANT, runId, month, status);
      await computeRun(FAIL_TENANT, runId, month);
      const s = await runState(FAIL_TENANT, runId);
      expect(s?.status, month).toBe(status);
      expect(s?.last_error, month).toBeNull();
    }
  });
});
