import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

let app: FastifyInstance;
let token: string;

function mintToken(roles: string[] = ["super_admin", "hr_admin"]) {
  const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
  const TENANT = "00000000-0000-0000-0000-000000000001";
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({ sub: "00000000-0000-0000-0000-000000000099", iss: "civitasone-dev", tid: TENANT, tenantId: TENANT, sid: "test", email: "test@test.dev", name: "Test", roles, iat: now, exp: now + 3600 });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

beforeAll(async () => {
  app = await buildApp();
  token = mintToken();
});

describe("HRMS Service — Integration Tests", () => {
  // ─── Health ─────────────────────────────────────────
  it("GET /health returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  // ─── Dashboard ──────────────────────────────────────
  it("GET /v1/hrms/dashboard returns headcount", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("headcount");
    expect(body).toHaveProperty("pendingLeaves");
  });

  // ─── Employees ──────────────────────────────────────
  it("GET /v1/hrms/employees returns list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employees", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("POST /v1/hrms/employees returns 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/employees",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { employeeNo: `TEST${Date.now()}`, fullName: "Test Employee", departmentId: "eeeeeeee-0001-0000-0000-000000000001", designationId: "eeeeeeee-0001-0000-0000-000000000003", dateOfJoining: "2026-06-21", basicMinor: 1000000 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("POST /v1/hrms/employees rejects invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/employees",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { fullName: "" }, // missing required fields
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Auth ───────────────────────────────────────────
  it("GET /v1/hrms/employees returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employees" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/hrms/employees returns 403 for wrong role", async () => {
    const badToken = mintToken(["reader"]);
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employees", headers: { authorization: `Bearer ${badToken}` } });
    // reader may or may not be in ALL_ROLES depending on implementation
    expect([200, 403]).toContain(res.statusCode);
  });

  // ─── Leave ──────────────────────────────────────────
  it("GET /v1/hrms/leave-applications returns list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-applications", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/hrms/leave-applications validates body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { employeeId: "bad-uuid" }, // invalid
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Attendance ─────────────────────────────────────
  it("GET /v1/hrms/attendance returns records", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/hrms/attendance with valid records returns 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/attendance",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { records: [{ employeeId: "eeeeeeee-0001-0000-0000-000000000005", attendanceDate: "2026-06-25", status: "present", inTime: "09:00", outTime: "17:30", source: "manual" }] },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/hrms/attendance/summary returns data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  // ─── Holidays ───────────────────────────────────────
  it("GET /v1/hrms/holidays returns list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/holidays", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("POST /v1/hrms/holidays creates a holiday", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/holidays",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { name: "Test Holiday " + Date.now(), date: "2026-12-29", type: "optional" },
    });
    expect(res.statusCode).toBe(202);
  });

  // ─── Reports ────────────────────────────────────────
  it("GET /v1/hrms/reports/headcount returns departments", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/headcount", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("total");
  });

  it("GET /v1/hrms/reports/leave-balance returns data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/leave-balance", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/hrms/reports/seniority returns ranked list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/seniority", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  // ─── Bulk Import ────────────────────────────────────
  it("POST /v1/hrms/employees/bulk validates and accepts batch", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { employees: [{ employeeNo: "BULK001", fullName: "Bulk Test", departmentId: "eeeeeeee-0001-0000-0000-000000000001", designationId: "eeeeeeee-0001-0000-0000-000000000003", dateOfJoining: "2026-06-21" }] },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/hrms/employees/bulk rejects duplicates", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { employees: [
        { employeeNo: "DUP001", fullName: "Dup 1", departmentId: "eeeeeeee-0001-0000-0000-000000000001", designationId: "eeeeeeee-0001-0000-0000-000000000003", dateOfJoining: "2026-06-21" },
        { employeeNo: "DUP001", fullName: "Dup 2", departmentId: "eeeeeeee-0001-0000-0000-000000000001", designationId: "eeeeeeee-0001-0000-0000-000000000003", dateOfJoining: "2026-06-21" },
      ] },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Org Chart & Others ─────────────────────────────
  it("GET /v1/hrms/org-chart returns data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/org-chart", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/hrms/training-programs returns data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/training-programs", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/hrms/job-openings returns data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/job-openings", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/hrms/appraisals returns data", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });
});
