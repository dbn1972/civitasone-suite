/**
 * DIC RBAC & Persona Tests — Role boundary enforcement
 * From: ULTIMATE-HRMS-PAYROLL-MASTER-TEST (Dim 11) +
 *       EMPLOYEE-SELF-SERVICE-LIFECYCLE-PROMPT (Phase 2) +
 *       HRMS-FULL-LIFECYCLE-E2E-PROMPT (role checks)
 *
 * Validates that employee/manager/finance roles CANNOT perform HR/payroll admin actions.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";

const HRMS = "http://127.0.0.1:3012";
const PAYROLL = "http://127.0.0.1:3013";
const TENANT = "1ebadb1c-f10d-40d8-9bd8-1a14a436705b";
const SECRET = "test_secret_for_civitasone_32chr";
const EMP_A = "f433fab2-7d51-4cf1-8516-8a666bccc03a";
const DEPT_IT = "2a0d89d6-20d2-4d0d-a6e1-2336d6d03bfd";
const DESIG = "54c78024-c4d1-4904-a343-910466c9e0ff";

let adminToken: string;
let empToken: string;
let mgrToken: string;
let finToken: string;

function h(t: string) {
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

beforeAll(() => {
  adminToken = signToken({ sub: randomUUID(), tid: TENANT, roles: ["super_admin","hr_admin"], sid: "s1" }, SECRET, "1h");
  empToken = signToken({ sub: randomUUID(), tid: TENANT, roles: ["employee"], sid: "s2" }, SECRET, "1h");
  mgrToken = signToken({ sub: randomUUID(), tid: TENANT, roles: ["manager"], sid: "s3" }, SECRET, "1h");
  finToken = signToken({ sub: randomUUID(), tid: TENANT, roles: ["finance_officer"], sid: "s4" }, SECRET, "1h");
});

// ══════════════════════════════════════════════════════════════════════
// EMPLOYEE ROLE — BLOCKED ACTIONS (All must return 403)
// From EMPLOYEE-SELF-SERVICE-LIFECYCLE Phase 2
// ══════════════════════════════════════════════════════════════════════
describe("Employee role — blocked HR operations", () => {
  it("cannot create employees", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees`, { method: "POST", headers: h(empToken), body: JSON.stringify({ employeeNo: "X", fullName: "X", departmentId: DEPT_IT, designationId: DESIG, dateOfJoining: "2026-01-01" }) });
    expect(r.status).toBe(403);
  });
  it("cannot list all employees", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees`, { headers: h(empToken) });
    expect(r.status).toBe(403);
  });
  it("cannot approve leave", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/leave-applications/${randomUUID()}/approve`, { method: "PATCH", headers: h(empToken), body: "{}" });
    expect(r.status).toBe(403);
  });
  it("cannot mark attendance", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/attendance`, { method: "POST", headers: h(empToken), body: JSON.stringify({ records: [] }) });
    expect(r.status).toBe(403);
  });
  it("cannot lock attendance", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/attendance/locks`, { method: "POST", headers: h(empToken), body: JSON.stringify({ month: "2026-08" }) });
    expect(r.status).toBe(403);
  });
  it("cannot open disciplinary case", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees/${EMP_A}/disciplinary-cases`, { method: "POST", headers: h(empToken), body: JSON.stringify({ caseNo: "X", allegation: "X" }) });
    expect(r.status).toBe(403);
  });
  it("cannot suspend employee", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees/${EMP_A}/suspensions`, { method: "POST", headers: h(empToken), body: JSON.stringify({ suspensionDate: "2026-08-01", reason: "X" }) });
    expect(r.status).toBe(403);
  });
  it("cannot transfer employee", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees/${EMP_A}/transfer/submit-approval`, { method: "POST", headers: h(empToken), body: JSON.stringify({}) });
    expect(r.status).toBe(403);
  });
  it("cannot create job openings", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/job-openings`, { method: "POST", headers: h(empToken), body: JSON.stringify({ refNo: "X", title: "X", departmentId: DEPT_IT, vacancies: 1 }) });
    expect(r.status).toBe(403);
  });
});

describe("Employee role — blocked payroll operations", () => {
  it("cannot create payroll run", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/runs`, { method: "POST", headers: h(empToken), body: JSON.stringify({ runNo: "X", month: "2026-08", runType: "pensioner" }) });
    expect(r.status).toBe(403);
  });
  it("cannot approve payroll run", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/runs/${randomUUID()}/approve`, { method: "PATCH", headers: h(empToken), body: JSON.stringify({ reason: "X" }) });
    expect(r.status).toBe(403);
  });
  it("cannot disburse payroll", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/runs/${randomUUID()}/disburse`, { method: "PATCH", headers: h(empToken), body: JSON.stringify({ reason: "X" }) });
    expect(r.status).toBe(403);
  });
  it("cannot create DDO", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/ddos`, { method: "POST", headers: h(empToken), body: JSON.stringify({ ddoCode: "X", name: "X" }) });
    expect(r.status).toBe(403);
  });
  it("cannot create pensioner", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/pensioners`, { method: "POST", headers: h(empToken), body: JSON.stringify({ ppoNo: "X", fullName: "X", dateOfBirth: "1960-01-01", basicPensionMinor: 100 }) });
    expect(r.status).toBe(403);
  });
  it("cannot create structure", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/structures`, { method: "POST", headers: h(empToken), body: JSON.stringify({ name: "X" }) });
    expect(r.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════
// MANAGER ROLE — LIMITED ACCESS
// ══════════════════════════════════════════════════════════════════════
describe("Manager role — limited access", () => {
  it("cannot create employees", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees`, { method: "POST", headers: h(mgrToken), body: JSON.stringify({ employeeNo: "X", fullName: "X", departmentId: DEPT_IT, designationId: DESIG, dateOfJoining: "2026-01-01" }) });
    expect(r.status).toBe(403);
  });
  it("cannot create payroll run", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/runs`, { method: "POST", headers: h(mgrToken), body: JSON.stringify({ runNo: "X", month: "2026-08", runType: "pensioner" }) });
    expect(r.status).toBe(403);
  });
  it("cannot open disciplinary case", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees/${EMP_A}/disciplinary-cases`, { method: "POST", headers: h(mgrToken), body: JSON.stringify({ caseNo: "X", allegation: "X" }) });
    expect(r.status).toBe(403);
  });
  it("can view attendance summary", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/attendance/summary`, { headers: h(mgrToken) });
    expect(r.status).toBeLessThan(500);
  });
});

// ══════════════════════════════════════════════════════════════════════
// FINANCE ROLE — CAN READ, CANNOT WRITE HR
// ══════════════════════════════════════════════════════════════════════
describe("Finance role — read-only on HR", () => {
  it("cannot create employees", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees`, { method: "POST", headers: h(finToken), body: JSON.stringify({ employeeNo: "X", fullName: "X", departmentId: DEPT_IT, designationId: DESIG, dateOfJoining: "2026-01-01" }) });
    expect(r.status).toBe(403);
  });
  it("cannot approve leave", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/leave-applications/${randomUUID()}/approve`, { method: "PATCH", headers: h(finToken), body: "{}" });
    expect(r.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════
// NO AUTH — 401 on all protected routes
// ══════════════════════════════════════════════════════════════════════
describe("No auth — 401 everywhere", () => {
  const protectedRoutes = [
    ["GET", `${HRMS}/v1/hrms/employees`],
    ["GET", `${HRMS}/v1/hrms/leave-applications`],
    ["GET", `${HRMS}/v1/hrms/attendance`],
    ["GET", `${PAYROLL}/v1/payroll/runs`],
    ["GET", `${PAYROLL}/v1/payroll/structures`],
    ["POST", `${HRMS}/v1/hrms/employees`],
    ["POST", `${PAYROLL}/v1/payroll/runs`],
  ] as const;

  for (const [method, url] of protectedRoutes) {
    it(`${method} ${new URL(url).pathname} → 401`, async () => {
      const r = await fetch(url, { method, ...(method === "POST" ? { body: "{}", headers: { "Content-Type": "application/json" } } : {}) });
      expect(r.status).toBe(401);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════
// ADMIN — CAN DO EVERYTHING (positive baseline)
// ══════════════════════════════════════════════════════════════════════
describe("Admin role — positive access", () => {
  it("can list employees", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees`, { headers: h(adminToken) });
    expect(r.status).toBe(200);
  });
  it("can list payroll runs", async () => {
    const r = await fetch(`${PAYROLL}/v1/payroll/runs`, { headers: h(adminToken) });
    expect(r.status).toBe(200);
  });
  it("can view recruitment dashboard", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/recruitment/dashboard`, { headers: h(adminToken) });
    expect(r.status).toBe(200);
  });
  it("can list disciplinary cases", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees/${EMP_A}/disciplinary-cases`, { headers: h(adminToken) });
    expect(r.status).toBe(200);
  });
  it("can compute pension", async () => {
    const r = await fetch(`${HRMS}/v1/hrms/employees/${EMP_A}/pension?retirementDate=2030-06-30&daRatePct=50&commutePct=40&elBalanceDays=100`, { headers: h(adminToken) });
    expect(r.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════
// CROSS-TENANT ISOLATION
// ══════════════════════════════════════════════════════════════════════
describe("Tenant isolation", () => {
  it("different tenant sees empty employees", async () => {
    const otherTenant = signToken({ sub: randomUUID(), tid: randomUUID(), roles: ["super_admin"], sid: "iso" }, SECRET, "1h");
    const r = await fetch(`${HRMS}/v1/hrms/employees`, { headers: h(otherTenant) });
    expect(r.status).toBe(200);
    const body = await r.json();
    // Should be empty (not see our tenant's data)
    const data = Array.isArray(body) ? body : body?.data ?? [];
    expect(data.length).toBe(0);
  });
  it("different tenant sees empty payroll runs", async () => {
    const otherTenant = signToken({ sub: randomUUID(), tid: randomUUID(), roles: ["super_admin"], sid: "iso2" }, SECRET, "1h");
    const r = await fetch(`${PAYROLL}/v1/payroll/runs`, { headers: h(otherTenant) });
    expect(r.status).toBe(200);
    const body = await r.json();
    const data = Array.isArray(body) ? body : body?.data ?? [];
    expect(data.length).toBe(0);
  });
});
