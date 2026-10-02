/**
 * GAP-PAYROLL-REGISTER-WRITER -- real-Postgres tests for the writer side of
 * payroll.payroll_register (nothing used to write it, so /hr/payroll/register
 * and /hr/payroll/comparison were always empty).
 *
 * Drives the REAL queue consumer (COMMANDS.runCreate -> processPayrollRun)
 * with only the HRMS HTTP client mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { PayrollInputEmployee } from "../src/shared/hrms-client.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCT = randomUUID();
const D_REV = randomUUID();
const D_EDU = randomUUID();
const E1 = randomUUID();
const E2 = randomUUID();
const E3 = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function emp(id: string, no: string, basic: string, departmentId: string): PayrollInputEmployee {
  return {
    id, employeeNo: no, fullName: no, basicMinor: basic, dateOfJoining: "2020-01-01", payStructureId: STRUCT,
    bankAccountNo: null, bankIfsc: null, pan: null, uan: null, cityClass: "X", taxRegime: "new",
    departmentId, pensionScheme: "EPF",
  };
}
const EMPLOYEES = [emp(E1, "E1", "3000000", D_REV), emp(E2, "E2", "4500000", D_REV), emp(E3, "E3", "6000000", D_EDU)];
const FAIL_TENANT = randomUUID();

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    fetchPayrollInput: vi.fn(async (tenantId: string, month: string) => {
      if (tenantId === FAIL_TENANT) throw new NonRetryableError("hrms payroll-input failed: 500");
      return { month, employees: EMPLOYEES, lopDays: {}, overtimeHours: {} };
    }),
    fetchEmployeeSummaries: vi.fn(async () => new Map([
      [E1, { fullName: "E1", departmentName: "Revenue", employeeNo: "E1" }],
      [E2, { fullName: "E2", departmentName: "Revenue", employeeNo: "E2" }],
      [E3, { fullName: "E3", departmentName: "Education", employeeNo: "E3" }],
    ])),
  };
});

const { db, sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
const { COMMANDS } = await import("../src/topics.js");
const { buildApp } = await import("../src/app.js");
const { rebuildRunRegister, resolveRegisterDepartments, aggregateRegister } = await import("../src/modules/payroll/register.js");
const { backfillPayrollRegister } = await import("../src/modules/payroll/register-backfill.js");
const memQueue = queue as unknown as MemoryQueue;

type RegRow = {
  department_id: string | null; department_name: string | null; employee_count: number;
  total_gross_minor: string; total_deductions_minor: string; total_net_minor: string;
  total_pf_minor: string; total_esi_minor: string; total_tds_minor: string; total_pt_minor: string; period: string;
};
type SlipSum = { n: number; gross: string; ded: string; net: string; pf: string; esi: string; tds: string };

const inTenant = <T>(tenant: string, fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function registerRows(tenant: string, runId: string): Promise<RegRow[]> {
  return (await inTenant(tenant, (tx) => tx.execute(sql`
    SELECT department_id::text, department_name, employee_count,
           total_gross_minor::text, total_deductions_minor::text, total_net_minor::text,
           total_pf_minor::text, total_esi_minor::text, total_tds_minor::text, total_pt_minor::text, period
      FROM payroll.payroll_register WHERE tenant_id = ${tenant}::uuid AND run_id = ${runId}::uuid
     ORDER BY department_name
  `))) as unknown as RegRow[];
}

async function slipSums(tenant: string, runId: string, employeeIds: string[]): Promise<SlipSum> {
  const rows = (await inTenant(tenant, (tx) => tx.execute(sql`
    SELECT COUNT(*)::int AS n, SUM(gross_minor)::text AS gross, SUM(total_deductions_minor)::text AS ded,
           SUM(net_pay_minor)::text AS net, SUM(pf_employee_minor)::text AS pf, SUM(esi_minor)::text AS esi,
           SUM(tds_minor)::text AS tds
      FROM payroll.payroll_slips
     WHERE tenant_id = ${tenant}::uuid AND run_id = ${runId}::uuid
       AND employee_id = ANY(${sql`ARRAY[${sql.join(employeeIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
  `))) as unknown as SlipSum[];
  return rows[0]!;
}

async function computeRun(tenant: string, runId: string, month: string, runType = "regular"): Promise<void> {
  await queue.publish(COMMANDS.runCreate, {
    messageId: randomUUID(), type: COMMANDS.runCreate, tenantId: tenant, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: runId, tenantId: tenant, runNo: `RUN-${month}-${runId.slice(0, 4)}`, month, structureId: STRUCT, runType },
  });
  await memQueue.drain();
}

/** Finalise a computed run (the approve consumer's maker-checker is covered elsewhere). */
async function approve(tenant: string, runId: string): Promise<void> {
  await inTenant(tenant, (tx) => tx.execute(sql`UPDATE payroll.payroll_runs SET status = 'approved' WHERE id = ${runId}::uuid AND tenant_id = ${tenant}::uuid`));
}

type Summary = { hasData: boolean; gross: string; net: string; headcount: number };
async function getJson(url: string): Promise<{ statusCode: number; body: unknown }> {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "sess-reg" }, SECRET);
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  await app.close();
  return { statusCode: res.statusCode, body: res.json() };
}
async function compare(p1: string, p2: string): Promise<{ period1: Summary; period2: Summary }> {
  const r = await getJson(`/v1/payroll/comparison?period1=${p1}&period2=${p2}`);
  expect(r.statusCode).toBe(200);
  return r.body as { period1: Summary; period2: Summary };
}

async function seedTenant(tenant: string): Promise<void> {
  await inTenant(tenant, async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, created_by, updated_by) VALUES (${STRUCT}::uuid, ${tenant}::uuid, 'S', ${ACTOR}::uuid, ${ACTOR}::uuid) ON CONFLICT DO NOTHING`);
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${tenant}::uuid, '2026-01-01'::date, 5000)`);
  });
}

beforeAll(async () => {
  await seedTenant(TENANT);
  registerPayrollConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await queue.stop();
  await sqlClient.end();
});

const AUG_RUN = randomUUID();
const SEP_RUN = randomUUID();

describe("computing a run writes the department-wise register", () => {
  it("writes one row per department whose totals equal that department's slip totals", async () => {
    await computeRun(TENANT, AUG_RUN, "2026-08");
    const run = (await inTenant(TENANT, (tx) => tx.execute(sql`SELECT status, total_gross_minor::text AS g, total_net_minor::text AS n FROM payroll.payroll_runs WHERE id = ${AUG_RUN}::uuid`))) as unknown as Array<{ status: string; g: string; n: string }>;
    expect(run[0]?.status).toBe("processing");

    const rows = await registerRows(TENANT, AUG_RUN);
    expect(rows.map((r) => r.department_name)).toEqual(["Education", "Revenue"]);
    const [edu, rev] = rows as [RegRow, RegRow];
    expect(edu.department_id).toBe(D_EDU);
    expect(rev.department_id).toBe(D_REV);
    expect(rows.every((r) => r.period === "2026-08")).toBe(true);

    for (const [row, ids] of [[rev, [E1, E2]], [edu, [E3]]] as const) {
      const s = await slipSums(TENANT, AUG_RUN, [...ids]);
      expect(row.employee_count).toBe(s.n);
      expect(row.total_gross_minor).toBe(s.gross);
      expect(row.total_deductions_minor).toBe(s.ded);
      expect(row.total_net_minor).toBe(s.net);
      expect(row.total_pf_minor).toBe(s.pf);
      expect(row.total_esi_minor).toBe(s.esi);
      expect(row.total_tds_minor).toBe(s.tds);
    }
    expect(BigInt(rev.total_gross_minor)).toBeGreaterThan(0n);
    // Register grand totals == the run's own (slip-derived) totals.
    expect((BigInt(edu.total_gross_minor) + BigInt(rev.total_gross_minor)).toString()).toBe(run[0]!.g);
    expect((BigInt(edu.total_net_minor) + BigInt(rev.total_net_minor)).toString()).toBe(run[0]!.n);

    const audits = (await inTenant(TENANT, (tx) => tx.execute(sql`
      SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid
        AND payload->>'resourceType' = 'payroll_register' AND payload->>'resourceId' = ${AUG_RUN}
    `))) as unknown as unknown[];
    expect(audits.length).toBe(1);
  });

  it("a rebuild of the same run is idempotent (same rows, no duplicates)", async () => {
    const before = await registerRows(TENANT, AUG_RUN);
    const depts = await resolveRegisterDepartments(TENANT, EMPLOYEES);
    for (let i = 0; i < 2; i++) {
      await inTenant(TENANT, (tx) => rebuildRunRegister(tx, { tenantId: TENANT, runId: AUG_RUN, period: "2026-08" }, depts));
    }
    expect(await registerRows(TENANT, AUG_RUN)).toEqual(before);
  });
});

describe("a failed run leaves no register rows", () => {
  it("clears rows an earlier pass left behind when the run fails", async () => {
    await seedTenant(FAIL_TENANT);
    const runId = randomUUID();
    await inTenant(FAIL_TENANT, (tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_register (tenant_id, run_id, department_name, employee_count, total_gross_minor, total_net_minor, period)
      VALUES (${FAIL_TENANT}::uuid, ${runId}::uuid, 'Stale', 1, 100, 90, '2026-08')
    `));
    await computeRun(FAIL_TENANT, runId, "2026-08");
    const run = (await inTenant(FAIL_TENANT, (tx) => tx.execute(sql`SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid`))) as unknown as Array<{ status: string }>;
    expect(run[0]?.status).toBe("failed");
    expect(await registerRows(FAIL_TENANT, runId)).toEqual([]);
  });
});

describe("GET /v1/payroll/comparison reads the written register", () => {
  it("returns hasData:true for both periods with deltas matching the slips", async () => {
    // September: E3 gets a raise via a salary revision, so the periods differ.
    await inTenant(TENANT, (tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_salary_revisions (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor)
      VALUES (${TENANT}::uuid, ${E3}::uuid, '2026-09-01'::date, 6000000, 7000000, 0, 0)
    `));
    await computeRun(TENANT, SEP_RUN, "2026-09");
    await approve(TENANT, AUG_RUN);
    await approve(TENANT, SEP_RUN);

    const body = await compare("2026-08", "2026-09");
    expect(body.period1.hasData).toBe(true);
    expect(body.period2.hasData).toBe(true);
    expect(Number(body.period1.headcount)).toBe(3);
    expect(Number(body.period2.headcount)).toBe(3);

    const aug = await slipSums(TENANT, AUG_RUN, [E1, E2, E3]);
    const sep = await slipSums(TENANT, SEP_RUN, [E1, E2, E3]);
    expect(String(body.period1.gross)).toBe(aug.gross);
    expect(String(body.period2.gross)).toBe(sep.gross);
    const grossDelta = BigInt(String(body.period2.gross)) - BigInt(String(body.period1.gross));
    const netDelta = BigInt(String(body.period2.net)) - BigInt(String(body.period1.net));
    expect(grossDelta).toBe(BigInt(sep.gross) - BigInt(aug.gross));
    expect(netDelta).toBe(BigInt(sep.net) - BigInt(aug.net));
    expect(grossDelta).toBeGreaterThan(0n);
  });
});

describe("period views count finalised runs only; runId shows any status", () => {
  it("a computed-but-unapproved run is excluded from the comparison and period register, visible by runId", async () => {
    const octRun = randomUUID();
    await computeRun(TENANT, octRun, "2026-10");
    expect((await registerRows(TENANT, octRun)).length).toBe(2);

    const cmp = await compare("2026-09", "2026-10");
    expect(cmp.period1.hasData).toBe(true);
    expect(cmp.period2.hasData).toBe(false);

    const byPeriod = await getJson("/v1/payroll/register?period=2026-10");
    expect((byPeriod.body as { data: unknown[] }).data).toEqual([]);
    const all = (await getJson("/v1/payroll/register")).body as { data: Array<{ run_id: string }> };
    expect(all.data.some((r) => r.run_id === octRun)).toBe(false);
    expect(all.data.some((r) => r.run_id === AUG_RUN)).toBe(true);
    const byRun = (await getJson(`/v1/payroll/register?runId=${octRun}`)).body as { data: Array<{ department_name: string }> };
    expect(byRun.data.map((r) => r.department_name)).toEqual(["Education", "Revenue"]);

    await approve(TENANT, octRun);
    expect((await compare("2026-09", "2026-10")).period2.hasData).toBe(true);
  });

  it("a regular + supplementary run in one month: gross adds up, headcount counts each employee once", async () => {
    const augBefore = (await compare("2026-08", "2026-09")).period1;
    const supp = randomUUID();
    await computeRun(TENANT, supp, "2026-08", "supplementary");
    await approve(TENANT, supp);
    const supSlips = await slipSums(TENANT, supp, [E1, E2, E3]);
    expect(supSlips.n).toBe(3);

    const aug = (await compare("2026-08", "2026-09")).period1;
    expect(Number(aug.headcount)).toBe(3);
    expect(BigInt(String(aug.gross))).toBe(BigInt(String(augBefore.gross)) + BigInt(supSlips.gross));
    expect(BigInt(String(aug.net))).toBe(BigInt(String(augBefore.net)) + BigInt(supSlips.net));
  });
});

describe("resolveRegisterDepartments", () => {
  it("gives an employee missing from the feed the department id its name unambiguously maps to", async () => {
    const separated = randomUUID();
    const { fetchEmployeeSummaries } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchEmployeeSummaries).mockResolvedValueOnce(new Map([
      [E1, { fullName: "E1", departmentName: "Revenue", employeeNo: "E1" }],
      [E3, { fullName: "E3", departmentName: "Education", employeeNo: "E3" }],
      [separated, { fullName: "S", departmentName: "Revenue", employeeNo: "S" }],
    ]));
    const depts = await resolveRegisterDepartments(TENANT, [EMPLOYEES[0]!, EMPLOYEES[2]!]);
    expect(depts.get(separated)).toEqual({ departmentId: D_REV, departmentName: "Revenue" });
    expect(depts.get(E3)).toEqual({ departmentId: D_EDU, departmentName: "Education" });
  });

  it("leaves the id null when the name is ambiguous across departments", async () => {
    const other = randomUUID();
    const { fetchEmployeeSummaries } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchEmployeeSummaries).mockResolvedValueOnce(new Map([
      [E1, { fullName: "E1", departmentName: "Admin", employeeNo: "E1" }],
      [E3, { fullName: "E3", departmentName: "Admin", employeeNo: "E3" }],
      [other, { fullName: "O", departmentName: "Admin", employeeNo: "O" }],
    ]));
    const depts = await resolveRegisterDepartments(TENANT, [EMPLOYEES[0]!, EMPLOYEES[2]!]);
    expect(depts.get(other)).toEqual({ departmentId: null, departmentName: "Admin" });
  });
});

describe("backfill of runs computed before the writer existed", () => {
  it("writes rows for approved/disbursed runs only, and is idempotent", async () => {
    const tenant = randomUUID();
    await seedTenant(tenant);
    const approved = randomUUID();
    const failed = randomUUID();
    const pensioner = randomUUID();
    await inTenant(tenant, async (tx) => {
      for (const [id, status, runType] of [[approved, "approved", "regular"], [failed, "failed", "supplementary"], [pensioner, "disbursed", "pensioner"]] as const) {
        await tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, run_type, created_by, updated_by) VALUES (${id}::uuid, ${tenant}::uuid, ${"R-" + status + "-" + runType}, '2026-07', ${STRUCT}::uuid, ${status}, ${runType}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
        await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, total_deductions_minor, net_pay_minor, pf_employee_minor, created_by, updated_by) VALUES (${tenant}::uuid, ${id}::uuid, ${E1}::uuid, 'E1', 5000000, 600000, 4400000, 360000, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      }
      await tx.execute(sql`INSERT INTO payroll.payroll_slips (tenant_id, run_id, employee_id, employee_no, gross_minor, total_deductions_minor, net_pay_minor, components, created_by, updated_by) VALUES (${tenant}::uuid, ${approved}::uuid, ${E3}::uuid, 'E3', 7000000, 20000, 6980000, ${JSON.stringify([{ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: 20000 }])}::jsonb, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    });

    const dry = await backfillPayrollRegister(tenant, { actorId: ACTOR, dryRun: true });
    expect(dry).toMatchObject({ runsSeen: 1, runsWritten: 0 });
    expect(await registerRows(tenant, approved)).toEqual([]);

    const first = await backfillPayrollRegister(tenant, { actorId: ACTOR });
    expect(first).toEqual({ runsSeen: 1, runsWritten: 1, runsSkipped: 0, rowsWritten: 2 });
    const rows = await registerRows(tenant, approved);
    expect(rows.map((r) => [r.department_name, r.employee_count, r.total_gross_minor, r.total_net_minor, r.total_pf_minor, r.total_pt_minor, r.period])).toEqual([
      ["Education", 1, "7000000", "6980000", "0", "20000", "2026-07"],
      ["Revenue", 1, "5000000", "4400000", "360000", "0", "2026-07"],
    ]);
    expect(await registerRows(tenant, failed)).toEqual([]);
    expect(await registerRows(tenant, pensioner)).toEqual([]);

    const second = await backfillPayrollRegister(tenant, { actorId: ACTOR });
    expect(second).toEqual({ runsSeen: 1, runsWritten: 0, runsSkipped: 1, rowsWritten: 0 });
    const rebuilt = await backfillPayrollRegister(tenant, { actorId: ACTOR, rebuild: true });
    expect(rebuilt).toMatchObject({ runsWritten: 1, rowsWritten: 2 });
    expect(await registerRows(tenant, approved)).toEqual(rows);
  });
});

describe("aggregateRegister", () => {
  it("groups unknown employees into one null-department row and sums PT from components", () => {
    const base = { tenantId: TENANT, runId: AUG_RUN, employeeNo: "X", basicMinor: 0n, currency: "INR", pfEmployerMinor: 0n, gpfMinor: 0n, npsEmployeeMinor: 0n, npsEmployerMinor: 0n, status: "computed", createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR, version: 1 };
    const slip = (employeeId: string, gross: bigint, pt: number) => ({
      ...base, id: randomUUID(), employeeId, grossMinor: gross, totalDeductionsMinor: 0n, netPayMinor: gross,
      pfEmployeeMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
      components: pt ? [{ code: "PT", name: "PT", type: "deduction", amountMinor: pt }] : [],
    });
    const rows = aggregateRegister([slip(randomUUID(), 100n, 200), slip(randomUUID(), 50n, 0)], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ departmentId: null, departmentName: null, employeeCount: 2, totalGrossMinor: 150n, totalPtMinor: 200n });
  });
});
