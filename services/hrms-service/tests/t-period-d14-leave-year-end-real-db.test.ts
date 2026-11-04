/**
 * UAT T-PERIOD D-14 -- the leave year-end job against Postgres
 * (modules/leave/year-end-job.ts, migration 0262):
 *  - dry run (GET /v1/hrms/leave/year-end/preview, the script default) writes nothing;
 *  - apply on 1 Jan 2027 (calendar leave year): EL carried + 15 credited into a
 *    2027-CY allocation, the 2026-27 row emptied; CL lapsed and re-credited;
 *    EOL of Jul-Dec 2026 reduces the credit; every change is an entry row and
 *    an audit event;
 *  - a second apply changes nothing (idempotent);
 *  - 1 Jul 2027: the balance above 300 lapses (cap_lapse), then 15 credited;
 *  - a non-credit date is refused (422 NOT_A_CREDIT_DATE); a tenant on a
 *    financial leave year is credited on 1 Apr;
 *  - the scheduled tick is OFF unless enabled, and only acts near a credit date.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { planLeaveYearEnd, runLeaveYearEndTickOnce } from "../src/modules/leave/year-end-job.js";
import { parseArgs } from "../scripts/leave-year-end.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const FY_TENANT = randomUUID();
const ACTOR = randomUUID();
const ids = { el: randomUUID(), cl: randomUUID(), eol: randomUUID(), e1: randomUUID(), e2: randomUUID(), gone: randomUUID(), elAlloc: randomUUID(), clAlloc: randomUUID(), e2El: randomUUID(), eolAlloc: randomUUID() };
const fy = { el: randomUUID(), e1: randomUUID(), alloc: randomUUID() };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(t: string, fn: (tx: Tx) => Promise<T>) => runWithTenant(t, () => db.transaction(fn));
let app: FastifyInstance;

async function q(t: string, query: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  return (await asTenant(t, (tx) => tx.execute(query))) as unknown as Array<Record<string, unknown>>;
}
async function allocs(t: string, employeeId: string) {
  return q(t, sql`SELECT id::text AS id, leave_type_id::text AS type, trim(fy) AS fy, total_days, balance_days FROM leave.hrms_leave_allocs WHERE tenant_id = ${t}::uuid AND employee_id = ${employeeId}::uuid ORDER BY fy, leave_type_id`);
}
async function cleanup(): Promise<void> {
  for (const t of [TENANT, FY_TENANT]) {
    await asTenant(t, async (tx) => {
      // leave.hrms_leave_year_end_entries is append-only for hrms_svc (SELECT, INSERT): its rows stay with the random tenant.
      for (const table of ["leave.hrms_leave_apps", "leave.hrms_leave_allocs", "leave.hrms_leave_types", "leave.hrms_leave_year_config", "employee.hrms_employees", "employee.hrms_designations", "employee.hrms_departments"]) {
        await tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${t}::uuid`);
      }
      await tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`);
    });
  }
}

async function seedEmployee(tx: Tx, t: string, id: string, no: string, doj: string, type: string, status: string, dept: string, desig: string): Promise<void> {
  await tx.execute(sql`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, created_by, updated_by)
    VALUES (${id}::uuid, ${t}::uuid, ${no}, ${"Staff " + no}, ${dept}::uuid, ${desig}::uuid, ${doj}, ${type}, ${status}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
}
async function seedType(tx: Tx, t: string, id: string, code: string, maxDays: number): Promise<void> {
  await tx.execute(sql`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, max_days, carry_forward, created_by, updated_by)
    VALUES (${id}::uuid, ${t}::uuid, ${code}, ${code}, ${maxDays}, ${code === "EL"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
}
async function seedAlloc(tx: Tx, t: string, id: string, emp: string, type: string, label: string, total: number, balance: number): Promise<void> {
  await tx.execute(sql`INSERT INTO leave.hrms_leave_allocs (id, tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by)
    VALUES (${id}::uuid, ${t}::uuid, ${emp}::uuid, ${type}::uuid, ${label}, ${total}, ${balance}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
}

beforeAll(async () => {
  await cleanup();
  for (const t of [TENANT, FY_TENANT]) {
    const dept = randomUUID(), desig = randomUUID();
    await asTenant(t, async (tx) => {
      await tx.execute(sql`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${dept}::uuid, ${t}::uuid, ${"LY"}, ${"LY"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      await tx.execute(sql`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${desig}::uuid, ${t}::uuid, ${"LYD"}, ${"LYD"}, 1, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      if (t === TENANT) {
        await seedEmployee(tx, t, ids.e1, "TP-EMP-01", "2020-04-01", "permanent", "probation", dept, desig);
        await seedEmployee(tx, t, ids.e2, "TP-EMP-02", "2018-07-01", "permanent", "confirmed", dept, desig);
        await seedEmployee(tx, t, ids.gone, "TP-GONE", "2010-01-01", "permanent", "separated", dept, desig);
        await seedType(tx, t, ids.el, "EL", 30);
        await seedType(tx, t, ids.cl, "CL", 8);
        await seedType(tx, t, ids.eol, "EOL", 0);
        await seedAlloc(tx, t, ids.elAlloc, ids.e1, ids.el, "2026-27", 300, 290);
        await seedAlloc(tx, t, ids.clAlloc, ids.e1, ids.cl, "2026-27", 8, 8);
        await seedAlloc(tx, t, ids.e2El, ids.e2, ids.el, "2026-27", 30, 20);
        await seedAlloc(tx, t, ids.eolAlloc, ids.e2, ids.eol, "2026-27", 0, 0);
        // TP-EMP-02 was on 25 days of EOL in Jul-Dec 2026: the 1 Jan credit is 15 - 3 = 12.
        await tx.execute(sql`INSERT INTO leave.hrms_leave_apps (tenant_id, employee_id, leave_type_id, alloc_id, from_date, to_date, days_applied, status, created_by, updated_by)
          VALUES (${t}::uuid, ${ids.e2}::uuid, ${ids.eol}::uuid, ${ids.eolAlloc}::uuid, ${"2026-09-01"}, ${"2026-09-25"}, 25, ${"approved"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
      } else {
        await tx.execute(sql`INSERT INTO leave.hrms_leave_year_config (tenant_id, year_start_month) VALUES (${t}::uuid, 4)`);
        await seedEmployee(tx, t, fy.e1, "FY-EMP-01", "2015-06-01", "permanent", "confirmed", dept, desig);
        await seedType(tx, t, fy.el, "EL", 30);
        await seedAlloc(tx, t, fy.alloc, fy.e1, fy.el, "2026-27", 300, 120);
      }
    });
  }
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

const token = (roles: string[], t = TENANT) => `Bearer ${signToken({ sub: ACTOR, tid: t, roles, sid: "t-period" }, SECRET)}`;

describe("T-PERIOD D-14: leave year-end job", () => {
  it("the script is a dry run by default; --apply needs --actor", () => {
    expect(parseArgs(["--tenant", TENANT, "--run-date", "2027-01-01"])).toMatchObject({ dryRun: true, tenants: [TENANT], runDate: "2027-01-01" });
    expect(() => parseArgs(["--apply", "--tenant", TENANT, "--run-date", "2027-01-01"])).toThrow(/--actor/);
  });

  it("preview (dry run) on 1 Jan 2027 lists the plan and writes nothing; HR admin only; non-credit date 422", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave/year-end/preview?runDate=2027-01-01", headers: { authorization: token(["hr_admin"]) } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { dryRun: boolean; leaveYear: string; opensLeaveYear: boolean; applied: number; ops: Array<{ employeeNo: string; code: string; newBalanceDays: number; entries: Array<{ action: string; days: number }> }> };
    expect(body).toMatchObject({ dryRun: true, leaveYear: "2027-CY", opensLeaveYear: true, applied: 0 });
    const el1 = body.ops.find((o) => o.employeeNo === "TP-EMP-01" && o.code === "EL")!;
    expect(el1.newBalanceDays).toBe(305);
    expect(body.ops.find((o) => o.employeeNo === "TP-EMP-02" && o.code === "EL")!.entries).toEqual(expect.arrayContaining([{ action: "credit", days: 12, allocId: null }]));
    expect(body.ops.some((o) => o.employeeNo === "TP-GONE")).toBe(false);
    expect((await allocs(TENANT, ids.e1)).map((a) => a.fy)).toEqual(["2026-27", "2026-27"]);
    expect((await q(TENANT, sql`SELECT count(*)::int AS n FROM leave.hrms_leave_year_end_entries WHERE tenant_id = ${TENANT}::uuid`))[0]!.n).toBe(0);

    expect((await app.inject({ method: "GET", url: "/v1/hrms/leave/year-end/preview?runDate=2027-01-01", headers: { authorization: token(["employee"]) } })).statusCode).toBe(403);
    const bad = await app.inject({ method: "GET", url: "/v1/hrms/leave/year-end/preview?runDate=2027-04-01", headers: { authorization: token(["hr_admin"]) } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("NOT_A_CREDIT_DATE");
  });

  it("apply on 1 Jan 2027: EL carried + credited, CL lapsed + re-credited, entries and audit written", async () => {
    const r = await planLeaveYearEnd(db, { tenantId: TENANT, runDate: "2027-01-01", dryRun: false, actorId: ACTOR });
    expect(r.applied).toBe(4); // TP-EMP-01 EL + CL, TP-EMP-02 EL + CL (new-year CL for everyone in service)
    const a1 = await allocs(TENANT, ids.e1);
    expect(a1.find((a) => a.id === ids.elAlloc)).toMatchObject({ fy: "2026-27", balance_days: 0 });
    expect(a1.find((a) => a.id === ids.clAlloc)).toMatchObject({ fy: "2026-27", balance_days: 0 });
    expect(a1.find((a) => a.fy === "2027-CY" && a.type === ids.el)).toMatchObject({ total_days: 305, balance_days: 305 });
    expect(a1.find((a) => a.fy === "2027-CY" && a.type === ids.cl)).toMatchObject({ total_days: 8, balance_days: 8 });
    expect((await allocs(TENANT, ids.e2)).find((a) => a.fy === "2027-CY" && a.type === ids.el)).toMatchObject({ balance_days: 32 }); // 20 + (15 - 3 for EOL)
    const entries = await q(TENANT, sql`SELECT leave_code, action, days::text AS days FROM leave.hrms_leave_year_end_entries WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${ids.e1}::uuid ORDER BY leave_code, action`);
    expect(entries).toEqual([
      { leave_code: "CL", action: "credit", days: "8.0" }, { leave_code: "CL", action: "lapse", days: "8.0" },
      { leave_code: "EL", action: "carry_forward", days: "290.0" }, { leave_code: "EL", action: "credit", days: "15.0" },
    ]);
    const audits = await q(TENANT, sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${"audit.event.record"} AND payload->>${"action"} = ${"leave_year_end"}`);
    expect(audits).toHaveLength(4);
  });

  it("a second apply for the same date changes nothing (idempotent)", async () => {
    const r = await planLeaveYearEnd(db, { tenantId: TENANT, runDate: "2027-01-01", dryRun: false, actorId: ACTOR });
    expect(r.applied).toBe(0);
    expect(r.ops).toEqual([]);
    expect((await allocs(TENANT, ids.e1)).find((a) => a.fy === "2027-CY" && a.type === ids.el)).toMatchObject({ balance_days: 305 });
  });

  it("1 Jul 2027: the 5 days above 300 lapse (recorded), then 15 credited", async () => {
    const r = await planLeaveYearEnd(db, { tenantId: TENANT, runDate: "2027-07-01", dryRun: false, actorId: ACTOR });
    expect(r.opensLeaveYear).toBe(false);
    expect((await allocs(TENANT, ids.e1)).find((a) => a.fy === "2027-CY" && a.type === ids.el)).toMatchObject({ balance_days: 315 });
    const lapse = await q(TENANT, sql`SELECT days::text AS days, note FROM leave.hrms_leave_year_end_entries WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${ids.e1}::uuid AND run_key = ${"2027-07-01"}::date AND action = ${"cap_lapse"}`);
    expect(lapse).toHaveLength(1);
    expect(lapse[0]!.days).toBe("5.0");
    expect(String(lapse[0]!.note)).toMatch(/300-day ceiling/);
    // CL is not touched mid-year
    expect((await allocs(TENANT, ids.e1)).find((a) => a.fy === "2027-CY" && a.type === ids.cl)).toMatchObject({ balance_days: 8 });
  });

  it("financial leave year tenant: credited on 1 Apr into 2027-28; 1 Jan is not a credit date there", async () => {
    await expect(planLeaveYearEnd(db, { tenantId: FY_TENANT, runDate: "2027-01-01", dryRun: true })).rejects.toMatchObject({ code: "NOT_A_CREDIT_DATE" });
    const r = await planLeaveYearEnd(db, { tenantId: FY_TENANT, runDate: "2027-04-01", dryRun: false, actorId: ACTOR });
    expect(r).toMatchObject({ leaveYearStartMonth: 4, leaveYear: "2027-28", applied: 1 });
    expect((await allocs(FY_TENANT, fy.e1)).find((a) => a.fy === "2027-28")).toMatchObject({ balance_days: 135 });
  });

  it("the scheduled tick is off by default and only acts within the catch-up window of a credit date", async () => {
    expect(await runLeaveYearEndTickOnce(db, { asOf: "2027-01-02" })).toMatchObject({ enabled: false, applied: 0 });
    const late = await runLeaveYearEndTickOnce(db, { asOf: "2027-09-20", enabled: true });
    expect(late.enabled).toBe(true);
    expect((await allocs(TENANT, ids.e1)).find((a) => a.fy === "2027-CY" && a.type === ids.el)).toMatchObject({ balance_days: 315 });
  });
});
