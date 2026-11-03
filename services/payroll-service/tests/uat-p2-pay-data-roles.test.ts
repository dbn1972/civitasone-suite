/**
 * UAT Phase 2 follow-up — SECURITY: per-employee pay data (salary-slip
 * register, a single slip and its PDF, pay structures, pensioner records) is
 * payroll + HR only, like the run register (C8). An employee keeps their OWN
 * slip (self-service), including a finance officer who is also an employee.
 * Finance (DDO / PAO) gets aggregate per-run totals from GET /runs/totals,
 * with no per-employee rows.
 */
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";

const OWN_EMPLOYEE = "00000000-00c9-4000-8000-0000000000e1";
const COLLEAGUE = "00000000-00c9-4000-8000-0000000000e2";
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, resolveActorEmployeeId: async () => OWN_EMPLOYEE };
});

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-0000000000c9";
const ACTOR = "00000000-00c9-4000-8000-000000000001";
const RUN_ID = randomUUID();
const OWN_SLIP = randomUUID();
const OTHER_SLIP = randomUUID();

const auth = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-c9" }, SECRET)}` });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollRuns).values({ id: RUN_ID, tenantId: TENANT, runNo: "RUN-C9-001", month: "2026-07", structureId: randomUUID(), status: "draft", createdBy: ACTOR, updatedBy: ACTOR });
    for (const [id, emp, no] of [[OWN_SLIP, OWN_EMPLOYEE, "OWN"], [OTHER_SLIP, COLLEAGUE, "OTHER"]] as const) {
      await tx.insert(payrollSlips).values({
        id, tenantId: TENANT, runId: RUN_ID, employeeId: emp, employeeNo: no,
        basicMinor: 3_000_000n, grossMinor: 5_000_000n, totalDeductionsMinor: 700_000n, netPayMinor: 4_300_000n,
        currency: "INR", components: [], createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
  }));
});
afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

const get = (url: string, roles: string[]) => app.inject({ method: "GET", url, headers: auth(roles) });
// Review #2446 (1): salary corrections (per-employee component old/new + arrears) too.
const PAY_DATA_URLS = ["/v1/payroll/salary-slips", "/v1/payroll/structures", "/v1/payroll/pensioners", `/v1/payroll/pensioners/${randomUUID()}`, "/v1/payroll/corrections", `/v1/payroll/corrections?employeeId=${COLLEAGUE}`];

describe("per-employee pay data is payroll/HR only", () => {
  for (const roles of [["finance_officer"], ["finance_admin"], ["finance_officer", "budget_officer"]]) {
    it(`${roles.join("+")}: 403 on the slip register, structures, pensioners, a slip and its PDF`, async () => {
      for (const url of [...PAY_DATA_URLS, `/v1/payroll/slips/${OTHER_SLIP}`, `/v1/payroll/slips/${OTHER_SLIP}/pdf`, `/v1/payroll/slips/${OTHER_SLIP}/download`]) {
        expect((await get(url, roles)).statusCode, url).toBe(403);
      }
    });
  }

  it("finance_officer who is also an employee: own slip 200, a colleague's slip 403 (slip and PDF)", async () => {
    const roles = ["finance_officer", "employee"];
    expect((await get(`/v1/payroll/slips/${OWN_SLIP}`, roles)).statusCode).toBe(200);
    expect((await get(`/v1/payroll/slips/${OTHER_SLIP}`, roles)).statusCode).toBe(403);
    expect((await get(`/v1/payroll/slips/${OTHER_SLIP}/pdf`, roles)).statusCode).toBe(403);
    expect((await get(`/v1/payroll/slips/${OTHER_SLIP}/download`, roles)).statusCode).toBe(403);
  });

  it("employee self-service: own slip 200, a colleague's slip 403", async () => {
    expect((await get(`/v1/payroll/slips/${OWN_SLIP}`, ["employee"])).statusCode).toBe(200);
    expect((await get(`/v1/payroll/slips/${OTHER_SLIP}`, ["employee"])).statusCode).toBe(403);
  });

  for (const role of ["payroll_admin", "payroll_officer", "hr_admin"]) {
    it(`${role}: 200 on the slip register, structures, pensioners and any slip`, async () => {
      for (const url of ["/v1/payroll/salary-slips", "/v1/payroll/structures", "/v1/payroll/pensioners", "/v1/payroll/corrections", `/v1/payroll/slips/${OTHER_SLIP}`]) {
        expect((await get(url, [role])).statusCode, url).toBe(200);
      }
    });
  }
});

describe("GET /v1/payroll/runs/totals — aggregate salary-bill totals for finance", () => {
  for (const roles of [["finance_officer"], ["finance_admin"], ["payroll_officer"], ["hr_admin"]]) {
    it(`${roles.join("+")}: 200 with per-run totals only (no per-employee rows)`, async () => {
      const res = await get("/v1/payroll/runs/totals", roles);
      expect(res.statusCode).toBe(200);
      const run = (res.json() as Array<Record<string, unknown>>).find((r) => r.id === RUN_ID)!;
      expect(run).toMatchObject({ payPeriod: "2026-07", employeeCount: 2, grossMinor: "10000000", netMinor: "8600000", deductionsMinor: "1400000" });
      expect(Object.keys(run).sort()).toEqual(expect.arrayContaining(["employeeCount", "grossMinor", "id", "netMinor", "payPeriod", "status"]));
      for (const k of Object.keys(run)) expect(["id", "payPeriod", "runType", "status", "employeeCount", "grossMinor", "deductionsMinor", "netMinor"]).toContain(k);
      expect(res.body).not.toContain(OWN_EMPLOYEE);
    });
  }

  it("employee / citizen: 403", async () => {
    expect((await get("/v1/payroll/runs/totals", ["employee"])).statusCode).toBe(403);
    expect((await get("/v1/payroll/runs/totals", ["citizen"])).statusCode).toBe(403);
  });
});
