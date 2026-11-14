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
import { drainAllQueues } from "../../../vitest.drain";

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
import { buildForm16WithMinor } from "../src/modules/tax/form16.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const E1 = randomUUID();
const E2 = randomUUID();
const E3 = randomUUID(); // Form 16 (delta review B2)
const E4 = randomUUID(); // arrear recovery carry-forward (delta review B3)
const E5 = randomUUID(); // partial opening coverage (delta review SF1)
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
    await drainAllQueues();
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
      employeeId: E2, fy: "2026-27", source: "pre_go_live", months: 11, salaryMinor: String(R(GROSS * 11)), tdsMinor: String(R(250_000)),
      note: "Legacy payroll Apr 2026 - Feb 2027 (11 months), reconciled to 24Q Q1-Q3 and the Feb challan",
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
    expect(list.json().data[0]).toMatchObject({ source: "pre_go_live", months: 11, status: "approved", enteredBy: MAKER, approvedBy: CHECKER, tdsMinor: String(R(250_000)) });
    const audit = await q(sql`SELECT payload->>${"action"} AS action FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${id} ORDER BY created_at`);
    expect(audit.map((a) => a.action)).toEqual(["opening_ytd_enter", "opening_ytd_approve"]);
  });
});

describe("PR #2459 review B1/B2: the March 2027 run", () => {
  beforeAll(async () => {
    // E5: approved pre-go-live opening covering only Apr-Sep (6 of the 11 earlier months) + a previous employer.
    await asTenant(async (tx) => {
      await tx.execute(sql`INSERT INTO payroll.payroll_opening_ytd (tenant_id, employee_id, fy, source, months, salary_minor, tds_minor, note, status, entered_by, approved_by, decided_at)
        VALUES (${TENANT}::uuid, ${E5}::uuid, ${"2026-27"}, ${"pre_go_live"}, 6, ${R(GROSS * 6)}, ${R(150_000)}, ${"Legacy payroll Apr-Sep 2026"}, ${"approved"}, ${MAKER}::uuid, ${CHECKER}::uuid, now()),
               (${TENANT}::uuid, ${E5}::uuid, ${"2026-27"}, ${"prior_employer"}, 0, ${R(50_000)}, ${R(2_000)}, ${"Form 12B from the previous office"}, ${"approved"}, ${MAKER}::uuid, ${CHECKER}::uuid, now())`);
      await tx.execute(sql`UPDATE payroll.payroll_opening_ytd SET prior_employer_name = ${"Old Office"} WHERE employee_id = ${E5}::uuid AND source = ${"prior_employer"}`);
    });
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2027-03", employees: [employee(E1, "TP-EMP-01"), employee(E2, "TP-EMP-02"), employee(E5, "TP-EMP-05")], lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
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
      monthsRemaining: 1, tdsYtdMinor: R(250_000), fyPaidToDate: { grossMinor: R(GROSS * 11), months: 11, unrecordedMonths: 0 }, maxDeductionShareBps: 5000,
    });
    expect(BigInt(String(s!.tds))).toBe(expected.tdsMinor);
  });

  it("delta review SF1: a partial pre-go-live opening (6 months) leaves the other 5 pre-boundary months presumed; a previous-employer row does not switch presumption off", async () => {
    const [s] = await q(sql`SELECT tds_minor::text AS tds, tds_presumed_months AS presumed FROM payroll.payroll_slips WHERE run_id = ${marchRun}::uuid AND employee_id = ${E5}::uuid`);
    expect(Number(s!.presumed)).toBe(5);
    const expected = computeSlip({
      basicMinor: R(123_100), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
      monthsRemaining: 1, tdsYtdMinor: R(150_000 + 2_000), fyPaidToDate: { grossMinor: R(GROSS * 6), months: 6, unrecordedMonths: 5 }, maxDeductionShareBps: 5000,
      declaration: { prevEmployerSalaryMinor: R(50_000) }, presumedMonthsAuthoritative: true,
    });
    expect(BigInt(String(s!.tds))).toBe(expected.tdsMinor);
    const warn = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${marchRun} AND payload->>${"code"} = ${"OPENING_YTD_MONTHS_MISMATCH"}`);
    expect(JSON.stringify(warn[0]!.payload)).toContain("TP-EMP-05");
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
    // TP-EMP-02: the March balance above the 50% limit cannot be recovered through payroll (final month) -> acknowledged too
    expect(items.find((i) => i.employeeId === E2 && i.kind === "shortfall")).toMatchObject({ requiresAck: true });
    expect(items.find((i) => i.employeeId === E2 && i.kind === "shortfall")!.message).toContain("cannot be recovered through payroll this FY -- collect separately or adjust before Form 16");
    const partial = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${marchRun}/approve`, headers: hdr(CHECKER, ["super_admin"]), payload: { tdsAcknowledgements: [{ employeeId: E1, reason }, { employeeId: E5, reason }] } });
    expect(partial.statusCode).toBe(409);
    expect(partial.json().code).toBe("TDS_SHORTFALL_UNRECOVERABLE");
    const ok = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${marchRun}/approve`, headers: hdr(CHECKER, ["super_admin"]), payload: { tdsAcknowledgements: [{ employeeId: E1, reason }, { employeeId: E5, reason }, { employeeId: E2, reason }] } });
    expect(ok.statusCode).toBe(202);
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_runs WHERE id = ${marchRun}::uuid AND status = ${"approved"}`))[0], "approved");
    const [a] = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"action"} = ${"approve"} AND payload->>${"resourceId"} = ${marchRun}`);
    const acks = (a!.payload as { tdsAcknowledgements: Array<{ employeeId: string; reason: string; items: Array<{ kind: string; presumedMonths: number }> }> }).tdsAcknowledgements;
    expect(acks[0]).toEqual({ employeeId: E1, reason, items: [{ kind: "presumed_months", amountMinor: "0", presumedMonths: 9, finalMonth: false }] });
  });
});

describe("PR #2459 delta review SF2: correcting an approved opening YTD, several previous employers", () => {
  it("a correction is a new version (supersedesId), maker-checker; on approval the old one is superseded and kept; two previous employers can coexist", async () => {
    const list = async () => (await app.inject({ method: "GET", url: `/v1/payroll/opening-ytd?employeeId=${E2}`, headers: hdr(CHECKER, ["payroll_admin"]) })).json().data as Array<{ id: string; status: string; source: string; tdsMinor: string; supersedesId: string | null; priorEmployerName: string | null }>;
    const old = (await list()).find((r) => r.source === "pre_go_live" && r.status === "approved")!;
    const again = await app.inject({ method: "POST", url: "/v1/payroll/opening-ytd", headers: hdr(MAKER, ["payroll_officer"]), payload: { employeeId: E2, fy: "2026-27", source: "pre_go_live", months: 11, salaryMinor: String(R(GROSS * 11)), tdsMinor: String(R(240_000)), note: "plain re-entry without supersedes" } });
    expect(again.statusCode).toBe(409);
    const fix = await app.inject({ method: "POST", url: "/v1/payroll/opening-ytd", headers: hdr(MAKER, ["payroll_officer"]), payload: { employeeId: E2, fy: "2026-27", source: "pre_go_live", months: 11, salaryMinor: String(R(GROSS * 11)), tdsMinor: String(R(240_000)), note: "Corrected TDS per the Q3 24Q statement", supersedesId: old.id } });
    expect(fix.statusCode).toBe(202);
    const fixId = fix.json().id as string;
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_opening_ytd WHERE id = ${fixId}::uuid`))[0], "correction row");
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/opening-ytd/${fixId}/approve`, headers: hdr(MAKER, ["payroll_admin"]), payload: { reason: "my own correction" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/payroll/opening-ytd/${fixId}/approve`, headers: hdr(CHECKER, ["payroll_admin"]), payload: { reason: "Checked the Q3 statement" } })).statusCode).toBe(202);
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_opening_ytd WHERE id = ${fixId}::uuid AND status = ${"approved"}`))[0], "correction approved");
    const after = await list();
    expect(after.find((r) => r.id === old.id)!.status).toBe("superseded");
    expect(after.find((r) => r.id === fixId)).toMatchObject({ status: "approved", supersedesId: old.id, tdsMinor: String(R(240_000)) });
    // two previous employers in the same FY
    for (const [name, tan] of [["First Office", "ABCD12345E"], ["Second Office", "WXYZ54321K"]] as const) {
      const r = await app.inject({ method: "POST", url: "/v1/payroll/opening-ytd", headers: hdr(MAKER, ["payroll_officer"]), payload: { employeeId: E2, fy: "2026-27", source: "prior_employer", salaryMinor: String(R(40_000)), tdsMinor: String(R(1_000)), priorEmployerName: name, priorEmployerTan: tan, note: "Form 12B received from the office" } });
      expect(r.statusCode).toBe(202);
    }
    await waitFor(async () => (await list()).filter((r) => r.source === "prior_employer").length === 2 ? true : null, "two prior employers");
  });
});

describe("PR #2459 delta review B2: Form 16 Part B and 24Q Annexure II use the approved opening YTD", () => {
  beforeAll(async () => {
    // E3 = the T-PERIOD case: one slip here (TDS 1,35,423), the other 11 months paid by this employer before go-live.
    await asTenant(async (tx) => {
      const run = randomUUID(), slip = randomUUID();
      await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, total_gross_minor, total_net_minor, currency, status, created_by, updated_by)
        VALUES (${run}::uuid, ${TENANT}::uuid, ${"B19R-F16"}, ${"2027-02"}, ${STRUCTURE}::uuid, ${"regular"}, ${R(GROSS)}, ${R(GROSS - 135_423)}, ${"INR"}, ${"approved"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, total_deductions_minor, net_pay_minor, tds_minor, status, created_by, updated_by)
        VALUES (${slip}::uuid, ${TENANT}::uuid, ${run}::uuid, ${E3}::uuid, ${"TP-EMP-03"}, ${R(123_100)}, ${R(GROSS)}, ${R(135_423)}, ${R(GROSS - 135_423)}, ${R(135_423)}, ${"computed"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
      await tx.execute(sql`INSERT INTO statutory.payroll_tds (tenant_id, slip_id, employee_id, run_id, tds_minor, period, created_by, updated_by)
        VALUES (${TENANT}::uuid, ${slip}::uuid, ${E3}::uuid, ${run}::uuid, ${R(135_423)}, ${"2027-02"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
    });
  });

  it("without an opening YTD: the false refund (tax on one month 0, the whole TDS refundable)", async () => {
    const { form16 } = await runWithTenant(TENANT, () => buildForm16WithMinor(TENANT, E3, "2026-27"));
    expect(form16.form16PartB.grossSalary).toBe(GROSS);
    expect(form16.form16PartB.totalTaxLiability).toBe(0);
    expect(form16.form16PartB.refundDue).toBe(135_423);
  });

  it("with the approved pre-go-live opening and a previous employer: full-year salary, all TDS credited, no false refund; Annexure II carries the same", async () => {
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_opening_ytd (tenant_id, employee_id, fy, source, months, salary_minor, tds_minor, note, status, entered_by, approved_by, decided_at)
      VALUES (${TENANT}::uuid, ${E3}::uuid, ${"2026-27"}, ${"pre_go_live"}, 11, ${R(GROSS * 11)}, 0, ${"Legacy payroll Apr 2026 - Mar 2027"}, ${"approved"}, ${MAKER}::uuid, ${CHECKER}::uuid, now()),
             (${TENANT}::uuid, ${E3}::uuid, ${"2026-27"}, ${"prior_employer"}, 0, 0, 0, ${"Form 12B: no salary there this FY"}, ${"approved"}, ${MAKER}::uuid, ${CHECKER}::uuid, now())`));
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_opening_ytd SET prior_employer_name = ${"Earlier Office"}, prior_employer_tan = ${"PQRS11111T"} WHERE employee_id = ${E3}::uuid AND source = ${"prior_employer"}`));
    const first = (await runWithTenant(TENANT, () => buildForm16WithMinor(TENANT, E3, "2026-27"))).form16;
    expect(first.form16PartB.grossSalary).toBe(GROSS * 12);
    const liability = first.form16PartB.totalTaxLiability;
    expect(liability).toBeGreaterThan(400_000);
    // the legacy system deducted the rest of the liability before go-live
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_opening_ytd SET tds_minor = ${R(liability - 135_423)} WHERE employee_id = ${E3}::uuid AND source = ${"pre_go_live"}`));
    const { form16, partBMinor } = await runWithTenant(TENANT, () => buildForm16WithMinor(TENANT, E3, "2026-27"));
    expect(form16.form16PartA.preGoLiveTds).toBe(liability - 135_423);
    expect(form16.form16PartA.totalTdsDeposited).toBe(liability);
    expect(form16.form16PartB).toMatchObject({ preGoLiveSalary: GROSS * 11, totalTdsDeducted: liability, refundDue: 0, balanceTaxPayable: 0 });
    expect(form16.form16PartB.prevEmployers).toEqual([{ name: "Earlier Office", tan: "PQRS11111T", salary: 0, tds: 0 }]);
    expect(partBMinor.preGoLiveSalaryMinor).toBe(R(GROSS * 11));

    // Annexure II (24Q Q4, force-filed: the quarter has no challans in this test tenant)
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/form24q/force-file", headers: hdr(CHECKER, ["super_admin"]), payload: { fy: "2026-27", quarter: "Q4", confirmForce: true, reason: "test: Annexure II from the opening YTD" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { annexureII?: Array<Record<string, unknown>>; annexureIIPrevEmployers?: Array<Record<string, unknown>> };
    const annexure = body.annexureII ?? [];
    const row = annexure.find((r) => r.employeeId === E3)!;
    expect(row).toMatchObject({ grossSalaryMinor: Number(R(GROSS * 12)), preGoLiveSalaryMinor: Number(R(GROSS * 11)), totalTdsDeductedMinor: Number(R(liability)), refundDueMinor: 0 });
    expect((body.annexureIIPrevEmployers ?? []).filter((p) => p.employeeId === E3)).toEqual([{ employeeId: E3, name: "Earlier Office", tan: "PQRS11111T", salaryMinor: 0, tdsMinor: 0 }]);
  });
});

describe("PR #2459 delta review B3: an arrear (overpayment) recovery deferred by the 50% limit is carried forward, not lost", () => {
  const runFor = async (month: string, runNo: string): Promise<string> => {
    vi.mocked(fetchPayrollInput).mockResolvedValue({ month, employees: [employee(E4, "TP-EMP-04")], lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(MAKER, ["payroll_admin"]), payload: { runNo, month, structureId: STRUCTURE } });
    expect([201, 202]).toContain(res.statusCode);
    const id = (res.json().data?.id ?? res.json().id) as string;
    await waitFor(async () => (await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${id}::uuid LIMIT 1`))[0], `${month} computed`);
    return id;
  };
  const recovered = async (run: string): Promise<bigint> => {
    const [s] = await q(sql`SELECT components FROM payroll.payroll_slips WHERE run_id = ${run}::uuid AND employee_id = ${E4}::uuid`);
    return (s!.components as Array<{ code: string; amountMinor: number }>).filter((c) => c.code === "ARREAR_RECOVERY").reduce((a, c) => a + BigInt(c.amountMinor), 0n);
  };

  it("November recovers what fits, re-raises the rest for December; December collects it; the total is recovered or still outstanding", async () => {
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_arrears (tenant_id, employee_id, component_code, from_period, to_period, old_amount_minor, new_amount_minor, difference_minor, reason, status, source, created_by)
      VALUES (${TENANT}::uuid, ${E4}::uuid, ${"ARREAR_RECOVERY"}, ${"2026-11"}, ${"2026-11"}, 0, 0, ${R(150_000)}, ${"Excess pay Jul-Sep recovered"}, ${"approved"}, ${"manual"}, ${MAKER}::uuid)`));
    const nov = await runFor("2026-11", "B19R-NOV");
    const r1 = await recovered(nov);
    expect(r1).toBeGreaterThan(0n);
    expect(r1).toBeLessThan(R(150_000));
    const [carry1] = await q(sql`SELECT difference_minor::text AS amt, from_period, status, source, carried_from_run_id::text AS from_run FROM payroll.payroll_arrears WHERE employee_id = ${E4}::uuid AND source = ${"carry_forward"} AND run_id IS NULL`);
    expect(carry1).toMatchObject({ from_period: "2026-12", status: "approved", source: "carry_forward", from_run: nov });
    expect(BigInt(String(carry1!.amt))).toBe(R(150_000) - r1);
    const [slip1] = await q(sql`SELECT total_deductions_minor::text AS ded, gross_minor::text AS gross FROM payroll.payroll_slips WHERE run_id = ${nov}::uuid AND employee_id = ${E4}::uuid`);
    expect(BigInt(String(slip1!.ded))).toBeLessThanOrEqual(BigInt(String(slip1!.gross)) / 2n);
    const warn = await q(sql`SELECT 1 FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${nov} AND payload->>${"code"} = ${"ARREAR_RECOVERY_CARRIED_FORWARD"}`);
    expect(warn).toHaveLength(1);
    // the employee record (arrears list) shows the outstanding recovery
    const list = await app.inject({ method: "GET", url: `/v1/payroll/arrears?employeeId=${E4}`, headers: hdr(MAKER, ["payroll_admin"]) });
    expect((list.json().data as Array<{ source: string; status: string }>).some((a) => a.source === "carry_forward" && a.status === "approved")).toBe(true);

    const dec = await runFor("2026-12", "B19R-DEC");
    const r2 = await recovered(dec);
    expect(r2).toBeGreaterThan(0n);
    const outstanding = await q(sql`SELECT COALESCE(SUM(difference_minor), 0)::text AS amt FROM payroll.payroll_arrears WHERE employee_id = ${E4}::uuid AND source = ${"carry_forward"} AND run_id IS NULL`);
    // November recovered + December recovered + still outstanding (for January) = the whole overpayment
    expect(r1 + r2 + BigInt(String(outstanding[0]!.amt))).toBe(R(150_000));
    const [consumed] = await q(sql`SELECT status, run_id::text AS run FROM payroll.payroll_arrears WHERE employee_id = ${E4}::uuid AND source = ${"carry_forward"} AND from_period = ${"2026-12"}`);
    expect(consumed).toMatchObject({ status: "paid", run: dec });
  });
});
