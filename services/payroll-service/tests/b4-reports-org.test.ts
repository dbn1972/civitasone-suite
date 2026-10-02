/**
 * b4-payroll-reports-org gap batch -- real-Postgres regression tests for the
 * backend halves of GAP-PAYROLL-COSTING-01 (report period filter),
 * GAP-PAYROLL-COMPARISON-02 (hasData), GAP-PAYROLL-DDOS-02 (mapping replace +
 * audited before/after) and GAP-PAYROLL-PAY-GROUPS-04 (IANA timezone).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { upsertDdo } from "../src/modules/payroll/commands.js";
import { createDdoBody, isValidIanaTimeZone } from "../src/modules/payroll/validators.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const memQueue = queue as unknown as MemoryQueue;

function token(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-b4" }, SECRET);
}
function ctx(): RequestContext {
  return { tenantId: TENANT, actorId: ACTOR, actorType: "user", roles: ["payroll_admin"], correlationId: randomUUID() };
}
const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) => runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

beforeAll(async () => {
  registerPayrollConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await queue.stop();
  await sqlClient.end();
});

describe("GET /v1/payroll/costing/report -- only the requested period's slips are allocated", () => {
  it("allocates split% of THAT month's finalised gross only -- not other months, not failed runs", async () => {
    const structureId = randomUUID();
    const julRun = randomUUID();
    const augRun = randomUUID();
    const julFailedRun = randomUUID();
    await inTenant(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, created_by, updated_by) VALUES (${structureId}::uuid, ${TENANT}::uuid, 'S', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      for (const [id, month, status] of [[julRun, "2026-07", "approved"], [augRun, "2026-08", "disbursed"], [julFailedRun, "2026-07", "failed"]] as const) {
        await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by) VALUES (${id}::uuid, ${TENANT}::uuid, ${"R-" + month + "-" + status}, ${month}, ${structureId}::uuid, ${status}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      }
      // Review fix (PR #1762): a failed July run keeps its slips; a rerun for
      // the same month is allowed, so counting it would double-allocate July.
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, created_by, updated_by) VALUES (${TENANT}::uuid, ${julFailedRun}::uuid, ${randomUUID()}::uuid, 'E1F', 1000000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      // Jul gross 1,000,000 paise; Aug gross 3,000,000 paise.
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, created_by, updated_by) VALUES (${TENANT}::uuid, ${julRun}::uuid, ${randomUUID()}::uuid, 'E1', 1000000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, created_by, updated_by) VALUES (${TENANT}::uuid, ${augRun}::uuid, ${randomUUID()}::uuid, 'E2', 3000000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`INSERT INTO payroll.costing_rules (tenant_id, employee_group, cost_center_id, split_pct, created_by) VALUES (${TENANT}::uuid, 'Teachers', ${randomUUID()}::uuid, 50, ${ACTOR}::uuid)`);
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report?period=2026-07", headers: { authorization: `Bearer ${token()}` } });
    const empty = await app.inject({ method: "GET", url: "/v1/payroll/costing/report?period=2026-01", headers: { authorization: `Bearer ${token()}` } });
    await app.close();

    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ allocated_minor: string | number }>;
    expect(rows).toHaveLength(1);
    // 50% of July's approved 1,000,000 -- previously 50% of 5,000,000 (all
    // periods plus the failed July run).
    expect(String(rows[0].allocated_minor)).toBe("500000");
    expect(String((empty.json().data as Array<{ allocated_minor: unknown }>)[0].allocated_minor)).toBe("0");
  });
});

describe("GET /v1/payroll/comparison -- hasData distinguishes a missing period from ₹0", () => {
  it("flags the period with no register rows", async () => {
    // GAP-PAYROLL-REGISTER-WRITER: the summary only counts finalised runs,
    // and headcount is distinct employees on that run's slips.
    const runId = randomUUID();
    await inTenant(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by) VALUES (${runId}::uuid, ${TENANT}::uuid, 'R-2026-05-cmp', '2026-05', ${randomUUID()}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      for (const no of ["C1", "C2", "C3"]) {
        await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, created_by, updated_by) VALUES (${TENANT}::uuid, ${runId}::uuid, ${randomUUID()}::uuid, ${no}, 100000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      }
      await tx.execute(sql`
        INSERT INTO payroll.payroll_register (tenant_id, run_id, department_name, employee_count, total_gross_minor, total_net_minor, period)
        VALUES (${TENANT}::uuid, ${runId}::uuid, 'Revenue', 3, 300000, 270000, '2026-05')
      `);
    });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/comparison?period1=2026-05&period2=2026-06", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period1.hasData).toBe(true);
    expect(Number(body.period1.headcount)).toBe(3);
    expect(body.period2.hasData).toBe(false);
  });
});

describe("DDO upsert -- an explicit department list replaces the mapping, audited", () => {
  const D1 = randomUUID();
  const D2 = randomUUID();
  const D3 = randomUUID();

  async function mapping(code: string): Promise<string[]> {
    const rows = (await inTenant((tx) => tx.execute(sql`
      SELECT department_id::text AS id FROM payroll.payroll_ddo_departments WHERE tenant_id = ${TENANT}::uuid AND ddo_code = ${code} ORDER BY department_id
    `))) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  it("unmaps departments missing from the new list and records before/after + reason", async () => {
    await upsertDdo(ctx(), createDdoBody.parse({ ddoCode: "B4-DDO", name: "Treasury", departmentIds: [D1, D2] }));
    await memQueue.drain();
    expect(await mapping("B4-DDO")).toEqual([D1, D2].sort());

    await upsertDdo(ctx(), createDdoBody.parse({ ddoCode: "B4-DDO", name: "Treasury", departmentIds: [D2, D3], reason: "Revenue moved to its own DDO" }));
    await memQueue.drain();
    expect(await mapping("B4-DDO")).toEqual([D2, D3].sort());

    const audit = (await inTenant((tx) => tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceType' = 'payroll_ddo'
      ORDER BY created_at DESC LIMIT 1
    `))) as unknown as Array<{ payload: { oldValue?: { departmentIds: string[] }; newValue?: { departmentIds: string[] }; reason?: string } }>;
    expect(audit[0]?.payload.reason).toBe("Revenue moved to its own DDO");
    expect([...(audit[0]?.payload.oldValue?.departmentIds ?? [])].sort()).toEqual([D1, D2].sort());
    expect(audit[0]?.payload.newValue?.departmentIds).toEqual([D2, D3]);
  });

  it("leaves the mapping untouched when departmentIds is omitted (rename only)", async () => {
    await upsertDdo(ctx(), createDdoBody.parse({ ddoCode: "B4-DDO", name: "Treasury (renamed)" }));
    await memQueue.drain();
    expect(await mapping("B4-DDO")).toEqual([D2, D3].sort());
  });

  it("without a reason, departmentIds is add-only: an old client sending [] cannot wipe the mapping (review fix)", async () => {
    await upsertDdo(ctx(), createDdoBody.parse({ ddoCode: "B4-DDO", name: "Treasury", departmentIds: [] }));
    await memQueue.drain();
    expect(await mapping("B4-DDO")).toEqual([D2, D3].sort());
    const D4 = randomUUID();
    await upsertDdo(ctx(), createDdoBody.parse({ ddoCode: "B4-DDO", name: "Treasury", departmentIds: [D4] }));
    await memQueue.drain();
    expect(await mapping("B4-DDO")).toEqual([D2, D3, D4].sort());
  });

  it("with a reason, [] really unmaps every department", async () => {
    await upsertDdo(ctx(), createDdoBody.parse({ ddoCode: "B4-DDO", name: "Treasury", departmentIds: [], reason: "DDO office closed down" }));
    await memQueue.drain();
    expect(await mapping("B4-DDO")).toEqual([]);
  });

  it("validates the body: de-duplicates ids, reason >= 10 chars", () => {
    expect(createDdoBody.parse({ ddoCode: "X", name: "Y", departmentIds: [D1, D1] }).departmentIds).toEqual([D1]);
    expect(() => createDdoBody.parse({ ddoCode: "X", name: "Y", reason: "short" })).toThrow();
  });
});

describe("POST /v1/payroll/pay-groups -- timezone must be a real IANA zone", () => {
  it("rejects Mars/Base with 400 and accepts Asia/Kolkata", async () => {
    expect(isValidIanaTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidIanaTimeZone("Mars/Base")).toBe(false);
    const app = await buildApp();
    const bad = await app.inject({
      method: "POST", url: "/v1/payroll/pay-groups", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "G", frequency: "monthly", payDayOfMonth: 28, timezone: "Mars/Base" },
    });
    const good = await app.inject({
      method: "POST", url: "/v1/payroll/pay-groups", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "G", frequency: "monthly", payDayOfMonth: 28, timezone: "Asia/Kolkata" },
    });
    await app.close();
    expect(bad.statusCode).toBe(400);
    expect(good.statusCode).toBe(202);
  });
});
