/**
 * GAP-PAYROLL-STATUTORY-PT-04 (remainder): effective-dated professional-tax
 * slab versions, end to end against a REAL Postgres (migrated through 0078,
 * FORCE RLS, non-superuser payroll_svc), through buildApp() and the real
 * consumers: a run uses the version in force on its period end, back-dating is
 * refused before the latest finalised run, the Article 276(2) Rs 2,500 annual
 * cap holds, the February amount applies, concurrent creation is race-safe,
 * and past versions cannot be changed.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance.
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
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = randomUUID();
const DEPT = randomUUID();
const ADMIN = ["payroll_admin"];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
const hdr = (tenant: string, roles = ADMIN) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "pt" }, SECRET, 3600)}`,
  "content-type": "application/json",
});
const asTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>) => runWithTenant(tenant, () => db.transaction(fn));
const q = async (tenant: string, s: ReturnType<typeof sql>) => (await asTenant(tenant, (tx) => tx.execute(s))) as unknown as Row[];
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 60)); v = await fn(); }
  return v;
}

let app: FastifyInstance;
const tenants: string[] = [];

/** A tenant with a DA rate, a structure, and (optionally) a legacy, header-less slab set. */
async function newTenant(state: string, slabs: Array<{ from: number; to: number; amt: number; feb?: number }>): Promise<{ tenant: string; structure: string }> {
  const tenant = randomUUID();
  const structure = randomUUID();
  tenants.push(tenant);
  await asTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, '2020-01-01', 5000)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${structure}::uuid, ${tenant}::uuid, 'PT', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    for (const s of slabs) {
      await tx.execute(sql`INSERT INTO payroll.payroll_professional_tax (tenant_id, state_code, slab_from_minor, slab_to_minor, pt_amount_minor, february_amount_minor, effective_from)
        VALUES (${tenant}::uuid, ${state}, ${s.from}, ${s.to}, ${s.amt}, ${s.feb ?? null}, '1900-01-01')`);
    }
  });
  return { tenant, structure };
}

const employee = (id: string, state: string) => ({
  id, employeeNo: `E-${id.slice(0, 6)}`, fullName: "PT Tester", basicMinor: "2000000", dateOfJoining: "2015-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: false, statutoryNps: true, stateCode: state,
});

async function runMonth(tenant: string, structure: string, month: string, emps: ReturnType<typeof employee>[]): Promise<string> {
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month, employees: emps, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(tenant), payload: { runNo: `PT-${month}-${randomUUID().slice(0, 4)}`, month, structureId: structure } });
  expect([201, 202]).toContain(res.statusCode);
  const runId = (res.json().data?.id ?? res.json().id) as string;
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 200));
    const [run] = await q(tenant, sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(tenant, sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed") throw new Error(`run failed: ${String(run.last_error)}`);
    if (regs.length > 0) return runId;
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}

const ptOf = async (tenant: string, runId: string, employeeId: string): Promise<number> => {
  const [s] = await q(tenant, sql`SELECT components FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid AND employee_id = ${employeeId}::uuid`);
  return (s!.components as Array<{ code: string; amountMinor: number }>).find((c) => c.code === "PT")?.amountMinor ?? 0;
};

/** A finalised run + slip carrying `ptMinor` of PT, to build a financial-year history. */
async function seedFinalised(tenant: string, structure: string, employeeId: string, month: string, ptMinor: number): Promise<void> {
  const runId = randomUUID();
  await asTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
      VALUES (${runId}::uuid, ${tenant}::uuid, ${`SEED-${month}`}, ${month}, ${structure}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, components, created_by, updated_by)
      VALUES (${tenant}::uuid, ${runId}::uuid, ${employeeId}::uuid, 'SEED', ${JSON.stringify([{ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: ptMinor }])}::jsonb, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
}

const createVersion = (tenant: string, body: Record<string, unknown>, roles = ADMIN) =>
  app.inject({ method: "POST", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant, roles), payload: body });
const versionsOf = async (tenant: string, state: string): Promise<Row[]> =>
  q(tenant, sql`SELECT effective_from::text AS eff, slab_from_minor::text AS f, pt_amount_minor::text AS amt FROM payroll.payroll_professional_tax WHERE state_code = ${state} ORDER BY effective_from, slab_from_minor`);

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
});

afterAll(async () => {
  // Slab / version rows are immutable by design (0077), so the fixtures stay; the
  // run-side rows are tenant-scoped test data under random tenant ids.
  for (const t of tenants) {
    await asTenant(t, async (tx) => {
      for (const tbl of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
        "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_runs", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
        await tx.execute(sql.raw(`DELETE FROM ${tbl} WHERE tenant_id = '${t}'`));
      }
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("a run uses the version in force on its period end", () => {
  it("old version before the effective date, new version from it", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();

    const created = await createVersion(tenant, {
      stateCode: "MH", effectiveFrom: "2027-01-01", reason: "Schedule revised by the State (test)",
      slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000 }],
    });
    expect(created.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "MH"), (r) => r.length === 2);

    // 2026-12 period ends 2026-12-31 < 2027-01-01 -> the old slab; 2027-01 -> the new one.
    const before = await runMonth(tenant, structure, "2026-12", [employee(emp, "MH")]);
    const after = await runMonth(tenant, structure, "2027-01", [employee(emp, "MH")]);
    expect(await ptOf(tenant, before, emp)).toBe(20000);
    expect(await ptOf(tenant, after, emp)).toBe(25000);

    const list = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions?stateCode=MH", headers: hdr(tenant, ["hr_admin"]) });
    expect(list.statusCode).toBe(200);
    const mh = (list.json() as { states: Array<{ stateCode: string; versions: Array<{ effectiveFrom: string; effectiveTo: string | null; legacy: boolean }> }> }).states[0]!;
    expect(mh.versions.map((v) => [v.effectiveFrom, v.effectiveTo, v.legacy])).toEqual([
      ["1900-01-01", "2026-12-31", true],
      ["2027-01-01", null, false],
    ]);
  }, 90_000);

  it("a state with no version in force pays no PT (never another state's slabs)", async () => {
    const { tenant, structure } = await newTenant("KA", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();
    const run = await runMonth(tenant, structure, "2026-05", [employee(emp, "GJ")]);
    expect(await ptOf(tenant, run, emp)).toBe(0);
  }, 60_000);
});

describe("back-dating", () => {
  it("is refused on or before the end of the latest finalised run's month", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000 }]);
    const emp = randomUUID();
    const run = await runMonth(tenant, structure, "2026-11", [employee(emp, "MH")]);
    await q(tenant, sql`UPDATE payroll.payroll_runs SET status = 'approved' WHERE id = ${run}::uuid`);

    for (const effectiveFrom of ["2026-11-15", "2026-11-30", "2026-06-01"]) {
      const r = await createVersion(tenant, { stateCode: "MH", effectiveFrom, reason: "Correcting an earlier period", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000 }] });
      expect(r.statusCode, effectiveFrom).toBe(409);
      expect((r.json() as { code: string }).code).toBe("PT_BACKDATE_BEFORE_FINALISED_RUN");
    }
    // The day after the month is fine (needs a reason only while it is in the past).
    const ok = await createVersion(tenant, { stateCode: "MH", effectiveFrom: "2026-12-01", reason: "Revised schedule effective December", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 25000 }] });
    expect(ok.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "MH"), (r) => r.length === 2);
    // the finalised run's own slip is untouched
    expect(await ptOf(tenant, run, emp)).toBe(20000);
  }, 90_000);

  it("a back-dated version needs a reason, which is recorded and audited", async () => {
    const { tenant } = await newTenant("RJ", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const body = { stateCode: "RJ", effectiveFrom: "2020-04-01", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 15000 }] };
    const noReason = await createVersion(tenant, body);
    expect(noReason.statusCode).toBe(422);
    expect((noReason.json() as { code: string }).code).toBe("PT_BACKDATE_REASON_REQUIRED");

    const ok = await createVersion(tenant, { ...body, reason: "Notification received late from the Commercial Taxes Dept" });
    expect(ok.statusCode).toBe(202);
    await until(() => versionsOf(tenant, "RJ"), (r) => r.length === 2);
    const [hdrRow] = await q(tenant, sql`SELECT back_dated, reason, source, created_by::text AS by FROM payroll.payroll_pt_slab_versions WHERE state_code = 'RJ' AND effective_from = '2020-04-01'`);
    expect(hdrRow).toMatchObject({ back_dated: true, source: "user", by: ACTOR });
    expect(hdrRow!.reason).toContain("Commercial Taxes");
    const audits = await until(() => q(tenant, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = 'RJ:2020-04-01'`), (r) => r.length > 0);
    expect(audits[0]!.payload).toMatchObject({ action: "create", outcome: "success", backDated: true });
    expect(String((audits[0]!.payload as { reason: string }).reason)).toContain("Commercial Taxes");
  }, 60_000);
});

describe("immutability and access", () => {
  it("an existing effective date cannot be re-created, and stored versions cannot be updated or deleted", async () => {
    const { tenant } = await newTenant("TN", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const dup = await createVersion(tenant, { stateCode: "TN", effectiveFrom: "1900-01-01", reason: "Attempt to overwrite the baseline", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 99 }] });
    expect(dup.statusCode).toBe(409);
    expect((dup.json() as { code: string }).code).toBe("PT_VERSION_EXISTS");
    await expect(q(tenant, sql`UPDATE payroll.payroll_professional_tax SET pt_amount_minor = 1 WHERE state_code = 'TN'`)).rejects.toThrow(/PT_VERSION_IMMUTABLE/);
    await expect(q(tenant, sql`DELETE FROM payroll.payroll_professional_tax WHERE state_code = 'TN'`)).rejects.toThrow(/PT_VERSION_IMMUTABLE/);
    expect((await versionsOf(tenant, "TN"))[0]).toMatchObject({ amt: "10000" });
  }, 60_000);

  it("only payroll_admin / super_admin create versions; bad input is refused", async () => {
    const { tenant } = await newTenant("GJ", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const slabs = [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 15000 }];
    for (const role of ["payroll_officer", "hr_admin", "finance_officer", "employee"]) {
      expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs }, [role])).statusCode, role).toBe(403);
    }
    expect((await createVersion(tenant, { stateCode: "ZZ", effectiveFrom: "2099-06-01", slabs })).statusCode).toBe(422);
    expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 0 }, { fromMinor: 50, toMinor: 200, taxMinor: 0 }] })).statusCode).toBe(422);
    // one month's PT can never exceed the annual cap
    expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs: [{ fromMinor: 0, toMinor: 100, taxMinor: 250001 }] })).statusCode).toBe(400);
    expect((await createVersion(tenant, { stateCode: "GJ", effectiveFrom: "2099-06-01", slabs }, ["super_admin"])).statusCode).toBe(202);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt/versions", headers: hdr(tenant, ["employee"]) })).statusCode).toBe(403);
  }, 60_000);
});

describe("Article 276(2): PT never exceeds Rs 2,500 per employee per financial year", () => {
  it("clamps this month's PT to what is left of the cap", async () => {
    // Rs 300 a month; 8 finalised months (Apr-Nov 2026) already deducted Rs 2,400 -> Rs 100 left.
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) await seedFinalised(tenant, structure, emp, m, 30000);
    const run = await runMonth(tenant, structure, "2026-12", [employee(emp, "MH")]);
    expect(await ptOf(tenant, run, emp)).toBe(10000);
  }, 60_000);

  it("is zero once the cap is reached", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) await seedFinalised(tenant, structure, emp, m, 30000);
    await seedFinalised(tenant, structure, emp, "2026-12", 10000); // = Rs 2,500 in total
    const capped = await runMonth(tenant, structure, "2027-01", [employee(emp, "MH")]);
    expect(await ptOf(tenant, capped, emp)).toBe(0);
  }, 90_000);

  it("the previous financial year's PT never counts against the new one", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    await seedFinalised(tenant, structure, emp, "2026-03", 250000); // FY 2025-26
    const run = await runMonth(tenant, structure, "2026-05", [employee(emp, "MH")]);
    expect(await ptOf(tenant, run, emp)).toBe(30000);
  }, 60_000);

  it("only finalised runs count towards the year-to-date", async () => {
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 30000 }]);
    const emp = randomUUID();
    await seedFinalised(tenant, structure, emp, "2026-04", 250000);
    await q(tenant, sql`UPDATE payroll.payroll_runs SET status = 'failed' WHERE tenant_id = ${tenant}::uuid AND month = '2026-04'`);
    const run = await runMonth(tenant, structure, "2026-05", [employee(emp, "MH")]);
    expect(await ptOf(tenant, run, emp)).toBe(30000);
  }, 60_000);
});

describe("February amount (where a state's schedule has one)", () => {
  it("levies the February amount in February and the monthly amount otherwise, within the annual cap", async () => {
    // Rs 200 a month, Rs 300 in February (Rs 200 x 11 + Rs 300 = Rs 2,500).
    const { tenant, structure } = await newTenant("MH", [{ from: 0, to: 999999999999, amt: 20000, feb: 30000 }]);
    const emp = randomUUID();
    for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]) await seedFinalised(tenant, structure, emp, m, 20000);
    const feb = await runMonth(tenant, structure, "2027-02", [employee(emp, "MH")]);
    expect(await ptOf(tenant, feb, emp)).toBe(30000);
    const mar = await runMonth(tenant, structure, "2027-03", [employee(emp, "MH")]);
    expect(await ptOf(tenant, mar, emp)).toBe(20000);
  }, 90_000);
});

describe("concurrent creation is race-safe", () => {
  it("many commands for the same state + date create exactly one version", async () => {
    const { tenant } = await newTenant("KL", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const publish = (slabAmt: number) => queue.publish(COMMANDS.ptVersionCreate, {
      messageId: randomUUID(), type: COMMANDS.ptVersionCreate, tenantId: tenant, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: tenant, stateCode: "KL", effectiveFrom: "2099-03-01", reason: "Concurrent creation test", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: slabAmt }] },
    });
    await Promise.all([15000, 16000, 17000, 18000, 19000, 20000].map(publish));
    const rows = await until(() => versionsOf(tenant, "KL"), (r) => r.length >= 2);
    await new Promise((r) => setTimeout(r, 800)); // let the losers drain
    const finalRows = await versionsOf(tenant, "KL");
    expect(finalRows.filter((r) => r.eff === "2099-03-01")).toHaveLength(1);
    expect(finalRows).toHaveLength(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const headers = await q(tenant, sql`SELECT 1 FROM payroll.payroll_pt_slab_versions WHERE state_code = 'KL' AND effective_from = '2099-03-01'`);
    expect(headers).toHaveLength(1);
    const audits = await q(tenant, sql`SELECT payload->>'outcome' AS outcome FROM _outbox.messages WHERE tenant_id = ${tenant}::uuid AND topic = 'audit.event.record' AND payload->>'resourceId' = 'KL:2099-03-01'`);
    expect(audits.filter((a) => a.outcome === "success")).toHaveLength(1);
    expect(audits.filter((a) => a.outcome === "failure").length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("different dates created concurrently both land", async () => {
    const { tenant } = await newTenant("AP", [{ from: 0, to: 999999999999, amt: 10000 }]);
    const mk = (d: string) => createVersion(tenant, { stateCode: "AP", effectiveFrom: d, reason: "Concurrent distinct dates", slabs: [{ fromMinor: 0, toMinor: 999999999999, taxMinor: 12000 }] });
    const rs = await Promise.all([mk("2099-04-01"), mk("2099-05-01"), mk("2099-06-01")]);
    expect(rs.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    const rows = await until(() => versionsOf(tenant, "AP"), (r) => r.length === 4);
    expect(new Set(rows.map((r) => r.eff))).toEqual(new Set(["1900-01-01", "2099-04-01", "2099-05-01", "2099-06-01"]));
  }, 60_000);
});
