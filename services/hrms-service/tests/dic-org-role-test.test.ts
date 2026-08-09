/**
 * Digital India Corporation — Synthetic organisation with Indian employees
 * testing role-based HRMS access across 6 personas.
 *
 * This test creates a real organisation structure and validates that each role
 * sees only what they should see and can only perform their permitted actions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = randomUUID(); // Digital India Corporation tenant

// ═══════════════════════════════════════════════════════════════════════
// Synthetic Indian Employees — Digital India Corporation
// ═══════════════════════════════════════════════════════════════════════

const ORG = {
  name: "Digital India Corporation",
  tenantId: TENANT,
  departments: {
    engineering: randomUUID(),
    hr: randomUUID(),
    finance: randomUUID(),
    admin: randomUUID(),
  },
};

const EMPLOYEES = {
  // CEO / Super Admin
  rajeshSharma: { id: randomUUID(), name: "Rajesh Sharma", designation: "CEO", dept: "admin", roles: ["super_admin", "tenant_admin"] },
  // HR Admin
  priyaVerma: { id: randomUUID(), name: "Priya Verma", designation: "HR Director", dept: "hr", roles: ["hr_admin"] },
  // HR Officer
  ankitMishra: { id: randomUUID(), name: "Ankit Mishra", designation: "HR Executive", dept: "hr", roles: ["hr_officer"] },
  // Manager (Engineering)
  deepakKumar: { id: randomUUID(), name: "Deepak Kumar", designation: "Engineering Manager", dept: "engineering", roles: ["manager"] },
  // Regular Employee
  meeraPatel: { id: randomUUID(), name: "Meera Patel", designation: "Software Engineer", dept: "engineering", roles: ["employee"] },
  // Payroll Admin
  sureshIyer: { id: randomUUID(), name: "Suresh Iyer", designation: "Payroll Officer", dept: "finance", roles: ["payroll_admin"] },
};

function tokenFor(emp: typeof EMPLOYEES.rajeshSharma): string {
  return signToken({ sub: emp.id, tid: TENANT, roles: emp.roles, sid: `sess-${emp.id.slice(0, 8)}` }, SECRET, 3600);
}

function headers(emp: typeof EMPLOYEES.rajeshSharma) {
  return { authorization: `Bearer ${tokenFor(emp)}`, "x-tenant-id": TENANT };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ═══════════════════════════════════════════════════════════════════════
// PART 1: Employee CRUD — who can create/view employees
// ═══════════════════════════════════════════════════════════════════════

describe("1. Employee Management — Role Access", () => {
  it("HR Admin (Priya) can create an employee", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees",
      headers: headers(EMPLOYEES.priyaVerma),
      payload: {
        fullName: "Kavita Reddy",
        employeeNo: "DIC-ENG-006",
        department: "Engineering",
        designation: "Junior Engineer",
        dateOfJoining: "2024-06-01",
        employeeType: "permanent",
        gender: "female",
      },
    });
    // 202 = accepted, 400 = validation (role IS authorized, body issue)
    expect([202, 400]).toContain(r.statusCode);
    expect(r.statusCode).not.toBe(403); // NOT forbidden
    expect(r.statusCode).not.toBe(401); // NOT unauthenticated
  });

  it("HR Officer (Ankit) can create an employee", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees",
      headers: headers(EMPLOYEES.ankitMishra),
      payload: {
        fullName: "Vikram Singh",
        employeeNo: "DIC-FIN-007",
        department: "Finance",
        designation: "Accounts Assistant",
        dateOfJoining: "2024-07-01",
        employeeType: "temporary",
        gender: "male",
      },
    });
    expect([202, 400]).toContain(r.statusCode);
    expect(r.statusCode).not.toBe(403);
    expect(r.statusCode).not.toBe(401);
  });

  it("Manager (Deepak) CANNOT create employees (403)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees",
      headers: headers(EMPLOYEES.deepakKumar),
      payload: { fullName: "Test", employeeNo: "X", department: "X", designation: "X", dateOfJoining: "2024-01-01", employeeType: "permanent" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("Employee (Meera) CANNOT create employees (403)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees",
      headers: headers(EMPLOYEES.meeraPatel),
      payload: { fullName: "Test", employeeNo: "X", department: "X", designation: "X", dateOfJoining: "2024-01-01", employeeType: "permanent" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("HR Admin (Priya) can list all employees", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/employees?limit=50", headers: headers(EMPLOYEES.priyaVerma) });
    expect(r.statusCode).toBe(200);
  });

  it("Manager (Deepak) can list employees (reader role)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/employees?limit=50", headers: headers(EMPLOYEES.deepakKumar) });
    expect(r.statusCode).toBe(200);
  });

  it("Employee (Meera) CANNOT list all employees (403)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/employees?limit=50", headers: headers(EMPLOYEES.meeraPatel) });
    expect(r.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 2: Leave Management — who can apply/approve
// ═══════════════════════════════════════════════════════════════════════

describe("2. Leave Management — Role Access", () => {
  it("Employee (Meera) can apply for leave", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/leave-applications",
      headers: headers(EMPLOYEES.meeraPatel),
      payload: {
        employeeId: EMPLOYEES.meeraPatel.id,
        leaveTypeId: randomUUID(),
        allocId: randomUUID(),
        fromDate: "2024-09-10",
        toDate: "2024-09-12",
        daysApplied: 3,
      },
    });
    // Should be 202 (accepted) or 404 (alloc not found) — NOT 403
    expect(r.statusCode).not.toBe(403);
  });

  it("Manager (Deepak) can apply for leave", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/leave-applications",
      headers: headers(EMPLOYEES.deepakKumar),
      payload: {
        employeeId: EMPLOYEES.deepakKumar.id,
        leaveTypeId: randomUUID(),
        allocId: randomUUID(),
        fromDate: "2024-09-15",
        toDate: "2024-09-15",
        daysApplied: 1,
      },
    });
    expect(r.statusCode).not.toBe(403);
  });

  it("HR Admin (Priya) can approve leave", async () => {
    const fakeLeaveId = randomUUID();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${fakeLeaveId}/approve`,
      headers: headers(EMPLOYEES.priyaVerma),
    });
    // Should be 202 or 404 (leave not found) — NOT 403
    expect(r.statusCode).not.toBe(403);
  });

  it("Employee (Meera) CANNOT approve leave (403)", async () => {
    const fakeLeaveId = randomUUID();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${fakeLeaveId}/approve`,
      headers: headers(EMPLOYEES.meeraPatel),
    });
    expect(r.statusCode).toBe(403);
  });

  it("Manager without HR role gets WORKFLOW_REQUIRED on direct approve", async () => {
    const fakeLeaveId = randomUUID();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/leave-applications/${fakeLeaveId}/approve`,
      headers: headers(EMPLOYEES.deepakKumar),
    });
    // Manager can access the route but gets WORKFLOW_REQUIRED (403)
    expect(r.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 3: Attendance — who can mark/view
// ═══════════════════════════════════════════════════════════════════════

describe("3. Attendance — Role Access", () => {
  it("HR Admin can mark attendance", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: headers(EMPLOYEES.priyaVerma),
      payload: { records: [{ employeeId: EMPLOYEES.meeraPatel.id, attendanceDate: "2024-09-01", status: "present" }] },
    });
    expect(r.statusCode).not.toBe(403);
  });

  it("Employee CANNOT mark attendance (403)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: headers(EMPLOYEES.meeraPatel),
      payload: { records: [{ employeeId: EMPLOYEES.meeraPatel.id, attendanceDate: "2024-09-01", status: "present" }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it("Manager can view attendance summary", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary", headers: headers(EMPLOYEES.deepakKumar) });
    expect(r.statusCode).toBe(200);
  });

  it("Employee CANNOT view attendance summary (403)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary", headers: headers(EMPLOYEES.meeraPatel) });
    expect(r.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PART 4: Unauthenticated access blocked
// ═══════════════════════════════════════════════════════════════════════

describe("4. No Auth — All routes reject", () => {
  const routes = [
    "GET /v1/hrms/employees",
    "POST /v1/hrms/employees",
    "GET /v1/hrms/leave-applications",
    "GET /v1/hrms/attendance/summary",
  ];

  for (const route of routes) {
    const [method, url] = route.split(" ");
    it(`${route} returns 401 without auth`, async () => {
      const r = await app.inject({ method: method as "GET" | "POST", url: url! });
      expect(r.statusCode).toBe(401);
    });
  }
});
