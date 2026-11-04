/**
 * PR #2459 review (ERP-head decisions 2026-11-05) -- real Postgres, real run consumer.
 *  B1  T-PERIOD with February SKIPPED: TP-EMP-01 (in service since 2020) was
 *      paid January 2027 here (TDS 33,856) and nothing for February. The March
 *      run presumes TDS only for April..December (before the first slip here);
 *      February is a gap -- no salary estimated, 0 TDS -- so the liability
 *      spreads over 11 months, not 12. FY_MONTHS_WITHOUT_SLIP names it.
 *  B1  An approved opening YTD (pre-go-live salary + TDS, maker-checker via the
 *      API) is authoritative: TP-EMP-02 gets no presumption at all.
 *  B2  Approval: 409 UNRECORDED_FY_MONTHS_ESTIMATED while presumed months are
 *      unacknowledged; GET approval-review lists them with their text; with
 *      tdsAcknowledgements the run approves and the acknowledgement is audited.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn(async () => new Map()) };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { registerOpeningYtdConsumers } from "../src/modules/opening-ytd/consumer.js";
import { computeSlip } from "../src/modules/payroll/domain.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const E1 = randomUUID();
const E2 = randomUUID();
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
const GROSS = 231_428; // 1,23,100 + DA 58% 71,398 + HRA X 30% 36,930

const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "b19r" }, SECRET, 3600);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}`, "content-type": "application/json" });
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>) => (await asTenant((tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;
const employee = (id: string, no: string) => ({
  id, employeeNo: no, fullName: no, basicMinor: String(123_100 * 100), dateOfJoining: "2020-04-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true,
});

let app: FastifyInstance;
let marchRun: string;

async function waitFor<T>(fn: () => Promise<T | null | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  registerOpeningYtdConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, ${"2026-01-01"}, 5800)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${STRUCTURE}::uuid, ${TENANT}::uuid, ${"B19R"}, true, ${"active"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
    // January 2027, approved: TP-EMP-01 paid here for the first time, TDS 33,856. February: no run at all.
    const jan = randomUUID(), slip = randomUUID();
    await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, total_gross_minor, total_net_minor, currency, status, created_by, updated_by)
      VALUES (${jan}::uuid, ${TENANT}::uuid, ${"B19R-JAN"}, ${"2027-01"}, ${STRUCTURE}::uuid, ${"regular"}, ${R(GROSS)}, ${R(GROSS - 19_450 - 33_856)}, ${"INR"}, ${"approved"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, total_deductions_minor, net_pay_minor, tds_minor, status, created_by, updated_by)
      VALUES (${slip}::uuid, ${TENANT}::uuid, ${jan}::uuid, ${E1}::uuid, ${"TP-EMP-01"}, ${R(123_100)}, ${R(GROSS)}, ${R(19_450 + 33_856)}, ${R(GROSS - 19_450 - 33_856)}, ${R(33_856)}, ${"computed"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
    await tx.execute(sql`INSERT INTO statutory.payroll_tds (tenant_id, slip_id, employee_id, run_id, tds_minor, period, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${slip}::uuid, ${E1}::uuid, ${jan}::uuid, ${R(33_856)}, ${"2027-01"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps", "statutory.payroll_ups_pool",
      "payroll.payroll_run_employee_claims", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_runs", "payroll.payroll_opening_ytd",
      "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
      await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${TENANT}::uuid`).catch(() => undefined);
    }
  });
  await app.close();
  await sqlClient.end();
});

describe("PR #2459 review B1: opening YTD API (maker-checker)", () => {
  it("an officer enters TP-EMP-02 pre-go-live opening (Apr-Dec + Feb paid elsewhere); the maker cannot approve; another admin can", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/payroll/opening-ytd", headers: hdr(MAKER, ["payroll_officer"]), payload: { employeeId: E2, fy: "2026-27", source: "pre_go_live", months: 0, salaryMinor: "1", tdsMinor: "0", note: "missing months" } });
    expect(bad.statusCode).toBe(400);
    const res = await app.inject({ method: "POST", url: "/v1/payroll/opening-ytd", headers: hdr(MAKER, ["payroll_officer"]), payload: {
      employeeId: E2, fy: "2026-27", source: "pre_go_live", months: 10, salaryMinor: String(R(GROSS * 10)), tdsMinor: String(R(250_000)),
      note: "Legacy payroll Apr 2026 - Feb 2027, reconciled to 24Q Q1-Q3 and the Feb challan",
    } });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_opening_ytd WHERE id = ${id}::uuid`))[0], "opening row");
    const dup = await app.inject({ method: "POST", url: "/v1/payroll/opening-ytd", headers: hdr(MAKER, ["payroll_officer"]), payload: { employeeId: E2, fy: "2026-27", source: "pre_go_live", months: 1, salaryMinor: "100", tdsMinor: "0", note: "second copy of it" } });
    expect(dup.statusCode).toBe(409);
    const self = await app.inject({ method: "PATCH", url: `/v1/payroll/opening-ytd/${id}/approve`, headers: hdr(MAKER, ["payroll_admin"]), payload: { reason: "approving my own entry" } });
    expect(self.statusCode).toBe(403);
    const ok = await app.inject({ method: "PATCH", url: `/v1/payroll/opening-ytd/${id}/approve`, headers: hdr(CHECKER, ["payroll_admin"]), payload: { reason: "Checked against the 24Q statements" } });
    expect(ok.statusCode).toBe(202);
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_opening_ytd WHERE id = ${id}::uuid AND status = ${"approved"}`))[0], "approval");
    const list = await app.inject({ method: "GET", url: `/v1/payroll/opening-ytd?employeeId=${E2}`, headers: hdr(CHECKER, ["payroll_admin"]) });
    expect(list.json().data[0]).toMatchObject({ source: "pre_go_live", months: 10, status: "approved", enteredBy: MAKER, approvedBy: CHECKER, tdsMinor: String(R(250_000)) });
    const audit = await q(sql`SELECT payload->>${"action"} AS action FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${id} ORDER BY created_at`);
    expect(audit.map((a) => a.action)).toEqual(["opening_ytd_enter", "opening_ytd_approve"]);
  });
});

describe("PR #2459 review B1/B2: the March 2027 run", () => {
  beforeAll(async () => {
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2027-03", employees: [employee(E1, "TP-EMP-01"), employee(E2, "TP-EMP-02")], lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(MAKER, ["payroll_admin"]), payload: { runNo: "B19R-MAR", month: "2027-03", structureId: STRUCTURE } });
    expect([201, 202]).toContain(res.statusCode);
    marchRun = res.json().data?.id ?? res.json().id;
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${marchRun}::uuid LIMIT 1`))[0], "run computed");
  });

  it("TP-EMP-01: Apr-Dec presumed (9), February is a gap (no income, no presumed TDS); the liability spreads over 11 months", async () => {
    const [s] = await q(sql`SELECT tds_minor::text AS tds, tds_presumed_months AS presumed, gross_minor::text AS gross FROM payroll.payroll_slips WHERE run_id = ${marchRun}::uuid AND employee_id = ${E1}::uuid`);
    expect(Number(s!.presumed)).toBe(9);
    expect(BigInt(String(s!.gross))).toBe(R(GROSS));
    const expected = computeSlip({
      basicMinor: R(123_100), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
      monthsRemaining: 1, tdsYtdMinor: R(33_856), fyPaidToDate: { grossMinor: R(GROSS), months: 1, unrecordedMonths: 9 }, maxDeductionShareBps: 5000,
    });
    expect(BigInt(String(s!.tds))).toBe(expected.tdsMinor);
    // with February wrongly presumed (10 months) the liability would be smaller
    const withFeb = computeSlip({ basicMinor: R(123_100), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2026, statutoryEsi: false, monthsRemaining: 1, tdsYtdMinor: R(33_856), fyPaidToDate: { grossMinor: R(GROSS), months: 1, unrecordedMonths: 10 } });
    expect(expected.tdsLiabilityMinor).not.toBe(withFeb.tdsLiabilityMinor);
    expect(expected.tdsMinor % 100n).toBe(0n);
    const warn = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${marchRun} AND payload->>${"code"} = ${"FY_MONTHS_WITHOUT_SLIP"}`);
    expect(JSON.stringify(warn[0]!.payload)).toContain("2027-02");
  });

  it("TP-EMP-02: the approved opening YTD is authoritative -- nothing presumed, opening TDS counted as deducted", async () => {
    const [s] = await q(sql`SELECT tds_minor::text AS tds, tds_presumed_months AS presumed FROM payroll.payroll_slips WHERE run_id = ${marchRun}::uuid AND employee_id = ${E2}::uuid`);
    expect(Number(s!.presumed)).toBe(0);
    const expected = computeSlip({
      basicMinor: R(123_100), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
      monthsRemaining: 1, tdsYtdMinor: R(250_000), fyPaidToDate: { grossMinor: R(GROSS * 10), months: 10, unrecordedMonths: 0 }, maxDeductionShareBps: 5000,
    });
    expect(BigInt(String(s!.tds))).toBe(expected.tdsMinor);
  });

  it("approval is refused while the presumed months are unacknowledged; approval-review lists them; acknowledged -> approved and audited", async () => {
    const review = await app.inject({ method: "GET", url: `/v1/payroll/runs/${marchRun}/approval-review`, headers: hdr(CHECKER, ["payroll_admin"]) });
    expect(review.statusCode).toBe(200);
    const items = review.json().tds as Array<{ employeeId: string; kind: string; requiresAck: boolean; message: string }>;
    const presumed = items.find((i) => i.employeeId === E1 && i.kind === "presumed_months")!;
    expect(presumed.requiresAck).toBe(true);
    expect(presumed.message).toMatch(/9 earlier FY month\(s\).*PRESUMED/);
    expect(items.some((i) => i.employeeId === E2 && i.kind === "presumed_months")).toBe(false);

    // super_admin: the policy-service permission check (payroll.run.approve) fast-paths; maker-checker still applies.
    const refused = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${marchRun}/approve`, headers: hdr(CHECKER, ["super_admin"]), payload: {} });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("UNRECORDED_FY_MONTHS_ESTIMATED");

    const reason = "Apr-Dec paid by the legacy system; opening YTD to follow";
    const ok = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${marchRun}/approve`, headers: hdr(CHECKER, ["super_admin"]), payload: { tdsAcknowledgements: [{ employeeId: E1, reason }] } });
    expect(ok.statusCode).toBe(202);
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_runs WHERE id = ${marchRun}::uuid AND status = ${"approved"}`))[0], "approved");
    const [a] = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"action"} = ${"approve"} AND payload->>${"resourceId"} = ${marchRun}`);
    const acks = (a!.payload as { tdsAcknowledgements: Array<{ employeeId: string; reason: string; items: Array<{ kind: string; presumedMonths: number }> }> }).tdsAcknowledgements;
    expect(acks).toEqual([{ employeeId: E1, reason, items: [{ kind: "presumed_months", amountMinor: "0", presumedMonths: 9, finalMonth: false }] }]);
  });
});
