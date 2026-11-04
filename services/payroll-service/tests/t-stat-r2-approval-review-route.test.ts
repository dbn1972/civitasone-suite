/**
 * T-STAT review SF4 / SF5 / SF7: GET /v1/payroll/runs/:id/approval-review is
 * wired, role-gated, tenant-scoped and returns the validated shape the web
 * approve dialog reads (money as paise digit strings).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/payroll/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const tenant = randomUUID();
const actor = randomUUID();
const runId = randomUUID();
const zeroEmp = randomUUID();
const arrEmp = randomUUID();
const token = (tid: string, roles: string[]) => signToken({ sub: actor, tid, roles, sid: "r2" }, SECRET, 3600);
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await repo.insertRun(tx, {
      id: runId, tenantId: tenant, runNo: "R2-ROUTE", month: "2026-08", departmentId: null, structureId: randomUUID(), runType: "regular",
      ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing", createdBy: actor, updatedBy: actor,
    });
    await repo.insertSlip(tx, {
      id: randomUUID(), tenantId: tenant, runId, employeeId: zeroEmp, employeeNo: "Z-9", basicMinor: 0n, grossMinor: 0n,
      totalDeductionsMinor: 0n, netPayMinor: 0n, currency: "INR", components: [], status: "computed", createdBy: actor, updatedBy: actor,
    });
    await repo.insertSlip(tx, {
      id: randomUUID(), tenantId: tenant, runId, employeeId: arrEmp, employeeNo: "A-9", basicMinor: 3000000n, grossMinor: 11000000n,
      totalDeductionsMinor: 0n, netPayMinor: 11000000n, currency: "INR",
      components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 5000000 }, { code: "ARREAR", name: "Arrears", type: "earning", amountMinor: 6000000 }],
      status: "computed", createdBy: actor, updatedBy: actor,
    });
  }));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/payroll/runs/:id/approval-review", () => {
  it("returns the Rs 0-basic slips and the arrears list for a payroll admin", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${runId}/approval-review`, headers: { authorization: `Bearer ${token(tenant, ["payroll_admin"])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      runId,
      zeroBasic: [{ employeeId: zeroEmp, employeeNo: "Z-9" }],
      arrears: {
        totalMinor: "6000000", thresholdBps: 10000,
        employees: [{ employeeId: arrEmp, employeeNo: "A-9", arrearsMinor: "6000000", regularGrossMinor: "5000000", requiresReview: true }],
      },
      // UAT T-PERIOD D-02b: slips paying nothing (none here: the Rs 0-basic slip has its own guard).
      nonPositiveNet: [],
    });
  });

  it("another tenant cannot see the run (404)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${runId}/approval-review`, headers: { authorization: `Bearer ${token(randomUUID(), ["payroll_admin"])}` } });
    expect(res.statusCode).toBe(404);
  });
});
