/**
 * UAT b18 (EPF for contract staff, 2026-11-05) -- real Postgres.
 *   D6  the slip PF wage is the capped wage actually used (Rs 15,000, not 28,440).
 *   D5  the PF ledger row carries EPF / EDLI wages and the employer EDLI and
 *       admin charges; GET /statutory/pf/challan gives A/c 1/2/10/21/22.
 *   D3  GET /statutory/ecr refuses (422 UAN_MISSING, listing the members)
 *       while any EPF member has a missing or invalid UAN.
 *   D4  with valid UANs the ECR is ECR 2.0: "#~#", 11 fields per line.
 *   D2  POST /v1/payroll/runs for an FY with no tax slab config -> 422
 *       TAX_CONFIG_MISSING at creation (no run row is written).
 *   D1  GET /reports/pension-scheme-retro lists already-computed slips under
 *       another scheme, report only.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips, payrollStructures } from "../src/modules/payroll/schema.js";
import { payrollPf, payrollTds, payrollNps, payrollUpsPool } from "../src/modules/statutory/schema.js";
import { sumEmployerChargesByRunTx } from "../src/modules/statutory/repo.js";
import { computeAndInsertSlip, registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { MemoryQueue } from "@civitasone/queue";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchTaxRegimes: vi.fn() };
});
import { fetchPayrollInput, fetchTaxRegimes, HrmsUnavailableError } from "../src/shared/hrms-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const RUN = randomUUID();
const STRUCT = randomUUID();
const MONTH = "2027-02";
const EMP = Array.from({ length: 3 }, (_, i) => ({ id: randomUUID(), no: `B18-EPF-${i + 1}` }));
const UPS_EMP = { id: randomUUID(), no: "B18-UPS-1" };
// Review SF1 / SF2: a second month with EPS-ineligible, pre-2014 and joiner members.
const RUN2 = randomUUID();
const MONTH2 = "2027-03";
const VJO = { id: randomUUID(), no: "B18-VJO-1" };   // para 26(6) joint option, joined 2026-10-28
const PRE = { id: randomUUID(), no: "B18-PRE-1" };   // first EPF membership 2013 (via UAN)
const JOIN = { id: randomUUID(), no: "B18-JOIN-1" }; // joined 2027-03-28, Basic + DA within the ceiling
const OTHER_TENANT = randomUUID();
// Delta review: open / supplementary runs for the challan close; a computed run for the EPS block.
const RUN_OPEN = randomUUID();
const RUN_SUP = randomUUID();
const SUP = { id: randomUUID(), no: "B18-SUP-1" };
const RUN3 = randomUUID();
const JOIN2 = { id: randomUUID(), no: "B18-JOIN-2" };
const APPROVER = randomUUID();
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "b18" }, SECRET)}` };
const asTenant = <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

function feed(uans: Array<string | null>, regimes: Array<"old" | "new"> = []) {
  (fetchPayrollInput as ReturnType<typeof vi.fn>).mockResolvedValue({
    month: MONTH, lopDays: {},
    employees: EMP.map((e, i) => ({
      id: e.id, employeeNo: e.no, fullName: `Contract Staff ${i + 1}`, basicMinor: "1800000", dateOfJoining: "2026-10-28",
      payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: uans[i] ?? null,
      cityClass: "X", taxRegime: regimes[i] ?? "new", departmentId: randomUUID(), pensionScheme: "EPF",
    })),
  });
  // Review SF9: the tax pre-check reads the regime-only feed.
  (fetchTaxRegimes as ReturnType<typeof vi.fn>).mockResolvedValue(EMP.map((e, i) => ({
    id: e.id, employeeNo: e.no, departmentId: null, taxRegime: regimes[i] ?? "new", eligibleForPayroll: true, paymentRoute: "payroll",
  })));
}

async function wipe(): Promise<void> {
  await asTenant(async (tx) => {
    for (const t of [payrollPf, payrollNps, payrollUpsPool, payrollTds]) await tx.delete(t).where(eq(t.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollStructures).where(eq(payrollStructures.tenantId, TENANT));
    await tx.execute(sql`DELETE FROM payroll.tax_slab_config WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM statutory.payroll_epf_admin_topups WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
    await tx.execute(sql`DELETE FROM payroll.payroll_tax_declarations WHERE tenant_id = ${TENANT}::uuid`);
  });
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await wipe();
  await asTenant(async (tx) => {
    await tx.insert(payrollStructures).values({ id: STRUCT, tenantId: TENANT, name: "B18 Structure", isDefault: true, status: "active", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(payrollRuns).values({ id: RUN, tenantId: TENANT, runNo: "B18-EPF-2027-02", month: MONTH, structureId: STRUCT,
      totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
    // The UAT contract employees: Basic Rs 18,000, DA 58% -> Basic + DA Rs 28,440.
    for (const e of EMP) {
      await computeAndInsertSlip(tx as never, { actorId: ACTOR }, {
        runId: RUN, tenantId: TENANT, employeeId: e.id, employeeNo: e.no, basicMinor: 1_800_000n, month: MONTH,
        pensionScheme: "EPF", daRateBps: 5800n, cityClass: "X", taxRegime: "new", fyStartYear: 2026,
      });
    }
    await tx.insert(payrollRuns).values({ id: RUN2, tenantId: TENANT, runNo: "B18-EPS-2027-03", month: MONTH2, structureId: STRUCT,
      totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
    const common = { runId: RUN2, tenantId: TENANT, month: MONTH2, pensionScheme: "EPF" as const, daRateBps: 5800n, cityClass: "X" as const, taxRegime: "new" as const, fyStartYear: 2026 };
    await computeAndInsertSlip(tx as never, { actorId: ACTOR }, { ...common, employeeId: VJO.id, employeeNo: VJO.no, basicMinor: 1_800_000n,
      dateOfJoining: "2026-10-28", epfFacts: { voluntaryJointOption: true } });
    await computeAndInsertSlip(tx as never, { actorId: ACTOR }, { ...common, employeeId: PRE.id, employeeNo: PRE.no, basicMinor: 1_800_000n,
      dateOfJoining: "2026-10-28", epfFacts: { firstJoinedOn: "2013-04-01" } });
    // Joined on the 28th: Basic Rs 9,000 x 4/31 paid; the LOP line carries the 27 days not in service.
    await computeAndInsertSlip(tx as never, { actorId: ACTOR }, { ...common, employeeId: JOIN.id, employeeNo: JOIN.no, basicMinor: 900_000n, daRateBps: 0n,
      dateOfJoining: "2027-03-28", epfFacts: {},
      components: [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: 783_900n, lopDays: 27, daysInMonth: 31, notInServiceDays: 27 }] });
    // Delta review: a computed (not yet approved) run with a member whose EPS eligibility is unrecorded.
    await tx.insert(payrollRuns).values({ id: RUN3, tenantId: TENANT, runNo: "B18-EPS-2027-05", month: "2027-05", structureId: STRUCT,
      totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "computed", createdBy: ACTOR, updatedBy: ACTOR });
    await computeAndInsertSlip(tx as never, { actorId: ACTOR }, { ...common, runId: RUN3, month: "2027-05", employeeId: JOIN2.id, employeeNo: JOIN2.no, basicMinor: 1_800_000n,
      dateOfJoining: "2026-10-28", epfFacts: {} });
    // A UPS member: Basic Rs 50,000, DA 58% -> pension base Rs 79,000.
    await computeAndInsertSlip(tx as never, { actorId: ACTOR }, {
      runId: RUN, tenantId: TENANT, employeeId: UPS_EMP.id, employeeNo: UPS_EMP.no, basicMinor: 5_000_000n, month: MONTH,
      pensionScheme: "UPS", daRateBps: 5800n, cityClass: "X", taxRegime: "new", fyStartYear: 2026,
    });
  });
  app = await buildApp();
});

afterAll(async () => { await app.close(); await wipe(); await sqlClient.end(); });

describe("D6 / D5: wages used and employer charges are persisted with the slip", () => {
  it("slip pf_wage_minor is the capped Rs 15,000; the PF row has EPF/EDLI wages, EDLI Rs 75 and admin Rs 75", async () => {
    const rows = await asTenant((tx) => tx.execute(sql`
      SELECT s.pf_wage_minor::text AS slip_pf_wage, p.emp_contrib_minor::text AS ee, p.eps_contrib_minor::text AS eps,
             p.epf_er_contrib_minor::text AS epf_er, p.epf_wage_minor::text AS epf_wage, p.edli_wage_minor::text AS edli_wage,
             p.edli_contrib_minor::text AS edli, p.epf_admin_minor::text AS admin
      FROM payroll.payroll_slips s JOIN statutory.payroll_pf p ON p.slip_id = s.id
      WHERE s.tenant_id = ${TENANT}::uuid AND s.run_id = ${RUN}::uuid`)) as unknown as Array<Record<string, string>>;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toEqual({ slip_pf_wage: "1500000", ee: "180000", eps: "125000", epf_er: "55000",
        epf_wage: "1500000", edli_wage: "1500000", edli: "7500", admin: "7500" });
    }
  });

  it("GET /statutory/pf/challan: A/c 1 = EE + EPF ER, A/c 2 raised to the Rs 500 minimum, A/c 10 EPS, A/c 21 EDLI, A/c 22 0", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/pf/challan?period=${MONTH}`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      period: MONTH, recordCount: 3, epfWagesMinor: "4500000", edliWagesMinor: "4500000", employeeShareMinor: "540000",
      accounts: { ac1EpfMinor: "705000", ac2AdminMinor: "50000", ac10EpsMinor: "375000", ac21EdliMinor: "22500", ac22EdliAdminMinor: "0" },
      // employer: EPF ER 1,650 + EPS 3,750 + admin 500 + EDLI 225 = Rs 6,125
      employerCostMinor: "612500",
      totalChallanMinor: "1152500",
    });
  });

  it("GET /statutory/pf/challan without a period is a 400", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pf/challan", headers: auth });
    expect(r.statusCode).toBe(400);
  });
});

describe("UPS: the Government 8.5% pool share is its own statutory row, apart from the individual 10%", () => {
  it("payroll_nps carries employee 10% and Government individual 10%; payroll_ups_pool the 8.5% pool share", async () => {
    const nps = await asTenant((tx) => tx.execute(sql`SELECT emp_contrib_minor::text AS ee, er_contrib_minor::text AS er, er_contrib_pct::text AS pct, pension_base_minor::text AS base
      FROM statutory.payroll_nps WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${UPS_EMP.id}::uuid`)) as unknown as Array<Record<string, string>>;
    expect(nps).toEqual([{ ee: "790000", er: "790000", pct: "10.00", base: "7900000" }]);
    const pool = await asTenant((tx) => tx.execute(sql`SELECT contrib_minor::text AS pool, contrib_pct::text AS pct, pension_base_minor::text AS base
      FROM statutory.payroll_ups_pool WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${UPS_EMP.id}::uuid`)) as unknown as Array<Record<string, string>>;
    expect(pool).toEqual([{ pool: "671500", pct: "8.50", base: "7900000" }]); // 8.5% of Rs 79,000 = Rs 6,715
  });

  it("run totals for the GL accrual: EDLI, EPF admin and UPS pool, each on its own", async () => {
    expect(await asTenant((tx) => sumEmployerChargesByRunTx(tx as never, RUN, TENANT)))
      .toEqual({ edliMinor: 22_500n, epfAdminMinor: 22_500n, upsPoolMinor: 671_500n });
  });
});

describe("Review SF1 / SF2: EPS eligibility and NCP days reach the ledger and the ECR", () => {
  it("a member with no recorded fact stays an EPS member (eps_basis default); recorded ones are marked recorded", async () => {
    const rows = await asTenant((tx) => tx.execute(sql`SELECT s.employee_no AS no, p.eps_contrib_minor::text AS eps, p.eps_basis AS basis
      FROM statutory.payroll_pf p JOIN payroll.payroll_slips s ON s.id = p.slip_id WHERE p.tenant_id = ${TENANT}::uuid AND p.run_id IN (${RUN2}::uuid, ${RUN3}::uuid) ORDER BY s.employee_no`)) as unknown as Array<Record<string, string>>;
    expect(rows.find((r) => r.no === JOIN2.no)).toEqual({ no: JOIN2.no, eps: "125000", basis: "default" }); // Basic + DA Rs 28,440, joined 2026: still EPS
    expect(rows.find((r) => r.no === VJO.no)!.basis).toBe("recorded");
    expect(rows.find((r) => r.no === PRE.no)!.basis).toBe("recorded");
  });

  it("approval review lists the unrecorded members (advisory); with the tenant policy block, approval is refused 409", async () => {
    const review = await app.inject({ method: "GET", url: `/v1/payroll/runs/${RUN3}/approval-review`, headers: auth });
    expect(review.statusCode).toBe(200);
    expect(review.json().epsUnrecorded).toEqual({ policy: "advisory", employees: [{ employeeId: JOIN2.id, employeeNo: JOIN2.no }] });
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, eps_unrecorded_policy, created_at, updated_at) VALUES (${TENANT}::uuid, ${"block"}, NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET eps_unrecorded_policy = EXCLUDED.eps_unrecorded_policy`));
    expect((await app.inject({ method: "GET", url: `/v1/payroll/runs/${RUN3}/approval-review`, headers: auth })).json().epsUnrecorded.policy).toBe("block");
    const approver = { authorization: `Bearer ${signToken({ sub: APPROVER, tid: TENANT, roles: ["super_admin"], sid: "b18a" }, SECRET)}` };
    const r = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${RUN3}/approve`, headers: approver, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("EPS_ELIGIBILITY_UNRECORDED");
    expect(r.json().message).toContain(JOIN2.no);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_settings SET eps_unrecorded_policy = ${"advisory"} WHERE tenant_id = ${TENANT}::uuid`));
  });

  it("the runApprove consumer re-asserts the block policy under the run lock (a command that skipped approveRun cannot approve)", async () => {
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_settings SET eps_unrecorded_policy = ${"block"} WHERE tenant_id = ${TENANT}::uuid`));
    const q = new MemoryQueue();
    registerPayrollConsumers(q);
    await q.publish(COMMANDS.runApprove, { messageId: randomUUID(), type: COMMANDS.runApprove, tenantId: TENANT, actorId: APPROVER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: RUN3, tenantId: TENANT, approvedBy: APPROVER } });
    await q.drain();
    const run = (await asTenant((tx) => tx.execute(sql`SELECT status FROM payroll.payroll_runs WHERE id = ${RUN3}::uuid`))) as unknown as Array<{ status: string }>;
    expect(run[0]!.status).toBe("computed");
    expect(JSON.stringify(q.dlq)).toContain("EPS_ELIGIBILITY_UNRECORDED");
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_settings SET eps_unrecorded_policy = ${"advisory"} WHERE tenant_id = ${TENANT}::uuid`));
  });

  it("joint-option member: EPS 0, EPS wages 0, the whole employer 12% to A/c 1; pre-2014 member: EPS Rs 1,250", async () => {
    const rows = await asTenant((tx) => tx.execute(sql`SELECT s.employee_no AS no, p.eps_contrib_minor::text AS eps, p.epf_er_contrib_minor::text AS epf_er, p.eps_wage_minor::text AS eps_wage
      FROM statutory.payroll_pf p JOIN payroll.payroll_slips s ON s.id = p.slip_id WHERE p.tenant_id = ${TENANT}::uuid AND p.run_id = ${RUN2}::uuid ORDER BY s.employee_no`)) as unknown as Array<Record<string, string>>;
    expect(rows.find((r) => r.no === VJO.no)).toEqual({ no: VJO.no, eps: "0", epf_er: "180000", eps_wage: "0" });
    expect(rows.find((r) => r.no === PRE.no)).toEqual({ no: PRE.no, eps: "125000", epf_er: "55000", eps_wage: "1500000" });
  });

  it("ECR 2.0 for the month: EPS wages / EPS 0 for the joint-option member, and NCP 0 for the 28th joiner", async () => {
    (fetchPayrollInput as ReturnType<typeof vi.fn>).mockResolvedValue({ month: MONTH2, lopDays: {}, employees: [
      { id: VJO.id, employeeNo: VJO.no, fullName: "Joint Option", uan: "100200300421" },
      { id: PRE.id, employeeNo: PRE.no, fullName: "Pre Member", uan: "100200300422" },
      { id: JOIN.id, employeeNo: JOIN.no, fullName: "New Joiner", uan: "100200300423" },
    ] });
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/ecr?month=${MONTH2}`, headers: auth });
    expect(r.statusCode).toBe(200);
    const byUan = new Map(r.body.split("\r\n").map((l) => [l.split("#~#")[0], l.split("#~#")]));
    expect(byUan.get("100200300421")!.slice(3, 9)).toEqual(["15000", "0", "15000", "1800", "0", "1800"]);
    expect(byUan.get("100200300422")!.slice(3, 9)).toEqual(["15000", "15000", "15000", "1800", "1250", "550"]);
    expect(byUan.get("100200300423")![9]).toBe("0"); // NCP days: none of the 27 days before joining
  });
});

describe("Review SF3: closing the EPF challan accrues the A/c 2 minimum shortfall once", () => {
  const close = (period: string, headers = auth) => app.inject({ method: "POST", url: "/v1/payroll/statutory/pf/challan/close", headers, payload: { period } });
  it("refused while a run of the month is not approved (409 RUNS_OPEN); cancelled / failed runs do not count", async () => {
    await asTenant((tx) => tx.insert(payrollRuns).values({ id: RUN_OPEN, tenantId: TENANT, runNo: "B18-OPEN-2027-02", month: MONTH, structureId: STRUCT,
      runType: "supplementary", totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing", createdBy: ACTOR, updatedBy: ACTOR }));
    const r = await close(MONTH);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("RUNS_OPEN");
    expect(r.json().message).toContain("B18-OPEN-2027-02 (processing)");
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_runs SET status = ${"cancelled"} WHERE id = ${RUN_OPEN}::uuid`));
  });

  it("3 members x Rs 75 = Rs 225 -> top-up Rs 275, one balanced finance journal; a second close posts nothing", async () => {
    const r = await close(MONTH);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ period: MONTH, memberCount: 3, adminAccruedMinor: "22500", minimumMinor: "50000", topUpMinor: "27500", alreadyClosed: false });
    const journals = await asTenant((tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${"finance.gl.post"}`)) as unknown as Array<{ payload: { id: string; lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }> } }>;
    expect(journals).toHaveLength(1);
    expect(journals[0]!.payload.id).toBe(r.json().journalId);
    expect(journals[0]!.payload.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["5002", "27500", "0"], ["2103", "0", "27500"]]);
    const again = await close(MONTH);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ alreadyClosed: true, topUpMinor: "27500", journalId: r.json().journalId });
    const after = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${"finance.gl.post"}`)) as unknown as Array<{ n: number }>;
    expect(after[0]!.n).toBe(1);
    const challan = await app.inject({ method: "GET", url: `/v1/payroll/statutory/pf/challan?period=${MONTH}`, headers: auth });
    expect(challan.json().adminMinimumTopUp).toEqual({ closed: true, topUpMinor: "27500", journalId: r.json().journalId });
  });

  it("a supplementary run approved later: a re-close books only the delta (here a Rs 75 reversal), append-only", async () => {
    await asTenant(async (tx) => {
      await tx.insert(payrollRuns).values({ id: RUN_SUP, tenantId: TENANT, runNo: "B18-SUP-2027-02", month: MONTH, structureId: STRUCT,
        runType: "supplementary", totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR });
      await computeAndInsertSlip(tx as never, { actorId: ACTOR }, { runId: RUN_SUP, tenantId: TENANT, employeeId: SUP.id, employeeNo: SUP.no, basicMinor: 1_800_000n,
        month: MONTH, pensionScheme: "EPF", daRateBps: 5800n, cityClass: "X", taxRegime: "new", fyStartYear: 2026 });
    });
    const r = await close(MONTH);
    expect(r.statusCode).toBe(201);
    // 4 x Rs 75 = Rs 300 -> shortfall Rs 200; Rs 275 already booked -> delta -Rs 75
    expect(r.json()).toMatchObject({ memberCount: 4, adminAccruedMinor: "30000", targetTopUpMinor: "20000", topUpMinor: "-7500", alreadyClosed: false });
    expect(r.json().runIds).toEqual([RUN, RUN_SUP].sort());
    const journals = await asTenant((tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${"finance.gl.post"} ORDER BY created_at`)) as unknown as Array<{ payload: { id: string; lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }> } }>;
    expect(journals).toHaveLength(2);
    expect(journals[1]!.payload.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["2103", "7500", "0"], ["5002", "0", "7500"]]);
    expect((await close(MONTH)).json()).toMatchObject({ alreadyClosed: true, topUpMinor: "-7500" });
    const rows = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM statutory.payroll_epf_admin_topups WHERE tenant_id = ${TENANT}::uuid`)) as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(2);
    // Keep the rest of this file on the original 3 members: the supplementary slip is excluded.
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_slips SET status = ${"excluded"} WHERE run_id = ${RUN_SUP}::uuid`));
  });
  it("a month with no PF member cannot be closed; payroll_officer may not close", async () => {
    expect((await close("2027-06")).statusCode).toBe(404);
    const officer = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_officer"], sid: "b18o" }, SECRET)}` };
    expect((await close(MONTH2, officer)).statusCode).toBe(403);
  });
});

describe("Review SF8: tenant isolation of the new ledgers", () => {
  it("another tenant sees no UPS pool / top-up rows and cannot close this tenant's month", async () => {
    const other = <T>(fn: (tx: typeof db) => Promise<T>) => runWithTenant(OTHER_TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
    const pool = await other((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM statutory.payroll_ups_pool`)) as unknown as Array<{ n: number }>;
    const own = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM statutory.payroll_ups_pool`)) as unknown as Array<{ n: number }>;
    expect(own[0]!.n).toBe(1);
    expect(pool[0]!.n).toBe(0);
    const tops = await other((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM statutory.payroll_epf_admin_topups`)) as unknown as Array<{ n: number }>;
    expect(tops[0]!.n).toBe(0);
    const otherAuth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: OTHER_TENANT, roles: ["payroll_admin"], sid: "b18x" }, SECRET)}` };
    expect((await app.inject({ method: "POST", url: "/v1/payroll/statutory/pf/challan/close", headers: otherAuth, payload: { period: MONTH2 } })).statusCode).toBe(404);
  });
});

describe("D3 / D4: ECR export", () => {
  it("refuses with 422 UAN_MISSING listing every member with a missing or invalid UAN", async () => {
    feed([null, "12345", "100200300400"]);
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/ecr?month=${MONTH}`, headers: auth });
    expect(r.statusCode).toBe(422);
    const body = r.json();
    expect(body.code).toBe("UAN_MISSING");
    expect(body.message).toContain("B18-EPF-1 (missing)");
    expect(body.message).toContain("B18-EPF-2 (invalid)");
    expect(body.message).not.toContain("B18-EPF-3");
    expect(body.employees).toHaveLength(2);
  });

  it("with valid UANs: an ECR 2.0 file, #~# separated, 11 fields, capped wages, no pipe", async () => {
    feed(["100200300401", "100200300402", "100200300403"]);
    const r = await app.inject({ method: "GET", url: `/v1/payroll/statutory/ecr?month=${MONTH}`, headers: auth });
    expect(r.statusCode).toBe(200);
    const lines = r.body.split("\r\n").sort();
    expect(lines).toHaveLength(3);
    expect(r.body).not.toContain("|");
    expect(lines[0]).toBe("100200300401#~#Contract Staff 1#~#33840#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0");
    for (const l of lines) expect(l.split("#~#")).toHaveLength(11);
  });
});

describe("D1: retro report for a back-dated scheme change (report only)", () => {
  it("lists the EPF slips when the scheme in effect is now NPS, without changing them", async () => {
    const before = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid`));
    const r = await app.inject({ method: "GET", url: `/v1/payroll/reports/pension-scheme-retro?employeeId=${EMP[0]!.id}&fromMonth=2027-01&toScheme=NPS`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ postingPolicy: "report_only", affectedCount: 1,
      slips: [{ month: MONTH, computedScheme: "EPF", schemeInEffect: "NPS", differs: true, employeePensionDeductionMinor: "180000" }] });
    const none = await app.inject({ method: "GET", url: `/v1/payroll/reports/pension-scheme-retro?employeeId=${EMP[0]!.id}&fromMonth=2027-03&toScheme=NPS`, headers: auth });
    expect(none.json()).toMatchObject({ affectedCount: 0, slips: [] });
    const after = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_slips WHERE tenant_id = ${TENANT}::uuid`));
    expect(after).toEqual(before);
  });
});

describe("D2: run creation is refused for an FY with no tax slab config", () => {
  const create = (month: string, runNo: string) => app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth,
    payload: { runNo, month, structureId: STRUCT, runType: "regular" } });
  const runCount = async (month: string) => ((await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM payroll.payroll_runs WHERE tenant_id = ${TENANT}::uuid AND month = ${month}`))) as unknown as Array<{ n: number }>)[0]!.n;

  const slabs = JSON.stringify([{ from: 0, to: null, rate: 0 }]);
  const addSlabs = (fy: number, regime: "new" | "old") => asTenant((tx) => tx.execute(sql`INSERT INTO payroll.tax_slab_config (tenant_id, fy_start_year, regime, slabs, std_deduction, rebate_income_cap, rebate_max, surcharge_bands, created_by)
    VALUES (${TENANT}::uuid, ${fy}, ${regime}, ${slabs}::jsonb, 75000, 1200000, 60000, ${"[]"}::jsonb, ${ACTOR}::uuid)`));

  it("FY 2027-28 with no new-regime slabs -> 422 TAX_CONFIG_MISSING with details, no run written", async () => {
    feed([null, null, null]);
    const r = await create("2027-08", "B18-TAX-1");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TAX_CONFIG_MISSING");
    expect(r.json().message).toContain("FY 2027-28");
    expect(r.json().details).toEqual({ fy: "2027-28", missingRegimes: ["new"] });
    expect(await runCount("2027-08")).toBe(0);
  });

  it("new-regime slabs only, and nobody on the old regime -> accepted (old slabs are optional)", async () => {
    await addSlabs(2027, "new");
    feed([null, null, null], ["new", "new", "new"]);
    const r = await create("2027-08", "B18-TAX-2");
    expect(r.statusCode).toBe(202);
    expect(await runCount("2027-08")).toBe(1);
  });

  it("new-regime slabs only, an employee opted for the old regime (HRMS) -> 422 naming them, with details", async () => {
    feed([null, null, null], ["new", "old", "new"]);
    const r = await create("2027-09", "B18-TAX-3");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TAX_CONFIG_MISSING");
    expect(r.json().message).toContain("B18-EPF-2");
    expect(r.json().details).toEqual({ fy: "2027-28", missingRegimes: ["old"], oldRegimeEmployees: [{ employeeId: EMP[1]!.id, employeeNo: "B18-EPF-2" }] });
    expect(await runCount("2027-09")).toBe(0);
  });

  it("the FY tax declaration decides the regime: declared old -> refused; declared new overrides HRMS old -> accepted", async () => {
    const declare = (empId: string, regime: string) => asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_tax_declarations (tenant_id, employee_id, fy, regime, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${empId}::uuid, ${"2027-28"}, ${regime}, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    feed([null, null, null], ["new", "new", "old"]);
    await declare(EMP[0]!.id, "old");
    await declare(EMP[2]!.id, "new");
    const r1 = await create("2027-10", "B18-TAX-4");
    expect(r1.statusCode).toBe(422);
    expect(r1.json().details.oldRegimeEmployees).toEqual([{ employeeId: EMP[0]!.id, employeeNo: "B18-EPF-1" }]);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_tax_declarations SET regime = ${"new"} WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${EMP[0]!.id}::uuid`));
    const r2 = await create("2027-10", "B18-TAX-5");
    expect(r2.statusCode).toBe(202);
  });

  it("HRMS down while the old-regime slabs are missing -> both regimes required: 422 TAX_CONFIG_MISSING (hrmsUnavailable), not 502", async () => {
    (fetchTaxRegimes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new HrmsUnavailableError("hrms tax-regimes unreachable"));
    const r = await create("2027-12", "B18-TAX-8");
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ code: "TAX_CONFIG_MISSING", details: { fy: "2027-28", missingRegimes: ["old"], hrmsUnavailable: true } });
    expect(fetchPayrollInput).not.toHaveBeenCalledWith(TENANT, "2027-12"); // SF9: the PII feed is not read for the pre-check
  });

  it("with the old-regime slabs configured too, an old-regime employee is no obstacle", async () => {
    await addSlabs(2027, "old");
    feed([null, null, null], ["old", "old", "old"]);
    const r = await create("2027-11", "B18-TAX-6");
    expect(r.statusCode).toBe(202);
  });

  it("an FY with the platform default config (2026-27) passes the check", async () => {
    const r = await create("2026-11", "B18-TAX-7");
    expect(r.statusCode).toBe(202);
  });
});
