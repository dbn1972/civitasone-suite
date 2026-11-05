/**
 * UAT b18 (ERP-head decision 2026-11-05): pension scheme history backfill
 * (scripts/backfill-pension-scheme-history.ts) -- dry run by default,
 * idempotent, "initial" rows for employees without history, "correction" rows
 * for the switch made outside the change API (the 6 UAT contract staff).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { parseArgs, planBackfill, backfillPensionSchemeHistory, INITIAL_REASON } from "../scripts/backfill-pension-scheme-history.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const DEPT = randomUUID();
const DESIG = randomUUID();
const A = randomUUID(); // already has history
const B = randomUUID(); // no history -> initial row
const C = randomUUID(); // switched NPS -> EPF by SQL -> correction row (joint option)
const D = randomUUID(); // CPF member -> initial row (review SF4: used to crash the backfill)
const REASON = "UAT data correction 2026-11-05 (owner-approved switch to EPF)";
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));
let app: FastifyInstance;
const h0 = (rows: Array<Record<string, unknown>>, id: string) => rows.find((x) => x.employee_id === id);

async function history() {
  return await asTenant((tx) => tx.execute(sql`SELECT employee_id, kind, from_scheme, to_scheme, effective_from::text AS eff, status, requested_by, decided_by, reason, applied_at IS NOT NULL AS applied
    FROM employee.hrms_pension_scheme_changes WHERE tenant_id = ${TENANT}::uuid ORDER BY employee_id, effective_from`)) as unknown as Array<Record<string, unknown>>;
}
async function cleanup(): Promise<void> {
  await asTenant(async (tx) => {
    await tx.execute(sql`DELETE FROM employee.hrms_pension_scheme_changes WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
  });
}

beforeAll(async () => {
  await cleanup();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}::uuid, ${TENANT}::uuid, ${"BF"}, ${"BF"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG}::uuid, ${TENANT}::uuid, ${"BFD"}, ${"BFD"}, 1, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    for (const [id, no, scheme] of [[A, "BF-A", "NPS"], [B, "BF-B", "GPF"], [C, "UATG1-25595", "EPF"], [D, "BF-D", "CPF"]] as const) {
      await tx.execute(sql`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, pension_scheme, created_by, updated_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${no}, ${"Staff " + no}, ${DEPT}::uuid, ${DESIG}::uuid, ${"2026-10-28"}, ${"contract"}, ${"confirmed"}, ${scheme}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    }
    await tx.execute(sql`INSERT INTO employee.hrms_pension_scheme_changes (tenant_id, employee_id, from_scheme, to_scheme, effective_from, reason, status, requested_by, decided_by, decided_at, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${A}::uuid, ${"NPS"}, ${"UPS"}, ${"2027-04-01"}, ${"An earlier real scheme change request"}, ${"rejected"}, ${ACTOR}::uuid, ${randomUUID()}::uuid, now(), ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("arguments", () => {
  it("dry run is the default; --apply needs --actor; a correction needs --reason and a 1st-of-month date", () => {
    expect(parseArgs([]).dryRun).toBe(true);
    expect(() => parseArgs(["--apply"])).toThrow(/--actor/);
    expect(() => parseArgs(["--correction", "X=NPS:2027-02-01"])).toThrow(/--reason/);
    expect(() => parseArgs(["--correction", "X=NPS:2027-02-15", "--reason", REASON])).toThrow(/YYYY-MM-01/);
    expect(() => parseArgs(["--correction", "X=ABC:2027-02-01", "--reason", REASON])).toThrow(/FROM must be one of/);
    expect(parseArgs(["--correction", "X=NPS:2027-02-01:vjo", "--reason", REASON]).corrections.get("X")).toEqual({ fromScheme: "NPS", effectiveFrom: "2027-02-01", voluntaryJointOption: true });
    const a = parseArgs(["--apply", "--actor", ACTOR, "--tenant", TENANT, "--correction", "UATG1-25595=NPS:2027-02-01", "--reason", REASON]);
    expect(a).toMatchObject({ dryRun: false, actor: ACTOR, tenants: [TENANT], reason: REASON });
    expect(a.corrections.get("UATG1-25595")).toEqual({ fromScheme: "NPS", effectiveFrom: "2027-02-01" });
  });

  it("plan: initial row from = to on the joining month; correction row; unknown / redundant corrections reported", () => {
    const p = planBackfill(
      [{ id: "1", employeeNo: "E1", pensionScheme: "NPS", dateOfJoining: "2020-06-15" }, { id: "2", employeeNo: "E2", pensionScheme: "EPF", dateOfJoining: "2026-10-28" }, { id: "3", employeeNo: "E3", pensionScheme: "EPF", dateOfJoining: "2026-10-28" }],
      new Set(), new Map([["E2", { fromScheme: "NPS", effectiveFrom: "2027-02-01" }], ["E3", { fromScheme: "EPF", effectiveFrom: "2027-02-01" }], ["NOPE", { fromScheme: "NPS", effectiveFrom: "2027-02-01" }]]), REASON);
    expect(p.rows).toEqual([
      { employeeId: "1", employeeNo: "E1", kind: "initial", fromScheme: "NPS", toScheme: "NPS", effectiveFrom: "2020-06-01", reason: INITIAL_REASON },
      { employeeId: "2", employeeNo: "E2", kind: "correction", fromScheme: "NPS", toScheme: "EPF", effectiveFrom: "2027-02-01", reason: REASON },
    ]);
    expect(p.skipped.map((s) => s.employeeNo)).toEqual(["E3", "NOPE"]);
  });
});

describe("backfill against the database", () => {
  const args = (apply: boolean) => parseArgs([...(apply ? ["--apply", "--actor", ACTOR] : []), "--tenant", TENANT, "--correction", "UATG1-25595=NPS:2027-02-01:vjo", "--reason", REASON]);

  it("dry run reports the plan and writes nothing", async () => {
    const r = await backfillPensionSchemeHistory(args(false));
    expect(r).toMatchObject({ dryRun: true, written: 0 });
    expect(r.planned.map((p) => [p.employeeNo, p.kind])).toEqual(expect.arrayContaining([["BF-B", "initial"], ["UATG1-25595", "correction"]]));
    expect(r.planned.some((p) => p.employeeId === A)).toBe(false);
    expect((await history()).length).toBe(1);
  });

  it("--apply writes approved, applied rows for B and D (initial, CPF included) and C (correction + joint option), audited; A is untouched", async () => {
    const r = await backfillPensionSchemeHistory(args(true));
    expect(r.written).toBe(3);
    expect(h0(await history(), D)).toMatchObject({ kind: "initial", from_scheme: "CPF", to_scheme: "CPF" });
    const vjo = await asTenant((tx) => tx.execute(sql`SELECT epf_voluntary_joint_option AS v FROM employee.hrms_employees WHERE id = ${C}::uuid`)) as unknown as Array<{ v: boolean }>;
    expect(vjo[0]!.v).toBe(true);
    const h = await history();
    expect(h.find((x) => x.employee_id === B)).toMatchObject({ kind: "initial", from_scheme: "GPF", to_scheme: "GPF", eff: "2026-10-01", status: "approved", decided_by: ACTOR, applied: true });
    expect(h.find((x) => x.employee_id === C)).toMatchObject({ kind: "correction", from_scheme: "NPS", to_scheme: "EPF", eff: "2027-02-01", status: "approved", reason: REASON, decided_by: ACTOR });
    expect(h.filter((x) => x.employee_id === A)).toHaveLength(1);
    const audits = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM _outbox.messages WHERE tenant_id = ${TENANT} AND payload->>${"action"} = ${"pension_scheme_history_backfill"}`)) as unknown as Array<{ n: number }>;
    expect(audits[0]!.n).toBe(3);
    const emp = await asTenant((tx) => tx.execute(sql`SELECT pension_scheme FROM employee.hrms_employees WHERE id = ${C}::uuid`)) as unknown as Array<{ pension_scheme: string }>;
    expect(emp[0]!.pension_scheme).toBe("EPF");
  });

  it("is idempotent: a second --apply writes nothing", async () => {
    const r = await backfillPensionSchemeHistory(args(true));
    expect(r.written).toBe(0);
    expect(r.planned).toEqual([]);
    expect((await history()).length).toBe(4);
  });

  it("payroll-input: the corrected employee is NPS before 2027-02 and EPF from it", async () => {
    const feed = async (month: string) => ((await app.inject({ method: "GET", url: `/v1/hrms/internal/payroll-input?month=${month}`,
      headers: { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "bf" }, SECRET)}` } })).json() as { employees: Array<{ id: string; pensionScheme: string }> }).employees;
    expect((await feed("2027-01")).find((e) => e.id === C)!.pensionScheme).toBe("NPS");
    expect((await feed("2027-02")).find((e) => e.id === C)!.pensionScheme).toBe("EPF");
    expect((await feed("2027-01")).find((e) => e.id === B)!.pensionScheme).toBe("GPF");
  });
});
