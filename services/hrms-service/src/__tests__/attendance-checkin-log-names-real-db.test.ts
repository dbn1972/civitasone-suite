/**
 * GET /v1/hrms/attendance/checkin-log — employee/department resolution and
 * ordering (real DB, no mocks).
 *
 * GAP-HR-CHECKIN-LOG-02 (display half — the scoping/IDOR half was already
 * closed by resolveSelfScopedEmployeeId, proven by
 * attendance-manager-scope-real-db.test.ts). repo.listCheckinLog used to
 * return a raw 8-char employeeId slice as "employee" and a permanently
 * blank "department"; queries.listCheckinLog (new) resolves both via the
 * shared batchEmployees/batchDepartments helpers.
 *
 * GAP-HR-CHECKIN-LOG-04: added a stable (date, inTime) DESC ordering —
 * previously no ORDER BY at all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees, hrmsDepartments } from "../modules/employee/schema.js";
import { hrmsAttendance } from "../modules/attendance/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const HR_SUB = "checkin-log-hr";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-checkin-log-test" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
let empId: string;
let deptId: string;

async function seedAttendance(date: string, inTime: string, source = "manual"): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsAttendance).values({
    id: randomUUID(), tenantId: TENANT, employeeId: empId, attendanceDate: date,
    inTime, outTime: null, source, status: "present",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
}

beforeAll(async () => {
  app = await buildApp();
  deptId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsDepartments).values({
    id: deptId, tenantId: TENANT, code: "CKL", name: "Checkin Log Test Dept",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
  empId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: empId, tenantId: TENANT, userRef: HR_SUB,
    employeeNo: "CKL-001", fullName: "Checkin Log Employee",
    departmentId: deptId, designationId: randomUUID(), dateOfJoining: "2020-01-15",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/attendance/checkin-log", () => {
  it("GAP-HR-CHECKIN-LOG-02: resolves a real employee name and department name, not a UUID slice / blank string", async () => {
    await seedAttendance("2026-04-01", "09:00");
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/checkin-log", headers: auth(HR_SUB, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.employeeId === empId);
    expect(row?.employee).toBe("Checkin Log Employee");
    expect(row?.department).toBe("Checkin Log Test Dept");
    expect(row?.employee).not.toBe(empId.slice(0, 8));
  });

  it("GAP-HR-CHECKIN-LOG-04: returns rows newest-date-first, stable across repeated calls", async () => {
    await seedAttendance("2026-04-05", "09:00");
    await seedAttendance("2026-04-03", "09:00");
    await seedAttendance("2026-04-07", "09:00");
    const r1 = await app.inject({ method: "GET", url: "/v1/hrms/attendance/checkin-log", headers: auth(HR_SUB, ["hr_admin"]) });
    const r2 = await app.inject({ method: "GET", url: "/v1/hrms/attendance/checkin-log", headers: auth(HR_SUB, ["hr_admin"]) });
    const dates1 = (r1.json().data as Array<{ date: string }>).map((x) => x.date);
    const dates2 = (r2.json().data as Array<{ date: string }>).map((x) => x.date);
    const sorted = [...dates1].sort().reverse();
    expect(dates1).toEqual(sorted);
    expect(dates1).toEqual(dates2);
  });

  it("the source field is named `source`, matching repo.ts (regression guard for GAP-HR-CHECKIN-LOG-01's backend half)", async () => {
    await seedAttendance("2026-04-10", "09:00", "regularisation");
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/checkin-log", headers: auth(HR_SUB, ["hr_admin"]) });
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.date === "2026-04-10");
    expect(row?.source).toBe("regularisation");
    expect(row).not.toHaveProperty("checkinSource");
  });
});
