/**
 * UAT b18 D1 / D3 (EPF for contract staff, 2026-11-05) -- real Postgres.
 * Maker-checker, effective-dated pension scheme change; the payroll-input feed
 * gives each month the scheme in effect then; UAN required for EPF; the hire
 * default by rule; the worker tick applies a future-dated change.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { todayIST } from "../src/shared/ist.js";
import { decryptPii } from "../src/shared/pii-crypto.js";
import { applyDuePensionSchemeChangesOnce } from "../src/modules/employee/pension-scheme-scheduler.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const DEPT = randomUUID();
const DESIG = randomUUID();
const C1 = randomUUID(); // contract, NPS on record (the UAT state), no UAN
const C2 = randomUUID(); // permanent, NPS, valid UAN
const C3 = randomUUID(); // for the reject path
const C4 = randomUUID(); // separated
// Review SF5 / SF8
const R1 = randomUUID(); // regular post-2004 NPS: matrix + override
const R2 = randomUUID(); // regular post-2004 NPS: UPS once / switch back once
const R3 = randomUUID(); // contract NPS with UAN: concurrent requests
const OTHER_TENANT = randomUUID();
const AP2 = randomUUID(); // an existing apprentice still on NPS (delta review SF3)
const SUPER = randomUUID();
const UAN1 = "100200300401";

const h = (actor: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles, sid: "b18" }, SECRET)}` });
const maker = h(MAKER, ["hr_admin"]);
const checker = h(CHECKER, ["hr_admin"]);
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));

const THIS_MONTH = todayIST().slice(0, 7);
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const first = (ym: string) => `${ym}-01`;

let app: FastifyInstance;

async function empRow(id: string) {
  const r = await asTenant((tx) => tx.execute(sql`SELECT pension_scheme, uan_number, version FROM employee.hrms_employees WHERE id = ${id}::uuid`)) as unknown as Array<{ pension_scheme: string; uan_number: string | null; version: number }>;
  // G6 (migration 0268): uan_number is encrypted at rest; this helper returns the clear value, as the column type does.
  const row = r[0]!;
  return { ...row, uan_number: row.uan_number == null ? null : decryptPii(row.uan_number) };
}
async function audits(employeeId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await asTenant((tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND tenant_id = ${TENANT}
    AND payload->>${"resourceId"} = ${employeeId} AND payload->>${"action"} LIKE ${"pension_scheme%"} ORDER BY created_at`)) as unknown as Array<{ payload: Record<string, unknown> }>;
  return rows.map((r) => r.payload);
}
async function feedScheme(month: string, id: string): Promise<string> {
  const r = await app.inject({ method: "GET", url: `/v1/hrms/internal/payroll-input?month=${month}`, headers: h(MAKER, ["payroll_admin"]) });
  expect(r.statusCode).toBe(200);
  return (r.json() as { employees: Array<{ id: string; pensionScheme: string }> }).employees.find((e) => e.id === id)!.pensionScheme;
}
const request = (id: string, body: Record<string, unknown>, headers = maker) =>
  app.inject({ method: "POST", url: `/v1/hrms/employees/${id}/pension-scheme-changes`, headers, payload: body });
const decide = (changeId: string, action: "approve" | "reject", body: Record<string, unknown>, headers = checker) =>
  app.inject({ method: "POST", url: `/v1/hrms/pension-scheme-changes/${changeId}/${action}`, headers, payload: body });
const REASON = "Contract staff are EPF members (owner decision 2026-11-05)";

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
    await tx.execute(sql`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}::uuid, ${TENANT}::uuid, ${"B18"}, ${"B18 Dept"}, ${MAKER}::uuid, ${MAKER}::uuid)`);
    await tx.execute(sql`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by) VALUES (${DESIG}::uuid, ${TENANT}::uuid, ${"B18D"}, ${"B18 Desig"}, 1, ${MAKER}::uuid, ${MAKER}::uuid)`);
    for (const [id, no, type, status, uan] of [
      [C1, "B18-C1", "contract", "confirmed", null], [C2, "B18-C2", "permanent", "confirmed", "100200300402"],
      [C3, "B18-C3", "contract", "confirmed", "100200300403"], [C4, "B18-C4", "contract", "separated", null],
      [R1, "B18-R1", "permanent", "confirmed", null], [R2, "B18-R2", "permanent", "confirmed", null], [R3, "B18-R3", "contract", "confirmed", "100200300405"],
      [AP2, "B18-AP2", "apprentice", "confirmed", null],
    ] as const) {
      await tx.execute(sql`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, employee_type, status, pension_scheme, uan_number, basic_minor, created_by, updated_by)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${no}, ${"Staff " + no}, ${DEPT}::uuid, ${DESIG}::uuid, ${"2025-01-15"}, ${type}, ${status}, ${"NPS"}, ${uan}, 1800000, ${MAKER}::uuid, ${MAKER}::uuid)`);
    }
  });
  app = await buildApp();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("D1: maker-checker change NPS -> EPF effective this month", () => {
  let changeId = "";

  it("EPF without a UAN is refused (422 UAN_REQUIRED); a malformed UAN is a 400", async () => {
    const r = await request(C1, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: REASON });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("UAN_REQUIRED");
    expect((await request(C1, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: REASON, uanNumber: "12345" })).statusCode).toBe(400);
  });

  it("a reason is mandatory and the date must be the 1st of a month, not before joining", async () => {
    expect((await request(C1, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), uanNumber: UAN1 })).statusCode).toBe(400);
    expect((await request(C1, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: "short", uanNumber: UAN1 })).statusCode).toBe(400);
    expect((await request(C1, { toScheme: "EPF", effectiveFrom: `${THIS_MONTH}-15`, reason: REASON, uanNumber: UAN1 })).statusCode).toBe(400);
    const early = await request(C1, { toScheme: "EPF", effectiveFrom: "2024-12-01", reason: REASON, uanNumber: UAN1 });
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe("PENSION_SCHEME_EFFECTIVE_BEFORE_JOINING");
  });

  it("the maker files the request (pending, audited, nothing changes yet); a second one is refused", async () => {
    const r = await request(C1, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: REASON, uanNumber: UAN1 });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "pending", fromScheme: "NPS", toScheme: "EPF", effectiveFrom: first(THIS_MONTH), requestedBy: MAKER });
    changeId = r.json().id;
    expect(await empRow(C1)).toMatchObject({ pension_scheme: "NPS", uan_number: null });
    const dup = await request(C1, { toScheme: "UPS", effectiveFrom: first(addMonths(THIS_MONTH, 1)), reason: REASON });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("PENSION_SCHEME_CHANGE_PENDING");
  });

  it("the maker cannot approve their own request; hr_officer is not a checker", async () => {
    const self = await decide(changeId, "approve", {}, maker);
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await decide(changeId, "approve", {}, h(randomUUID(), ["hr_officer"]))).statusCode).toBe(403);
    expect((await empRow(C1)).pension_scheme).toBe("NPS");
  });

  it("a different approver approves: scheme and UAN switch now, audited with before/after", async () => {
    const r = await decide(changeId, "approve", { note: "Checked against the contract terms" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "approved", decidedBy: CHECKER, appliedNow: true, retroPeriods: [] });
    expect(await empRow(C1)).toMatchObject({ pension_scheme: "EPF", uan_number: UAN1 });
    const a = await audits(C1);
    expect(a.map((x) => x.action)).toEqual(["pension_scheme_change_request", "pension_scheme_change"]);
    expect(a[1]).toMatchObject({ oldValue: { pensionScheme: "NPS", uanNumber: null }, newValue: { pensionScheme: "EPF", uanNumber: "********0401" }, reason: REASON });
    // G6: the audit carries the UAN masked, never in clear, and the requested UAN is encrypted at rest.
    expect(JSON.stringify(a)).not.toContain(UAN1);
    const held = await asTenant((tx) => tx.execute(sql`SELECT uan_number FROM employee.hrms_pension_scheme_changes WHERE id = ${changeId}::uuid`)) as unknown as Array<{ uan_number: string }>;
    expect(held[0]!.uan_number).toMatch(/^enc:v2:/);
    const again = await decide(changeId, "reject", { note: "too late" });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("PENSION_SCHEME_CHANGE_NOT_PENDING");
  });

  it("payroll-input: last month keeps NPS, this month is EPF", async () => {
    expect(await feedScheme(addMonths(THIS_MONTH, -1), C1)).toBe("NPS");
    expect(await feedScheme(THIS_MONTH, C1)).toBe("EPF");
  });
});

describe("D1: back-dated and future-dated changes", () => {
  it("back-dated NPS -> UPS: applied now, the past months are reported (not reposted)", async () => {
    const from = addMonths(THIS_MONTH, -3);
    const r = await request(C2, { toScheme: "UPS", effectiveFrom: first(from), reason: "Opted for UPS under the 2025 notification" });
    expect(r.statusCode).toBe(201);
    const a = await decide(r.json().id, "approve", {});
    expect(a.statusCode).toBe(200);
    expect(a.json().retroPeriods).toEqual([from, addMonths(THIS_MONTH, -2), addMonths(THIS_MONTH, -1)]);
    expect(a.json().retro).toMatchObject({ policy: "report_only" });
    expect(a.json().retro.report).toBe(`/v1/payroll/reports/pension-scheme-retro?employeeId=${C2}&fromMonth=${from}&toScheme=UPS`);
    expect((await empRow(C2)).pension_scheme).toBe("UPS");
    expect(await feedScheme(addMonths(THIS_MONTH, -4), C2)).toBe("NPS");
    expect(await feedScheme(from, C2)).toBe("UPS");
  });

  it("a change effective before the last approved one is refused; so is a no-op change", async () => {
    const before = await request(C2, { toScheme: "NPS", effectiveFrom: first(addMonths(THIS_MONTH, -4)), reason: REASON });
    expect(before.statusCode).toBe(409);
    expect(before.json().code).toBe("PENSION_SCHEME_EFFECTIVE_NOT_AFTER_LAST");
    const same = await request(C2, { toScheme: "UPS", effectiveFrom: first(addMonths(THIS_MONTH, 1)), reason: REASON });
    expect(same.statusCode).toBe(409);
    expect(same.json().code).toBe("PENSION_SCHEME_UNCHANGED");
  });

  it("future-dated UPS -> NPS (the one-time switch back): not applied at approval, the worker tick applies it on the date, once", async () => {
    const eff = addMonths(THIS_MONTH, 2);
    const r = await request(C2, { toScheme: "NPS", effectiveFrom: first(eff), reason: "One-time switch back from UPS to NPS" });
    expect(r.statusCode).toBe(201);
    const a = await decide(r.json().id, "approve", {});
    expect(a.json()).toMatchObject({ appliedNow: false, appliedAt: null });
    expect((await empRow(C2)).pension_scheme).toBe("UPS");
    expect(await feedScheme(addMonths(THIS_MONTH, 1), C2)).toBe("UPS");
    expect(await feedScheme(eff, C2)).toBe("NPS");

    await applyDuePensionSchemeChangesOnce(db, { asOf: `${addMonths(THIS_MONTH, 1)}-28` });
    expect((await empRow(C2)).pension_scheme).toBe("UPS"); // not due yet
    await applyDuePensionSchemeChangesOnce(db, { asOf: first(eff) });
    const after = await empRow(C2);
    expect(after.pension_scheme).toBe("NPS");
    await applyDuePensionSchemeChangesOnce(db, { asOf: first(eff) });
    expect((await empRow(C2)).version).toBe(after.version); // applied once
    expect((await audits(C2)).filter((x) => x.action === "pension_scheme_change_apply")).toHaveLength(1);
  });
});

describe("D1: reject, exited employee, history", () => {
  it("the checker rejects with a note (the maker cannot); nothing changes", async () => {
    const r = await request(C3, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: "Requested by mistake for this employee" });
    expect(r.statusCode).toBe(201);
    expect((await decide(r.json().id, "reject", { note: "Not eligible" }, maker)).statusCode).toBe(403);
    expect((await decide(r.json().id, "reject", {})).statusCode).toBe(400);
    const rej = await decide(r.json().id, "reject", { note: "Contract staff stay on EPF" });
    expect(rej.statusCode).toBe(200);
    expect(rej.json()).toMatchObject({ status: "rejected", decisionNote: "Contract staff stay on EPF" });
    expect((await empRow(C3)).pension_scheme).toBe("NPS");
  });

  it("an exited employee cannot be changed", async () => {
    const r = await request(C4, { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: REASON, uanNumber: "100200300404" });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("EMPLOYEE_EXITED");
  });

  it("history and the pending queue are listed", async () => {
    const hist = await app.inject({ method: "GET", url: `/v1/hrms/employees/${C2}/pension-scheme-changes`, headers: maker });
    expect(hist.statusCode).toBe(200);
    expect(hist.json().data.map((d: { toScheme: string }) => d.toScheme)).toEqual(["NPS", "UPS"]);
    const q = await app.inject({ method: "GET", url: "/v1/hrms/pension-scheme-changes?status=pending", headers: checker });
    expect(q.json().data).toEqual([]);
  });
});

describe("D1 / D3: scheme at hire by rule, incomplete without a UAN, not editable on PATCH", () => {
  const create = (employeeNo: string, extra: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/hrms/employees", headers: maker,
    payload: { employeeNo, fullName: `New ${employeeNo}`, departmentId: DEPT, designationId: DESIG, ...extra } });
  const schemeOf = async (employeeNo: string) => ((await asTenant((tx) => tx.execute(sql`SELECT id, pension_scheme FROM employee.hrms_employees WHERE tenant_id = ${TENANT}::uuid AND employee_no = ${employeeNo}`))) as unknown as Array<{ id: string; pension_scheme: string }>)[0]!;

  it("contract -> EPF, joined before 2004 -> GPF, otherwise NPS, explicit UPS kept", async () => {
    for (const [no, extra] of [
      ["B18-N1", { dateOfJoining: "2026-10-28", employeeType: "contract" }],
      ["B18-N2", { dateOfJoining: "2003-05-01", employeeType: "permanent" }],
      ["B18-N3", { dateOfJoining: "2026-10-28", employeeType: "permanent" }],
      ["B18-N4", { dateOfJoining: "2026-10-28", employeeType: "permanent", pensionScheme: "UPS" }],
    ] as const) {
      const r = await create(no, extra);
      expect(r.statusCode).toBe(202);
    }
    expect((await schemeOf("B18-N1")).pension_scheme).toBe("EPF");
    expect((await schemeOf("B18-N2")).pension_scheme).toBe("GPF");
    expect((await schemeOf("B18-N3")).pension_scheme).toBe("NPS");
    expect((await schemeOf("B18-N4")).pension_scheme).toBe("UPS");
  });

  it("an EPF member without a UAN is reported incomplete on the employee record", async () => {
    const { id } = await schemeOf("B18-N1");
    const d = await app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: maker });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({ pensionScheme: "EPF", statutoryIncomplete: ["UAN_MISSING"] });
  });

  it("PATCH cannot change the scheme, and rejects a malformed UAN", async () => {
    const { id } = await schemeOf("B18-N3");
    expect((await app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}`, headers: maker, payload: { pensionScheme: "EPF" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}`, headers: maker, payload: { uanNumber: "1234", reason: "Recording the member UAN" } })).statusCode).toBe(400);
  });
});

describe("Review SF5: eligibility matrix and super_admin override", () => {
  const superH = h(SUPER, ["super_admin"]);
  it("contract staff can only be EPF: NPS is refused with 422 PENSION_SCHEME_NOT_ALLOWED", async () => {
    const r = await request(C1, { toScheme: "NPS", effectiveFrom: first(addMonths(THIS_MONTH, 1)), reason: "Wrongly asked for NPS here" });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PENSION_SCHEME_NOT_ALLOWED");
    expect(r.json().message).toContain("contract and PSU staff are EPF members only");
  });

  it("outside the matrix: an override by hr_admin is refused (403); a super_admin override is recorded, approved and audited", async () => {
    const body = { toScheme: "EPF", effectiveFrom: first(addMonths(THIS_MONTH, 1)), reason: "Posted to a PSU under EPF", uanNumber: "100200300406" };
    expect((await request(R1, body)).json().code).toBe("PENSION_SCHEME_NOT_ALLOWED");
    const override = { ...body, overrideReason: "Deputation to PSU XYZ under order 12/2026 dated 01-11-2026" };
    const byHr = await request(R1, override);
    expect(byHr.statusCode).toBe(403);
    expect(byHr.json().code).toBe("PENSION_SCHEME_OVERRIDE_FORBIDDEN");
    const bySuper = await request(R1, override, superH);
    expect(bySuper.statusCode).toBe(201);
    expect(bySuper.json().overrideReason).toBe(override.overrideReason);
    const a = await decide(bySuper.json().id, "approve", {});
    expect(a.statusCode).toBe(200);
    const last = (await audits(R1)).pop()!;
    expect(last).toMatchObject({ action: "pension_scheme_change", detail: { overrideReason: override.overrideReason } });
  });

  it("NPS -> UPS once; the one-time switch back UPS -> NPS once; a second UPS option is refused", async () => {
    const step = async (to: string, n: number) => {
      const r = await request(R2, { toScheme: to, effectiveFrom: first(addMonths(THIS_MONTH, n)), reason: `UPS option step ${n} for this test` });
      if (r.statusCode === 201) expect((await decide(r.json().id, "approve", {})).statusCode).toBe(200);
      return r;
    };
    expect((await step("UPS", 1)).statusCode).toBe(201);
    expect((await step("NPS", 2)).statusCode).toBe(201);
    const again = await step("UPS", 3);
    expect(again.statusCode).toBe(422);
    expect(again.json().message).toContain("already been exercised");
  });
});

describe("Review SF1: EPF membership facts through the change flow", () => {
  it("EPF -> EPF with only the membership facts is a membership request; on approval the joint option reaches payroll-input", async () => {
    const eff = first(addMonths(THIS_MONTH, 1));
    expect((await request(C1, { toScheme: "EPF", effectiveFrom: eff, reason: "Nothing changes in this request" })).json().code).toBe("PENSION_SCHEME_UNCHANGED");
    const r = await request(C1, { toScheme: "EPF", effectiveFrom: eff, reason: "Para 26(6) joint option on joining (owner 2026-11-05)", epfVoluntaryJointOption: true, epfFirstJoinedOn: "2026-10-28" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: "membership", fromScheme: "EPF", toScheme: "EPF", epfVoluntaryJointOption: true });
    expect((await decide(r.json().id, "approve", {})).statusCode).toBe(200);
    const row = await asTenant((tx) => tx.execute(sql`SELECT epf_voluntary_joint_option AS vjo, epf_first_joined_on::text AS first FROM employee.hrms_employees WHERE id = ${C1}::uuid`)) as unknown as Array<{ vjo: boolean; first: string }>;
    expect(row[0]).toEqual({ vjo: true, first: "2026-10-28" });
    const feed = await app.inject({ method: "GET", url: `/v1/hrms/internal/payroll-input?month=${THIS_MONTH}`, headers: h(MAKER, ["payroll_admin"]) });
    const c1 = (feed.json() as { employees: Array<{ id: string; epf: unknown; pensionScheme: string }> }).employees.find((e) => e.id === C1)!;
    expect(c1.epf).toEqual({ firstJoinedOn: "2026-10-28", voluntaryJointOption: true, epsMember: null, joiningWageMinor: null, ageCutoffReached: null });
    expect(c1).not.toHaveProperty("dateOfBirth");
    expect(c1.pensionScheme).toBe("EPF");
  });

  it("membership facts are only accepted for EPF", async () => {
    expect((await request(R2, { toScheme: "UPS", effectiveFrom: first(addMonths(THIS_MONTH, 6)), reason: "Not an EPF member at all", epsMember: true })).statusCode).toBe(400);
  });
});

describe("Review SF8: concurrency and tenant isolation", () => {
  it("two concurrent requests for the same employee: exactly one is filed, the other gets 409", async () => {
    const body = { toScheme: "EPF", effectiveFrom: first(THIS_MONTH), reason: "Contract staff are EPF members (race test)" };
    const [a, b] = await Promise.all([request(R3, body), request(R3, body, h(randomUUID(), ["hr_officer"]))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const pending = await asTenant((tx) => tx.execute(sql`SELECT count(*)::int AS n FROM employee.hrms_pension_scheme_changes WHERE employee_id = ${R3}::uuid AND status = ${"pending"}`)) as unknown as Array<{ n: number }>;
    expect(pending[0]!.n).toBe(1);
  });

  it("another tenant cannot see, request on, approve or reject this tenant's employees and changes (404 / empty)", async () => {
    const other = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), tid: OTHER_TENANT, roles, sid: "b18x" }, SECRET)}` });
    const pending = (await app.inject({ method: "GET", url: "/v1/hrms/pension-scheme-changes?status=pending", headers: checker })).json().data[0];
    expect(pending).toBeDefined();
    expect((await app.inject({ method: "POST", url: `/v1/hrms/pension-scheme-changes/${pending.id}/approve`, headers: other(["hr_admin"]), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/pension-scheme-changes/${pending.id}/reject`, headers: other(["hr_admin"]), payload: { note: "cross tenant" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/hrms/employees/${C2}/pension-scheme-changes`, headers: other(["hr_admin"]),
      payload: { toScheme: "NPS", effectiveFrom: first(addMonths(THIS_MONTH, 9)), reason: "Cross-tenant attempt" } })).statusCode).toBe(404);
    const hist = await app.inject({ method: "GET", url: `/v1/hrms/employees/${C2}/pension-scheme-changes`, headers: other(["hr_admin"]) });
    expect(hist.json().data).toEqual([]);
  });
});

describe("Review SF9 / SF6: regime-only feed; no scheme for apprentices and consultants", () => {
  it("GET /internal/tax-regimes carries ids, numbers and regimes only -- no PAN, bank or pay", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/internal/tax-regimes", headers: h(MAKER, ["payroll_admin"]) });
    expect(r.statusCode).toBe(200);
    const rows = r.json().employees as Array<Record<string, unknown>>;
    expect(rows.find((e) => e.id === C2)).toEqual({ id: C2, employeeNo: "B18-C2", departmentId: DEPT, taxRegime: "new", eligibleForPayroll: true, paymentRoute: "payroll" });
    expect(rows.some((e) => e.id === C4)).toBe(false); // separated employees are not in payroll
    for (const e of rows) for (const k of ["pan", "bankAccountNo", "bankIfsc", "basicMinor", "uan", "fullName"]) expect(e).not.toHaveProperty(k);
    expect((await app.inject({ method: "GET", url: "/v1/hrms/internal/tax-regimes", headers: h(MAKER, ["employee"]) })).statusCode).toBe(403);
  });

  it("an apprentice and a consultant are hired on NONE, and no scheme change is open to them", async () => {
    for (const [no, type] of [["B18-AP1", "apprentice"], ["B18-CO1", "consultant"]] as const) {
      const c = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: maker,
        payload: { employeeNo: no, fullName: `New ${no}`, departmentId: DEPT, designationId: DESIG, dateOfJoining: "2026-10-28", employeeType: type } });
      expect(c.statusCode).toBe(202);
      const row = ((await asTenant((tx) => tx.execute(sql`SELECT id, pension_scheme FROM employee.hrms_employees WHERE tenant_id = ${TENANT}::uuid AND employee_no = ${no}`))) as unknown as Array<{ id: string; pension_scheme: string }>)[0]!;
      expect(row.pension_scheme).toBe("NONE");
      const r = await request(row.id, { toScheme: "NPS", effectiveFrom: first(THIS_MONTH), reason: "Should not be possible at all" });
      expect(r.statusCode).toBe(422);
      expect(r.json().code).toBe("PENSION_SCHEME_NOT_ALLOWED");
    }
  });
});

describe("Delta review: joining wage stamped once, per-month age cutoff, apprentices to NONE", () => {
  it("the EPF joining wage is recorded once through a membership request and then reaches payroll-input; a different later value is refused", async () => {
    const eff = first(addMonths(THIS_MONTH, 2));
    const r = await request(C1, { toScheme: "EPF", effectiveFrom: eff, reason: "Joining wage at EPF enrolment (Basic + DA)", epfJoiningWageMinor: 2_844_000 });
    expect(r.statusCode).toBe(201);
    expect(r.json().epfJoiningWageMinor).toBe("2844000");
    expect((await decide(r.json().id, "approve", {})).statusCode).toBe(200);
    const feed = await app.inject({ method: "GET", url: `/v1/hrms/internal/payroll-input?month=${THIS_MONTH}`, headers: h(MAKER, ["payroll_admin"]) });
    const c1 = (feed.json() as { employees: Array<{ id: string; epf: Record<string, unknown> }> }).employees.find((e) => e.id === C1)!;
    expect(c1.epf.joiningWageMinor).toBe("2844000");
    const again = await request(C1, { toScheme: "EPF", effectiveFrom: first(addMonths(THIS_MONTH, 3)), reason: "Trying to change the joining wage", epfJoiningWageMinor: 1_200_000 });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("EPF_JOINING_WAGE_RECORDED");
  });

  it("payroll-input carries a per-month age cutoff boolean, never the DOB", async () => {
    await asTenant((tx) => tx.execute(sql`UPDATE employee.hrms_employees SET date_of_birth = ${"1969-03-10"} WHERE id = ${R1}::uuid`));
    const at = async (month: string) => ((await app.inject({ method: "GET", url: `/v1/hrms/internal/payroll-input?month=${month}`, headers: h(MAKER, ["payroll_admin"]) }))
      .json() as { employees: Array<{ id: string; epf: { ageCutoffReached: boolean | null } }> }).employees.find((e) => e.id === R1)!;
    expect((await at("2027-03")).epf.ageCutoffReached).toBe(false);
    const after = await at("2027-04");
    expect(after.epf.ageCutoffReached).toBe(true);
    expect(JSON.stringify(after)).not.toContain("1969");
  });

  it("an existing apprentice on NPS moves to NONE through the normal maker-checker (no override)", async () => {
    const r = await request(AP2, { toScheme: "NONE", effectiveFrom: first(THIS_MONTH), reason: "Apprentices are on no pension scheme" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ fromScheme: "NPS", toScheme: "NONE", overrideReason: null });
    expect((await decide(r.json().id, "approve", {})).statusCode).toBe(200);
    expect((await empRow(AP2)).pension_scheme).toBe("NONE");
    expect(await feedScheme(THIS_MONTH, AP2)).toBe("NONE");
  });
});
