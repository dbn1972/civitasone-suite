/**
 * Self-service ownership across payroll routes (P0 id-space fix).
 *
 * The old shared enforceEmployeeOwnership() compared the caller's login user
 * id (ctx.actorId, the JWT subject) with payroll employee ids, which are hrms
 * employee UUIDs -- a different id space. A self-service employee was 403'd
 * (or got empty results) on their OWN data. Every call site now goes through
 * shared/employee-scope.ts scopeEmployeeId(), which resolves the caller's hrms
 * employee id (fails closed: 502 HRMS down, 403 unlinked) and decides "staff"
 * from each ROUTE's own allowed staff roles, not a global privileged list.
 *
 * hrms-client is mocked: JWT subjects resolve to DIFFERENT employee ids, so
 * every "own data" assertion below fails if any route still compares actorId.
 *
 * Per route: own data -> 2xx; another employee's id -> 403; HRMS down -> 502;
 * staff role unaffected (and never resolves identity); finance_officer +
 * employee is scoped to own data where the route's staff roles exclude
 * finance_officer, and keeps staff access where they include it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollLoans } from "../src/modules/loans/schema.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";

const H = vi.hoisted(() => ({ hrmsDown: false, map: {} as Record<string, string> }));

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    verifyEmployeeExists: vi.fn(async () => true),
    resolveActorEmployeeId: vi.fn(async (_tenant: string, actorId: string) => {
      if (H.hrmsDown) throw new actual.HrmsUnavailableError("hrms down (test)");
      return H.map[actorId] ?? null;
    }),
    fetchPayrollInput: vi.fn(async (_t: string, month: string) => ({ month, employees: [], lopDays: {} }) as never),
    fetchEmployeeSummaries: vi.fn(async () => new Map()),
    fetchDefaultSlipTemplate: vi.fn(async () => null),
  };
});

// Form 16 is built from HRMS identity + a configured FY; stub the builder so
// these tests exercise only the ownership decision (it echoes the employeeId
// it was asked for, which the assertions check).
vi.mock("../src/modules/tax/form16.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/tax/form16.js")>();
  return {
    ...actual,
    buildForm16: vi.fn(async (_t: string, employeeId: string, fy: string) => ({
      employeeId, fy, assessmentYear: "2026-27",
      form16PartA: {
        deductor: { name: "Org", tan: "ABCD12345E", pan: "AAACT1234F" },
        deductee: { name: "Emp", pan: "ABCDE1234F", panFlag: "" },
        quarterlyTds: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }, totalTdsDeposited: 0, note: "",
      },
      form16PartB: {
        grossSalary: 0, perquisites: 0, prevEmployerSalary: 0, otherSourcesIncome: 0,
        standardDeduction: 0, hraExempt: 0, section80c: 0, section80d: 0, otherDeductions: 0,
        totalChapterViA: 0, taxableIncome: 0, taxOnIncome: 0, rebate87A: 0, surcharge: 0, cess: 0,
        totalTaxLiability: 0, totalTdsDeducted: 0, prevEmployerTds: 0, balanceTaxPayable: 0,
        refundDue: 0, regime: "new",
      },
    }) as never),
  };
});

const { resolveActorEmployeeId } = await import("../src/shared/hrms-client.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN_ACTOR = randomUUID();
const EMP_ACTOR = randomUUID();
const FIN_EMP_ACTOR = randomUUID();
const UNLINKED_ACTOR = randomUUID();
const OWN_EMP = randomUUID();
const OTHER_EMP = randomUUID();
const LOAN_OWN = randomUUID();
const LOAN_OTHER = randomUUID();
const RUN_ID = randomUUID();
const SLIP_OWN = randomUUID();
const SLIP_OTHER = randomUUID();
const FY = "2025-26";

H.map = { [EMP_ACTOR]: OWN_EMP, [FIN_EMP_ACTOR]: OWN_EMP };

function auth(sub: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "own-idspace" }, SECRET)}` };
}
const EMPLOYEE = () => auth(EMP_ACTOR, ["employee"]);
const ADMIN = () => auth(ADMIN_ACTOR, ["payroll_admin"]);
const FIN_EMP = () => auth(FIN_EMP_ACTOR, ["finance_officer", "employee"]);

type Req = { method: "GET" | "POST"; url: string; payload?: unknown };
type Case = {
  name: string;
  /** Request targeting employee `emp` (for detail routes: their record). */
  req: (emp: "own" | "other") => Req;
  /** The route's staff roles include finance_officer. */
  financeIsStaff: boolean;
  /** Pull the employee id the route acted on, when the response exposes it. */
  actedOn?: (body: unknown) => string | undefined;
};

const empId = (e: "own" | "other") => (e === "own" ? OWN_EMP : OTHER_EMP);
const loanId = (e: "own" | "other") => (e === "own" ? LOAN_OWN : LOAN_OTHER);
const slipId = (e: "own" | "other") => (e === "own" ? SLIP_OWN : SLIP_OTHER);
const field = (k: string) => (b: unknown) => (b as Record<string, string>)[k];

const CASES: Case[] = [
  { name: "GET /loans?empId", financeIsStaff: false,
    req: (e) => ({ method: "GET", url: `/v1/payroll/loans?empId=${empId(e)}` }),
    actedOn: (b) => (b as Array<{ employeeId: string }>)[0]?.employeeId },
  { name: "GET /loans/:id", financeIsStaff: false,
    req: (e) => ({ method: "GET", url: `/v1/payroll/loans/${loanId(e)}` }), actedOn: field("employeeId") },
  { name: "GET /loans/:id/schedule", financeIsStaff: false,
    req: (e) => ({ method: "GET", url: `/v1/payroll/loans/${loanId(e)}/schedule` }) },
  { name: "GET /tax/optimization", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/tax/optimization?employeeId=${empId(e)}` }), actedOn: field("employeeId") },
  { name: "GET /tax/regime-comparison", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/tax/regime-comparison?employeeId=${empId(e)}` }), actedOn: field("employeeId") },
  { name: "GET /slips/:id/pdf", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/slips/${slipId(e)}/pdf` }) },
  { name: "GET /slips/:id/download", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/slips/${slipId(e)}/download` }) },
  { name: "GET /statutory/form12ba", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/statutory/form12ba?employeeId=${empId(e)}&fy=${FY}` }) },
  { name: "GET /tax/form16/:employeeId/pdf", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/tax/form16/${empId(e)}/pdf?fy=${FY}&output=html` }) },
  { name: "GET /tax/computation", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/tax/computation?employeeId=${empId(e)}&fy=${FY}` }), actedOn: field("employeeId") },
  { name: "GET /tax/form16", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/tax/form16?employeeId=${empId(e)}&fy=${FY}` }), actedOn: field("employeeId") },
  { name: "POST /tax-declarations", financeIsStaff: false,
    req: (e) => ({ method: "POST", url: "/v1/payroll/tax-declarations", payload: { employeeId: empId(e), fy: FY, regime: "old", section80c: 1000 } }) },
  { name: "GET /tax-declarations", financeIsStaff: true,
    req: (e) => ({ method: "GET", url: `/v1/payroll/tax-declarations?employeeId=${empId(e)}&fy=${FY}` }) },
];

async function call(r: Req, headers: Record<string, string>) {
  const app = await buildApp();
  try {
    return await app.inject({ method: r.method, url: r.url, headers, payload: r.payload as never });
  } finally {
    await app.close();
  }
}
const ok = (s: number) => s >= 200 && s < 300;

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    for (const [id, emp, no] of [[LOAN_OWN, OWN_EMP, "OWN"], [LOAN_OTHER, OTHER_EMP, "OTHER"]] as const) {
      await tx.insert(payrollLoans).values({
        id, tenantId: TENANT, loanNo: `IDSPACE-${no}`, employeeId: emp,
        loanType: "personal", principalMinor: 1_200_000n, outstandingMinor: 1_200_000n,
        emiMinor: 50_000n, tenureMonths: 24, interestRatePct: "12.00",
        status: "disbursed", createdBy: ADMIN_ACTOR, updatedBy: ADMIN_ACTOR,
      });
    }
    await tx.insert(payrollRuns).values({
      id: RUN_ID, tenantId: TENANT, runNo: "IDSPACE-RUN", month: "2025-06",
      structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n,
      currency: "INR", status: "approved", createdBy: ADMIN_ACTOR, updatedBy: ADMIN_ACTOR,
    });
    for (const [id, emp, no] of [[SLIP_OWN, OWN_EMP, "OWN"], [SLIP_OTHER, OTHER_EMP, "OTHER"]] as const) {
      await tx.insert(payrollSlips).values({
        id, tenantId: TENANT, runId: RUN_ID, employeeId: emp, employeeNo: `IDSPACE-${no}`,
        basicMinor: 10_000_000n, grossMinor: 20_000_000n, totalDeductionsMinor: 2_000_000n,
        netPayMinor: 18_000_000n, currency: "INR", components: [], createdBy: ADMIN_ACTOR, updatedBy: ADMIN_ACTOR,
      });
    }
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollLoans).where(eq(payrollLoans.tenantId, TENANT));
  }));
  await sqlClient.end();
});

beforeEach(() => {
  H.hrmsDown = false;
  vi.mocked(resolveActorEmployeeId).mockClear();
});

for (const c of CASES) {
  describe(`${c.name} -- self-service ownership by resolved hrms employee id`, () => {
    it("an employee can read/act on their OWN data (actorId != employee id)", async () => {
      const res = await call(c.req("own"), EMPLOYEE());
      expect(res.statusCode, res.body).toSatisfy(ok);
      if (c.actedOn) expect(c.actedOn(res.json())).toBe(OWN_EMP);
    });

    it("another employee's id -> 403", async () => {
      const res = await call(c.req("other"), EMPLOYEE());
      expect(res.statusCode).toBe(403);
    });

    it("HRMS unreachable -> 502 (fails closed)", async () => {
      H.hrmsDown = true;
      const res = await call(c.req("own"), EMPLOYEE());
      expect(res.statusCode).toBe(502);
      expect(res.json().code ?? res.json().error).toBeDefined();
    });

    it("an unlinked user (no hrms employee) -> 403", async () => {
      const res = await call(c.req("own"), auth(UNLINKED_ACTOR, ["employee"]));
      expect(res.statusCode).toBe(403);
    });

    it("a staff role is unaffected: reads any employee, no identity lookup", async () => {
      const res = await call(c.req("other"), ADMIN());
      expect(res.statusCode, res.body).toSatisfy(ok);
      if (c.actedOn) expect(c.actedOn(res.json())).toBe(OTHER_EMP);
      expect(resolveActorEmployeeId).not.toHaveBeenCalled();
    });

    if (c.financeIsStaff) {
      it("finance_officer+employee keeps staff access (route admits finance_officer)", async () => {
        const res = await call(c.req("other"), FIN_EMP());
        expect(res.statusCode, res.body).toSatisfy(ok);
      });
    } else {
      it("finance_officer+employee is scoped to own data (route's staff roles exclude finance_officer)", async () => {
        const other = await call(c.req("other"), FIN_EMP());
        expect(other.statusCode).toBe(403);
        const own = await call(c.req("own"), FIN_EMP());
        expect(own.statusCode, own.body).toSatisfy(ok);
      });
    }
  });
}

describe("GET /v1/payroll/income-tax -- self-service listing scope", () => {
  // No declarations or HRMS identities are seeded, so each row id falls back to the employee id.
  const rows = (b: unknown) => ((b as { data?: Array<{ id: string }> }).data ?? []).map((r) => r.id);

  it("an employee sees only their OWN row (previously empty: scoped to actorId)", async () => {
    const res = await call({ method: "GET", url: `/v1/payroll/income-tax?fy=${FY}&employeeId=${OTHER_EMP}` }, EMPLOYEE());
    expect(res.statusCode, res.body).toBe(200);
    expect(rows(res.json())).toEqual([OWN_EMP]);
  });

  it("HRMS unreachable -> 502 for a self-service caller", async () => {
    H.hrmsDown = true;
    const res = await call({ method: "GET", url: `/v1/payroll/income-tax?fy=${FY}` }, EMPLOYEE());
    expect(res.statusCode).toBe(502);
  });

  it("staff still sees every employee, no identity lookup", async () => {
    const res = await call({ method: "GET", url: `/v1/payroll/income-tax?fy=${FY}` }, ADMIN());
    expect(res.statusCode).toBe(200);
    expect(rows(res.json()).sort()).toEqual([OWN_EMP, OTHER_EMP].sort());
    expect(resolveActorEmployeeId).not.toHaveBeenCalled();
  });
});
