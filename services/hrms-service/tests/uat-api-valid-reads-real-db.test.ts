/**
 * UAT API sweep 2026-10-29: valid reads that answered 5xx because the SQL referenced tables / columns that
 * do not exist. Each case seeds real rows (RLS included) and asserts a 200 with the real data:
 *  - GET  /v1/hrms/devices/admin     joined employee.hrms_employees on a non-existent user_id / first_name ...
 *  - GET  /v1/hrms/learning-paths    joined employee.role_requirements (never existed) + int math on a varchar level
 *  - POST /v1/hrms/ai/chat           read hrms.leave_allocations / hrms.holidays (never existed) + e.user_id
 *  - POST /v1/hrms/assistant         same three queries
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e7c0000-0000-4000-8000-0000000000b2";
const USER = "5e7cacc0-0000-4000-8000-0000000000b2";
const MGR_USER = "5e7cacc0-0000-4000-8000-0000000000b3";
const DEPT = "5e7c0002-0000-4000-8000-0000000000d1";
const DESIG = "5e7c0002-0000-4000-8000-0000000000d2";
const EMP = "5e7c0002-0000-4000-8000-0000000000e1";
const MGR = "5e7c0002-0000-4000-8000-0000000000e2";
const LTYPE = "5e7c0002-0000-4000-8000-0000000000f1";
const COMP = "5e7c0002-0000-4000-8000-0000000000f2";
const headers = {
  authorization: `Bearer ${signToken({ sub: USER, tid: T, roles: ["super_admin", "hr_admin", "employee"], sid: "sess-valid" }, SECRET, 3600)}`,
};

const asTenant = <R>(fn: (tx: typeof sqlClient) => Promise<R>) => withRawTenantGuc(sqlClient, T, fn);
let app: FastifyInstance;

async function cleanup(): Promise<void> {
  await asTenant(async (tx) => {
    await tx`DELETE FROM hrms.trusted_devices WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.skill_assessments WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.role_competency_map WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.competencies WHERE tenant_id = ${T}`;
    await tx`DELETE FROM leave.hrms_leave_allocs WHERE tenant_id = ${T}`;
    await tx`DELETE FROM leave.hrms_leave_types WHERE tenant_id = ${T}`;
    await tx`DELETE FROM leave.hrms_holidays WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${T}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${T}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await asTenant(async (tx) => {
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by) VALUES (${DEPT}, ${T}, 'UAT', 'UAT Dept', ${USER}, ${USER})`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by) VALUES (${DESIG}, ${T}, 'DD', 'Deputy Director', ${USER}, ${USER})`;
    await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, email, status, user_ref, created_by, updated_by)
             VALUES (${MGR}, ${T}, 'UAT-M1', 'Mira Manager', ${DEPT}, ${DESIG}, '2020-01-01', 'mira@example.gov.in', 'confirmed', ${MGR_USER}, ${USER}, ${USER})`;
    await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, email, status, user_ref, manager_id, created_by, updated_by)
             VALUES (${EMP}, ${T}, 'UAT-E1', 'Asha Employee', ${DEPT}, ${DESIG}, '2022-01-01', 'asha@example.gov.in', 'confirmed', ${USER}, ${MGR}, ${USER}, ${USER})`;
    await tx`INSERT INTO hrms.trusted_devices (id, tenant_id, user_id, device_id, device_name, platform) VALUES (gen_random_uuid(), ${T}, ${USER}, 'dev-1', 'Pixel 9', 'android')`;
    await tx`INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES (${LTYPE}, ${T}, 'CL', 'Casual Leave', ${USER}, ${USER})`;
    await tx`INSERT INTO leave.hrms_leave_allocs (tenant_id, employee_id, leave_type_id, fy, total_days, balance_days, created_by, updated_by) VALUES (${T}, ${EMP}, ${LTYPE}, '2026-27', 12, 9, ${USER}, ${USER})`;
    await tx`INSERT INTO leave.hrms_holidays (tenant_id, name, date, type, created_by) VALUES (${T}, 'UAT Test Day', (CURRENT_DATE + 3), 'gazetted', ${USER})`;
    // beginner < intermediate < advanced < expert (employee.competencies.proficiency_levels default order)
    await tx`INSERT INTO employee.competencies (id, tenant_id, name, category, created_by) VALUES (${COMP}, ${T}, 'Data Literacy', 'technical', ${USER})`;
    await tx`INSERT INTO employee.role_competency_map (tenant_id, role_ref, competency_id, required_level) VALUES (${T}, 'Deputy Director', ${COMP}, 'advanced')`;
    await tx`INSERT INTO employee.skill_assessments (tenant_id, employee_id, competency_id, assessed_level, assessed_by) VALUES (${T}, ${EMP}, ${COMP}, 'beginner', ${USER})`;
  });
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("GET /v1/hrms/devices/admin", () => {
  it("lists devices joined to the employee by user_ref (200)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/devices/admin", headers });
    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((d: { deviceId: string }) => d.deviceId === "dev-1");
    expect(row).toMatchObject({ employeeName: "Asha Employee", employeeCode: "UAT-E1", department: "UAT Dept" });
  });
  it("search filters by the employee full name", async () => {
    const hit = await app.inject({ method: "GET", url: "/v1/hrms/devices/admin?search=Asha", headers });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().data).toHaveLength(1);
    const miss = await app.inject({ method: "GET", url: "/v1/hrms/devices/admin?search=Nobody", headers });
    expect(miss.json().data).toHaveLength(0);
  });
});

describe("GET /v1/hrms/learning-paths", () => {
  it("computes the competency gap from role_competency_map vs the assessed level (200)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning-paths?employeeId=${EMP}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      expect.objectContaining({ skillGap: "Data Literacy", gapPoints: 2, priority: "medium", currentLevel: 1, requiredLevel: 3 }),
    ]);
  });
  it("answers 200 with no gaps for an employee who meets the requirement", async () => {
    await asTenant((tx) => tx`UPDATE employee.skill_assessments SET assessed_level = 'expert' WHERE tenant_id = ${T}`);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/learning-paths?employeeId=${EMP}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
    await asTenant((tx) => tx`UPDATE employee.skill_assessments SET assessed_level = 'beginner' WHERE tenant_id = ${T}`);
  });
});

describe("POST /v1/hrms/ai/chat", () => {
  const chat = (message: string) => app.inject({ method: "POST", url: "/v1/hrms/ai/chat", headers, payload: { message } });
  it("leave balance reads leave.hrms_leave_allocs (200)", async () => {
    const res = await chat("what is my leave balance");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.response?.text ?? JSON.stringify(res.json())).toContain("Casual Leave");
  });
  it("next holiday reads leave.hrms_holidays (200)", async () => {
    const res = await chat("when is the next holiday");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain("UAT Test Day");
  });
  it("reporting manager resolves through user_ref / manager_id (200)", async () => {
    const res = await chat("who is my manager");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain("Mira Manager");
  });
});

describe("POST /v1/hrms/assistant", () => {
  const ask = (message: string) => app.inject({ method: "POST", url: "/v1/hrms/assistant", headers, payload: { message } });
  it("leave balance (200)", async () => {
    const res = await ask("how much leave balance do I have");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain("Casual Leave");
  });
  it("next holiday (200)", async () => {
    const res = await ask("next holiday please");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain("UAT Test Day");
  });
  it("reporting manager (200)", async () => {
    const res = await ask("who is my manager");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain("Mira Manager");
  });
});
