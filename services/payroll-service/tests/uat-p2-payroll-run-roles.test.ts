/**
 * UAT Phase 2 C8 — SECURITY (roles-11021730 R1, T3 F-7 / F108): a finance
 * officer could open /hr/payroll and read every payroll run (period, employee
 * count, gross / deductions / net). Payroll runs are payroll + HR data: the run
 * register and a run's detail now admit payroll_admin, payroll_officer,
 * super_admin and hr_admin only. Other finance-facing payroll reads are
 * unchanged (structures stays readable by finance_officer).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns } from "../src/modules/payroll/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-0000000000c8";
const ACTOR = "00000000-00c8-4000-8000-000000000001";
const RUN_ID = randomUUID();

const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-c8" }, SECRET)}` });

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(payrollRuns).values({
    id: RUN_ID, tenantId: TENANT, runNo: "RUN-C8-001", month: "2026-07", structureId: randomUUID(), status: "draft",
    createdBy: ACTOR, updatedBy: ACTOR,
  })));
});
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT))));
  await app.close();
  await sqlClient.end();
});

describe("C8 payroll runs are payroll/HR only", () => {
  for (const roles of [["finance_officer"], ["finance_admin"], ["finance_officer", "budget_officer"], ["employee"]]) {
    it(`${roles.join("+")}: 403 on the run register and on a run's detail`, async () => {
      const list = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth(roles) });
      expect(list.statusCode).toBe(403);
      const detail = await app.inject({ method: "GET", url: `/v1/payroll/runs/${RUN_ID}`, headers: auth(roles) });
      expect(detail.statusCode).toBe(403);
      expect(detail.body).not.toContain("RUN-C8-001");
    });
  }

  for (const role of ["payroll_admin", "payroll_officer", "hr_admin", "super_admin"]) {
    it(`${role}: 200 on the run register and the run's detail`, async () => {
      const list = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth([role]) });
      expect(list.statusCode).toBe(200);
      const detail = await app.inject({ method: "GET", url: `/v1/payroll/runs/${RUN_ID}`, headers: auth([role]) });
      expect(detail.statusCode).toBe(200);
    });
  }

  it("finance_officer keeps its other payroll reads (structures 200)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures", headers: auth(["finance_officer"]) });
    expect(res.statusCode).toBe(200);
  });
});
