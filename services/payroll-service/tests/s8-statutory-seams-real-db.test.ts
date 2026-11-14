/**
 * S8 statutory seams -- real Postgres (NOBYPASSRLS payroll_svc, FORCE RLS), real run consumer.
 *  - flags default OFF; with them off the run computes exactly as before (EPF capped, no LWF, no ESI memory);
 *  - per-employee "PF on actual" changes only that employee's EPF (EPS stays at the ceiling), persisted pf_wage_minor;
 *  - flags on: LWF deducted + ledger row (employer share), ESI continues for an employee covered earlier in the period;
 *  - RBAC (payroll_officer refused), audit events, backdated PF basis refused, tenant isolation.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { drainAllQueues } from "../../../vitest.drain";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn(async () => new Map()),
    // the HRMS employee directory: only the ids in `known` exist in this tenant
    searchEmployeeSummariesStrict: vi.fn(async (_t: string, f: { ids?: string[] }) =>
      new Map((f.ids ?? []).filter((id) => known.has(id)).map((id) => [id, { fullName: id, departmentName: "", employeeNo: null }]))),
  };
});
const known = vi.hoisted(() => new Set<string>());
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { resolveSeamFlags } from "../src/modules/payroll/statutory-seams-repo.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ADMIN = randomUUID();
const CHECKER = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const A = randomUUID(); // EPF, ceiling (default)
const B = randomUUID(); // EPF, PF on actual basic from 2026-11
const C = randomUUID(); // ESI-covered in October (finalised slip), gross over the ceiling later
const D = randomUUID(); // never covered
const E = randomUUID(); // no state of employment in HRMS
for (const id of [A, B, C, D, E]) known.add(id);
const R = (rupees: number): bigint => BigInt(rupees) * 100n;

const tok = (tid: string, sub: string, roles: string[]) => signToken({ sub, tid, roles, sid: "s8" }, SECRET, 3600);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(TENANT, sub, roles)}`, "content-type": "application/json" });
const asTenant = <T>(t: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(t, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>, t = TENANT) => (await asTenant(t, (tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;
const employee = (id: string, no: string, basic: number, stateCode: string | null = "KA") => ({
  id, employeeNo: no, fullName: no, basicMinor: String(R(basic)), dateOfJoining: "2020-04-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new", stateCode,
  departmentId: DEPT, pensionScheme: "EPF", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: false,
});
const feed = (month: string) => vi.mocked(fetchPayrollInput).mockResolvedValue({
  month, employees: [employee(A, "S8-EMP-A", 40_000), employee(B, "S8-EMP-B", 40_000), employee(C, "S8-EMP-C", 40_000), employee(D, "S8-EMP-D", 40_000), employee(E, "S8-EMP-E", 40_000, null)],
  lopDays: {}, overtimeHours: {},
} as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);

let app: FastifyInstance;
async function waitFor<T>(fn: () => Promise<T | null | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await drainAllQueues();
  }
}
async function runMonth(month: string, runNo: string, runType?: string): Promise<string> {
  feed(month);
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(ADMIN, ["payroll_admin"]), payload: { runNo, month, structureId: STRUCTURE, ...(runType ? { runType } : {}) } });
  expect([201, 202], res.body).toContain(res.statusCode);
  const id = (res.json().data?.id ?? res.json().id) as string;
  await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${id}::uuid LIMIT 1`))[0], `run ${runNo} computed`);
  return id;
}
const slipOf = async (runId: string, emp: string) => (await q(sql`
  SELECT pf_employee_minor::text AS pf, pf_wage_minor::text AS pf_wage, esi_minor::text AS esi, components
    FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid AND employee_id = ${emp}::uuid`))[0]!;
const hasLwf = (s: Record<string, unknown>) => (s.components as Array<{ code: string }>).some((c) => c.code === "LWF");

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(TENANT, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, ${"2026-01-01"}, 5800)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${STRUCTURE}::uuid, ${TENANT}::uuid, ${"S8 seams"}, true, ${"active"}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    // Karnataka LWF (monthly here so the test is month-independent): Rs 20 employee, Rs 40 employer.
    await tx.execute(sql`INSERT INTO payroll.payroll_lwf (tenant_id, state_code, employee_contrib_minor, employer_contrib_minor, frequency, effective_from) VALUES (${TENANT}::uuid, ${"KA"}, 2000, 4000, ${"monthly"}, ${"2026-04-01"})`);
    // October 2026, approved: employee C had ESI deducted (gross was under the ceiling then).
    const apr = randomUUID(), slip = randomUUID();
    await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, total_gross_minor, total_net_minor, currency, status, created_by, updated_by)
      VALUES (${apr}::uuid, ${TENANT}::uuid, ${"S8-OCT"}, ${"2026-10"}, ${STRUCTURE}::uuid, ${"regular"}, ${R(20_000)}, ${R(19_000)}, ${"INR"}, ${"approved"}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, total_deductions_minor, net_pay_minor, esi_minor, status, created_by, updated_by)
      VALUES (${slip}::uuid, ${TENANT}::uuid, ${apr}::uuid, ${C}::uuid, ${"S8-EMP-C"}, ${R(20_000)}, ${R(20_000)}, ${R(1_000)}, ${R(19_000)}, ${R(150)}, ${"computed"}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
  });
});

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, async (tx) => {
      for (const tbl of ["payroll.payroll_lwf_ledger", "payroll.payroll_s8_change_requests", "payroll.employee_pf_wage_basis", "payroll.payroll_statutory_seams", "payroll.payroll_lwf",
        "statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps", "statutory.payroll_ups_pool",
        "payroll.payroll_run_employee_claims", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_runs", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
        await tx.execute(sql`DELETE FROM ${sql.raw(tbl)} WHERE tenant_id = ${t}::uuid`).catch(() => undefined);
      }
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("S8 seams, flags OFF (default): the run computes as before", () => {
  let may: string;
  it("a tenant with no settings row is OFF", async () => {
    expect(await asTenant(TENANT, (tx) => resolveSeamFlags(tx as never, TENANT))).toEqual({ lwfDeductionEnabled: false, esiContributionPeriodEnabled: false });
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/s8-seams", headers: hdr(ADMIN, ["payroll_officer"]) });
    expect(res.json()).toEqual({ lwfDeductionEnabled: false, esiContributionPeriodEnabled: false });
  });
  it("November run: EPF capped for everyone, no LWF, no ESI for C (gross over the ceiling), empty LWF ledger", async () => {
    may = await runMonth("2026-11", "S8-NOV");
    for (const emp of [A, B, C, D]) {
      const s = await slipOf(may, emp);
      expect(s.pf).toBe(String(R(1_800)));
      expect(s.pf_wage).toBe(String(R(15_000)));
      expect(s.esi).toBe("0");
      expect(hasLwf(s)).toBe(false);
    }
    expect(await q(sql`SELECT 1 FROM payroll.payroll_lwf_ledger WHERE tenant_id = ${TENANT}::uuid`)).toHaveLength(0);
  });
});

const put = (url: string, who: string, payload: unknown, roles = ["payroll_admin"]) => app.inject({ method: "PUT", url, headers: hdr(who, roles), payload: payload as never });
const decideReq = (id: string, who: string, what: "approve" | "reject", roles = ["payroll_admin"]) =>
  app.inject({ method: "PATCH", url: `/v1/payroll/statutory/s8-seams/requests/${id}/${what}`, headers: hdr(who, roles), payload: {} });
const reqStatus = async (id: string) => (await q(sql`SELECT status FROM payroll.payroll_s8_change_requests WHERE id = ${id}::uuid`))[0]?.status;
const auditActions = async (ids: string[]) => (await q(sql`SELECT payload->>${"action"} AS action FROM _outbox.messages
  WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`}) ORDER BY created_at`)).map((a) => a.action);

describe("S8 seams: maker-checker admin routes", () => {
  let flagsReq: string; let pfReq: string;
  it("only payroll_admin / super_admin may write", async () => {
    expect((await put("/v1/payroll/statutory/s8-seams", ADMIN, { lwfDeductionEnabled: true, reason: "Section 8 go-live" }, ["payroll_officer"])).statusCode).toBe(403);
    expect((await put(`/v1/payroll/statutory/pf-wage-basis/${B}`, ADMIN, { basis: "actual", effectiveFrom: "2027-01-01", consentRef: "JT-OPT/2027/014" }, ["payroll_officer"])).statusCode).toBe(403);
  });
  it("validation: reason, consent reference, 1st-of-month, existing employee, not backdated", async () => {
    expect((await put("/v1/payroll/statutory/s8-seams", ADMIN, { lwfDeductionEnabled: true })).statusCode).toBe(400);
    expect((await put(`/v1/payroll/statutory/pf-wage-basis/${B}`, ADMIN, { basis: "actual", effectiveFrom: "2027-01-01" })).statusCode).toBe(400);
    expect((await put(`/v1/payroll/statutory/pf-wage-basis/${B}`, ADMIN, { basis: "actual", effectiveFrom: "2027-01-15", consentRef: "JT-OPT/2027/014" })).statusCode).toBe(400);
    const unknown = await put(`/v1/payroll/statutory/pf-wage-basis/${randomUUID()}`, ADMIN, { basis: "actual", effectiveFrom: "2027-01-01", consentRef: "JT-OPT/2027/014" });
    expect(unknown.statusCode).toBe(404);
    const back = await put(`/v1/payroll/statutory/pf-wage-basis/${B}`, ADMIN, { basis: "actual", effectiveFrom: "2026-10-01", consentRef: "JT-OPT/2027/014" });
    expect(back.statusCode).toBe(409);
    expect(back.json().code).toBe("PF_BASIS_BACKDATED");
  });
  it("a request is only PENDING: no flag row, no PF basis row, no effect on the next run", async () => {
    const r1 = await put(`/v1/payroll/statutory/pf-wage-basis/${B}`, ADMIN, { basis: "actual", effectiveFrom: "2027-01-01", consentRef: "JT-OPT/2027/014" });
    const r2 = await put("/v1/payroll/statutory/s8-seams", ADMIN, { lwfDeductionEnabled: true, esiContributionPeriodEnabled: true, reason: "Section 8 go-live approved by CFO" });
    expect([r1.statusCode, r2.statusCode]).toEqual([202, 202]);
    pfReq = r1.json().id; flagsReq = r2.json().id;
    await waitFor(async () => (await reqStatus(pfReq)) && (await reqStatus(flagsReq)), "pending requests");
    expect(await reqStatus(pfReq)).toBe("pending");
    expect(await q(sql`SELECT 1 FROM payroll.employee_pf_wage_basis WHERE employee_id = ${B}::uuid`)).toHaveLength(0);
    expect(await q(sql`SELECT 1 FROM payroll.payroll_statutory_seams`)).toHaveLength(0);
    const dec = await runMonth("2026-12", "S8-DEC");
    expect((await slipOf(dec, B)).pf).toBe(String(R(1_800)));
    expect(hasLwf(await slipOf(dec, A))).toBe(false);
    expect((await slipOf(dec, C)).esi).toBe("0");
    expect(await q(sql`SELECT 1 FROM payroll.payroll_lwf_ledger`)).toHaveLength(0);
    const list = await app.inject({ method: "GET", url: "/v1/payroll/statutory/s8-seams/requests?status=pending", headers: hdr(CHECKER, ["payroll_officer"]) });
    expect(list.json().data.map((r: { id: string }) => r.id).sort()).toEqual([pfReq, flagsReq].sort());
  });
  it("self-approval is refused (route 403; the DB CHECK also forbids decided_by = requested_by)", async () => {
    expect((await decideReq(pfReq, ADMIN, "approve")).statusCode).toBe(403);
    expect((await decideReq(flagsReq, ADMIN, "approve")).statusCode).toBe(403);
    expect(await reqStatus(pfReq)).toBe("pending");
    await expect(q(sql`UPDATE payroll.payroll_s8_change_requests SET status = 'approved', decided_by = requested_by WHERE id = ${pfReq}::uuid`)).rejects.toThrow();
    expect((await decideReq(pfReq, CHECKER, "approve", ["payroll_officer"])).statusCode).toBe(403); // RBAC
  });
  it("a DIFFERENT admin approves: PF basis and flags take effect, both steps audited; a decided request cannot be decided again", async () => {
    expect((await decideReq(pfReq, CHECKER, "approve")).statusCode).toBe(202);
    expect((await decideReq(flagsReq, CHECKER, "approve")).statusCode).toBe(202);
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_statutory_seams WHERE lwf_deduction_enabled AND esi_contribution_period_enabled`))[0], "flags applied");
    expect(await reqStatus(pfReq)).toBe("approved");
    const get = await app.inject({ method: "GET", url: `/v1/payroll/statutory/pf-wage-basis/${B}`, headers: hdr(CHECKER, ["payroll_officer"]) });
    expect(get.json().basis).toEqual([{ effectiveFrom: "2027-01-01", basis: "actual" }]);
    expect((await auditActions([pfReq, flagsReq, B, TENANT])).filter((a) => /request|approve/.test(String(a))).sort())
      .toEqual(["flags_approve", "flags_request", "pf_basis_approve", "pf_basis_request"]);
    expect((await decideReq(pfReq, CHECKER, "approve")).statusCode).toBe(409);
  });
  it("a rejected request has no effect", async () => {
    const r = await put(`/v1/payroll/statutory/pf-wage-basis/${A}`, ADMIN, { basis: "actual", effectiveFrom: "2027-02-01", consentRef: "JT-OPT/2027/015" });
    const id = r.json().id as string;
    await waitFor(async () => reqStatus(id), "request");
    expect((await decideReq(id, CHECKER, "reject")).statusCode).toBe(202);
    await waitFor(async () => (await reqStatus(id)) === "rejected", "rejected");
    expect(await q(sql`SELECT 1 FROM payroll.employee_pf_wage_basis WHERE employee_id = ${A}::uuid`)).toHaveLength(0);
  });
  it("tenant isolation: another tenant sees none of it", async () => {
    for (const t of ["payroll.payroll_statutory_seams", "payroll.employee_pf_wage_basis", "payroll.payroll_s8_change_requests"]) {
      expect(await q(sql`SELECT 1 FROM ${sql.raw(t)}`, OTHER_TENANT)).toHaveLength(0);
    }
  });
});

describe("S8 seams, approved + flags ON: January 2027 run", () => {
  let jan: string;
  beforeAll(async () => { jan = await runMonth("2027-01", "S8-JAN"); });

  it("PF on actual lifts the cap for B only: 12% of Basic + DA (63,200) = 7,584; EPF wage persisted uncapped; A and C stay at the ceiling", async () => {
    const b = await slipOf(jan, B);
    expect(b.pf).toBe(String(R(7_584)));
    expect(b.pf_wage).toBe(String(R(63_200)));
    expect((await slipOf(jan, A)).pf).toBe(String(R(1_800)));
    const [pf] = await q(sql`SELECT eps_contrib_minor::text AS eps, epf_wage_minor::text AS epf_wage, eps_wage_minor::text AS eps_wage, edli_wage_minor::text AS edli_wage
      FROM statutory.payroll_pf WHERE run_id = ${jan}::uuid AND employee_id = ${B}::uuid`);
    expect(pf).toEqual({ eps: String(R(1_250)), epf_wage: String(R(63_200)), eps_wage: String(R(15_000)), edli_wage: String(R(15_000)) });
  });
  it("LWF: Rs 20 on every KA employee's slip, employer Rs 40 in the ledger; E (no state) gets none and the run warns", async () => {
    for (const emp of [A, B, C, D]) {
      const lwf = (await slipOf(jan, emp)).components as Array<{ code: string; amountMinor: number }>;
      expect(lwf.find((c) => c.code === "LWF")?.amountMinor).toBe(2000);
    }
    expect(hasLwf(await slipOf(jan, E))).toBe(false);
    const ledger = await q(sql`SELECT employee_minor::text AS emp, employer_minor::text AS er, state_code, period, frequency FROM payroll.payroll_lwf_ledger WHERE run_id = ${jan}::uuid`);
    expect(ledger).toHaveLength(4);
    expect(ledger[0]).toEqual({ emp: "2000", er: "4000", state_code: "KA", period: "2027-01", frequency: "monthly" });
    const warn = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${jan} AND payload->>${"code"} = ${"LWF_RULE_UNKNOWN"}`);
    expect(JSON.stringify(warn[0]!.payload)).toContain("S8-EMP-E");
  });
  it("ESI continuity: C (covered in October, same Oct-Mar period) keeps ESI on a gross over the ceiling; D (never covered) does not", async () => {
    expect(Number((await slipOf(jan, C)).esi)).toBeGreaterThan(0);
    expect((await slipOf(jan, D)).esi).toBe("0");
  });
  it("a supplementary run in the same due month deducts NO second LWF: still one line and one ledger row per employee", async () => {
    const sup = await runMonth("2027-01", "S8-JAN-SUP", "supplementary");
    for (const emp of [A, B, C, D]) expect(hasLwf(await slipOf(sup, emp))).toBe(false);
    for (const emp of [A, B, C, D]) {
      expect(await q(sql`SELECT 1 FROM payroll.payroll_lwf_ledger WHERE employee_id = ${emp}::uuid AND period = ${"2027-01"}`)).toHaveLength(1);
    }
  });
  it("lwfAlreadyAppliedEmployees ignores rows of cancelled runs", async () => {
    const { lwfAlreadyAppliedEmployees } = await import("../src/modules/payroll/statutory-seams-repo.js");
    const other = randomUUID();
    const got = await asTenant(TENANT, (tx) => lwfAlreadyAppliedEmployees(tx as never, TENANT, "2027-01", [A, D], other));
    expect([...got].sort()).toEqual([A, D].sort());
    await q(sql`UPDATE payroll.payroll_runs SET status = 'cancelled' WHERE id = ${jan}::uuid`);
    const after = await asTenant(TENANT, (tx) => lwfAlreadyAppliedEmployees(tx as never, TENANT, "2027-01", [A, D], other));
    expect(after.size).toBe(0);
  });
});
