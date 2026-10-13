/**
 * GAP-HR-SF-17a: attendance / regularisation / shift-request / WFH-request /
 * appraisal / leave-application lists resolve person names in-process with one
 * batched, tenant-scoped lookup per page. They used to look names up in an
 * unordered `employeeRepo.listByTenant(tenant, 500, 0)` window, so any
 * employee outside it came back as an 8-hex id fragment.
 *
 * Real DB, FORCE RLS. Seeds 520 employees (more than the old 500-row window)
 * and asserts EVERY row carries the real name, plus that a row pointing at
 * another tenant's employee id resolves to "Unknown employee" (no cross-tenant
 * name leak) and that the response matches the typed zod schemas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { ShiftRequestListResponseSchema, WfhRequestListResponseSchema } from "@civitasone/schemas/web";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "beef0000-0000-4000-8000-0000000017a1";
const OTHER = "beef0000-0000-4000-8000-0000000017b2";
const ACTOR = "beef0000-0000-4000-8000-0000000017a0";
const DEPT = "beef0000-0000-4000-8000-0000000017da";
const DEPT_O = "beef0000-0000-4000-8000-0000000017db";
const DESIG = "beef0000-0000-4000-8000-0000000017d1";
const DESIG_O = "beef0000-0000-4000-8000-0000000017d2";
const FOREIGN_EMP = "beef0000-0000-4000-8000-0000000017e0";
const N = 520;

const hrToken = signToken({ sub: "sf17a-hr", tid: TENANT, roles: ["hr_admin"], sid: "s17a" }, SECRET);
const auth = { authorization: `Bearer ${hrToken}` };
let app: Awaited<ReturnType<typeof buildApp>>;

const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);
const nameOf = (i: number) => `Sf17a Person ${String(i).padStart(4, "0")}`;
const empId = (i: number) => `beef0000-0000-4000-9000-${String(i).padStart(12, "0")}`;

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await asT(t, (tx) => tx`DELETE FROM attendance.hrms_shift_change_requests WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM attendance.hrms_wfh_requests WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM attendance.hrms_attendance_regularisations WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM attendance.hrms_attendance WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
  }
}

beforeAll(async () => {
  await cleanup();
  for (const [t, d, g, dn, gn] of [[TENANT, DEPT, DESIG, "Revenue Dept 17a", "Clerk 17a"], [OTHER, DEPT_O, DESIG_O, "Other Dept", "Other Desig"]] as const) {
    await asT(t, (tx) => tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${d}, ${t}, 'S17', ${dn}, ${ACTOR}, ${ACTOR})`);
    await asT(t, (tx) => tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${g}, ${t}, 'S17', ${gn}, ${ACTOR}, ${ACTOR})`);
  }
  await asT(OTHER, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${FOREIGN_EMP}, ${OTHER}, 'S17-F', 'Foreign Tenant Person', ${DEPT_O}, ${DESIG_O}, '2015-01-01', ${ACTOR}, ${ACTOR})`);
  await asT(TENANT, async (tx) => {
    await tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      SELECT ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, ${TENANT}, 'S17-' || g,
             'Sf17a Person ' || lpad(g::text, 4, '0'), ${DEPT}, ${DESIG}, '2015-01-01', ${ACTOR}, ${ACTOR}
      FROM generate_series(1, ${N}) g`;
    await tx`
      INSERT INTO attendance.hrms_attendance (tenant_id, employee_id, attendance_date, status, created_by, updated_by)
      SELECT ${TENANT}, ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '2026-05-04', 'present', ${ACTOR}, ${ACTOR}
      FROM generate_series(21, ${N}) g`;
    await tx`
      INSERT INTO attendance.hrms_attendance_regularisations (tenant_id, employee_id, date, reason, created_by, updated_by)
      SELECT ${TENANT}, ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '2026-05-04', 'missed punch', ${ACTOR}, ${ACTOR}
      FROM generate_series(1, ${N}) g`;
    await tx`
      INSERT INTO attendance.hrms_shift_change_requests (tenant_id, employee_id, current_shift, requested_shift, effective_date, status, approved_by, created_at)
      SELECT ${TENANT}, ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, 'GEN', 'NIGHT', '2026-06-01', 'pending',
             ('beef0000-0000-4000-9000-' || lpad('1', 12, '0'))::uuid, now() - ((${N} - g) || ' seconds')::interval
      FROM generate_series(1, ${N}) g`;
    await tx`
      INSERT INTO attendance.hrms_wfh_requests (tenant_id, employee_id, from_date, to_date, status, created_at)
      SELECT ${TENANT}, ('beef0000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '2026-06-01', '2026-06-02', 'pending', now() - ((${N} - g) || ' seconds')::interval
      FROM generate_series(1, ${N}) g`;
    // A row in THIS tenant that points at another tenant's employee id.
    await tx`
      INSERT INTO attendance.hrms_shift_change_requests (tenant_id, employee_id, current_shift, requested_shift, effective_date, status, created_at)
      VALUES (${TENANT}, ${FOREIGN_EMP}, 'GEN', 'NIGHT', '2026-06-01', 'pending', now() + interval '1 hour')`;
  });
  app = await buildApp();
  await app.ready();
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
}, 60_000);

const looksLikeIdFragment = (s: string) => /^[0-9a-f]{8}$/.test(s) || /^[0-9a-f-]{36}$/.test(s);

describe("GAP-HR-SF-17a name enrichment beyond the old 500-row window", () => {
  it("GET /attendance names every row (520 employees) and resolves department", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance?limit=500", headers: auth });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ employeeId: string; employeeName: string; department: string }>;
    expect(rows).toHaveLength(500);
    for (const r of rows) {
      expect(r.employeeName).toMatch(/^Sf17a Person \d{4}$/);
      expect(looksLikeIdFragment(r.employeeName)).toBe(false);
      expect(r.department).toBe("Revenue Dept 17a");
    }
  });

  it("GET /attendance/regularisations names every row", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance/regularisations?limit=500", headers: auth });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ employeeId: string; employeeName: string }>;
    expect(rows).toHaveLength(500);
    for (const r of rows) {
      const i = Number(r.employeeId.slice(-12));
      expect(r.employeeName).toBe(nameOf(i));
    }
  });

  it("GET /shift-requests names employees and approver, matches the typed schema, and does not leak a foreign tenant name", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/shift-requests", headers: auth });
    expect(res.statusCode).toBe(200);
    const parsed = ShiftRequestListResponseSchema.parse(res.json());
    expect(parsed.data).toHaveLength(200);
    const foreign = parsed.data.find((r) => r.employeeId === FOREIGN_EMP);
    expect(foreign?.employeeName).toBe("Unknown employee");
    expect(JSON.stringify(res.json())).not.toContain("Foreign Tenant Person");
    for (const r of parsed.data.filter((x) => x.employeeId !== FOREIGN_EMP)) {
      expect(r.employeeName).toBe(nameOf(Number(r.employeeId.slice(-12))));
      expect(r.approverName).toBe(nameOf(1));
    }
  });

  it("GET /wfh-requests names every employee and matches the typed schema", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/wfh-requests", headers: auth });
    expect(res.statusCode).toBe(200);
    const parsed = WfhRequestListResponseSchema.parse(res.json());
    expect(parsed.data).toHaveLength(200);
    for (const r of parsed.data) {
      expect(r.employeeName).toBe(nameOf(Number(r.employeeId.slice(-12))));
      expect(r.approverName).toBeNull();
    }
  });

  it("is tenant-scoped: another tenant's token sees none of this tenant's rows or names", async () => {
    const otherToken = signToken({ sub: "sf17a-other", tid: OTHER, roles: ["hr_admin"], sid: "s17b" }, SECRET);
    for (const url of ["/v1/hrms/attendance", "/v1/hrms/shift-requests", "/v1/hrms/wfh-requests", "/v1/hrms/attendance/regularisations"]) {
      const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${otherToken}` } });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("Sf17a Person");
    }
  });
});
