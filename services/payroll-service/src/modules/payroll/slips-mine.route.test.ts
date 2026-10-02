import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

/**
 * GAP-PAYROLL-SALARY-SLIPS-04: GET /v1/payroll/slips/mine against a real
 * migrated Postgres (RLS on). Only the cross-service HRMS identity lookup is
 * stubbed: actor -> employee id. The route must take the employee from that
 * token-derived identity ONLY.
 */
const { ALICE_ACTOR, ALICE_EMP, BOB_EMP, UNLINKED_ACTOR } = vi.hoisted(() => ({
  ALICE_ACTOR: "11111111-0000-4000-8000-0000000000a1",
  ALICE_EMP: "22222222-0000-4000-8000-0000000000a1",
  BOB_EMP: "22222222-0000-4000-8000-0000000000b2",
  UNLINKED_ACTOR: "11111111-0000-4000-8000-0000000000c3",
}));

vi.mock("../../shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/hrms-client.js")>();
  return {
    ...actual,
    fetchEmployeeSummaries: async () => new Map(),
    resolveActorEmployeeId: async (_tenant: string, actor: string) => (actor === ALICE_ACTOR ? ALICE_EMP : null),
  };
});

import { buildApp } from "../../app.js";
import { db, sqlClient } from "../../shared/db.js";
import * as repo from "./repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

describe("GET /v1/payroll/slips/mine (real Postgres)", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const creator = randomUUID();
  const aliceSlipIds: string[] = [];
  let bobSlipId = "";
  let computedSlipId = "";
  let approvedSlipId = "";
  let heldSlipId = "";
  let exceptionSlipId = "";
  let otherTenantAliceSlipId = "";

  const runs = new Map<string, string>(); // one regular run per (tenant, month)
  async function seedSlip(tenant: string, employeeId: string, month: string, status: string) {
    const slipId = randomUUID();
    await runWithTenant(tenant, () =>
      db.transaction(async (tx) => {
        let runId = runs.get(`${tenant}:${month}`);
        if (!runId) {
          runId = randomUUID();
          runs.set(`${tenant}:${month}`, runId);
          await repo.insertRun(tx, {
            id: runId, tenantId: tenant, runNo: `T-MINE-${runId.slice(0, 8)}`, month,
            departmentId: null, structureId: randomUUID(), runType: "regular", ddoCode: null,
            totalGrossMinor: 100n, totalNetMinor: 80n, currency: "INR", status: "processing",
            createdBy: creator, updatedBy: creator,
          });
        }
        await repo.insertSlip(tx, {
          id: slipId, tenantId: tenant, runId, employeeId, employeeNo: "EMP-X",
          basicMinor: 50n, grossMinor: 100n, totalDeductionsMinor: 20n, netPayMinor: 80n, currency: "INR",
          components: [], status, createdBy: creator, updatedBy: creator,
        });
      }),
    );
    return slipId;
  }

  beforeAll(async () => {
    aliceSlipIds.push(await seedSlip(tenantId, ALICE_EMP, "2026-07", "paid"));
    aliceSlipIds.push(await seedSlip(tenantId, ALICE_EMP, "2026-08", "paid"));
    computedSlipId = await seedSlip(tenantId, ALICE_EMP, "2026-09", "computed");
    approvedSlipId = await seedSlip(tenantId, ALICE_EMP, "2026-10", "approved");
    heldSlipId = await seedSlip(tenantId, ALICE_EMP, "2026-11", "held");
    exceptionSlipId = await seedSlip(tenantId, ALICE_EMP, "2026-12", "exception");
    bobSlipId = await seedSlip(tenantId, BOB_EMP, "2026-08", "paid");
    otherTenantAliceSlipId = await seedSlip(otherTenantId, ALICE_EMP, "2026-08", "paid");
  });
  afterAll(async () => { await sqlClient.end(); });

  async function get(url: string, token?: string) {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : {} });
    await app.close();
    return res;
  }
  const aliceToken = () => signToken({ sub: ALICE_ACTOR, tid: tenantId, roles: ["employee"], sid: "s-mine-a" }, SECRET);

  it("returns only the caller's own FINAL slips (paid/approved), newest period first, in the list summary shape", async () => {
    const res = await get("/v1/payroll/slips/mine", aliceToken());
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual([approvedSlipId, aliceSlipIds[1], aliceSlipIds[0]]);
    expect(rows[0]!.status).toBe("finalized");
    expect(rows[1]!.status).toBe("paid");
    expect(rows.every((r) => r.employeeId === ALICE_EMP)).toBe(true);
    expect(Object.keys(rows[0]!).sort()).toEqual(["department", "deductions", "employeeId", "employeeName", "gross", "id", "net", "payPeriod", "status"].sort());
  });

  it("never returns the net pay of a computed, held or exception slip", async () => {
    const res = await get("/v1/payroll/slips/mine?limit=100", aliceToken());
    for (const hidden of [computedSlipId, heldSlipId, exceptionSlipId]) expect(res.body).not.toContain(hidden);
    expect(JSON.parse(res.body)).toHaveLength(3);
  });

  it("never returns another employee's or another tenant's slips, even when an employeeId is passed in the query", async () => {
    for (const url of [`/v1/payroll/slips/mine?employeeId=${BOB_EMP}`, `/v1/payroll/slips/mine?employee_id=${BOB_EMP}&tenantId=${otherTenantId}`]) {
      const res = await get(url, aliceToken());
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(bobSlipId);
      expect(res.body).not.toContain(otherTenantAliceSlipId);
      expect(res.body).not.toContain(BOB_EMP);
    }
  });

  it("returns 401 with no token", async () => {
    const res = await get("/v1/payroll/slips/mine");
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty list (not someone else's slips) when the actor has no linked employee record", async () => {
    const t = signToken({ sub: UNLINKED_ACTOR, tid: tenantId, roles: ["employee"], sid: "s-mine-u" }, SECRET);
    const res = await get("/v1/payroll/slips/mine", t);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it("bounds paging: limit/offset apply, and limit above 100 is rejected", async () => {
    const page = await get("/v1/payroll/slips/mine?limit=1&offset=1", aliceToken());
    const rows = JSON.parse(page.body) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([aliceSlipIds[1]]); // [approved, paid-08, paid-07] -> offset 1
    const tooBig = await get("/v1/payroll/slips/mine?limit=101", aliceToken());
    expect(tooBig.statusCode).toBe(400);
  });

  it("is not shadowed by /slips/:id (mine is not parsed as a slip id)", async () => {
    const res = await get("/v1/payroll/slips/mine", aliceToken());
    expect(res.statusCode).not.toBe(400);
  });
});
