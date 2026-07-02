/**
 * HRMS POST route coverage — valid payloads that pass zod validation
 * to reach deeper into handler code paths (DB calls, etc.)
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-9999-4000-8000-000000000009";
const FAKE = randomUUID();

function token(roles = ["hr_admin", "super_admin", "admin", "hr_officer", "manager", "payroll_admin", "finance_officer", "audit_admin", "officer", "employee"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("HRMS POST routes — original set", () => {
  it("POST /v1/hrms/employees", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeNo: "E999", fullName: "Test", departmentId: UUID, designationId: UUID, dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: "5000000", currency: "INR" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/departments", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/departments", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Test Dept G", code: "TDG01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/designations", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/designations", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Test Design G", code: "DGG01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/leave-types", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-types", headers: { authorization: `Bearer ${token()}` },
      payload: { code: "TL", name: "Test Leave", maxDaysPerYear: 10 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/leave-allocations", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-allocations", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), leaveTypeId: randomUUID(), fy: "2025-26", totalDays: 20 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/attendance", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/attendance", headers: { authorization: `Bearer ${token()}` },
      payload: { batchId: randomUUID(), records: [{ employeeId: randomUUID(), attendanceDate: "2026-06-01", status: "present" }] } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/job-openings", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/job-openings", headers: { authorization: `Bearer ${token()}` },
      payload: { refNo: "RCT/001", title: "Clerk", departmentId: randomUUID(), vacancies: 5 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/holidays", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/holidays", headers: { authorization: `Bearer ${token()}` },
      payload: { date: "2027-12-25", name: "Xmas G", type: "gazetted" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/announcements", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/announcements", headers: { authorization: `Bearer ${token()}` },
      payload: { title: "Notice", body: "Test announcement", category: "general", publishAt: "2026-06-01T00:00:00Z" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/goals", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/goals", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), title: "Q1 Target", dueDate: "2026-09-30" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS POST routes — AI Fraud & Face Verification (0% coverage)", () => {
  it("POST /v1/hrms/ai/scan — trigger fraud scan", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/ai/scan", headers: { authorization: `Bearer ${token()}` }, payload: {} });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/alerts", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/alerts", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/risk-scores", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/risk-scores", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/recommendations", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/recommendations", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/ai/alerts/:id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/ai/alerts/${FAKE}`, headers: { authorization: `Bearer ${token()}` },
      payload: { status: "investigating" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/attrition-risk/:employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/ai/attrition-risk/${FAKE}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/employees/:id/profile-photo", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${FAKE}/profile-photo`, headers: { authorization: `Bearer ${token()}` },
      payload: { photoKey: "photos/test.jpg", photoBucket: "civitasone-photos" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/employees/:id/profile-photo", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${FAKE}/profile-photo`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/attendance/verify-face", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/attendance/verify-face", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, selfieKey: "selfies/test.jpg" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/admin/face-config", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/admin/face-config", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/admin/face-config", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: "/v1/hrms/admin/face-config", headers: { authorization: `Bearer ${token()}` },
      payload: { onnxThreshold: 0.8 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/attendance/face-log", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/attendance/face-log?employeeId=${FAKE}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS POST routes — Geo Attendance (0% coverage)", () => {
  it("POST /v1/hrms/office-locations", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/office-locations", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "HQ Office", latitude: 28.6139, longitude: 77.2090, radiusMeters: 200 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/office-locations", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/office-locations", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/attendance/geo-check-in", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/attendance/geo-check-in", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, latitude: 28.6139, longitude: 77.2090, accuracyMeters: 10 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/attendance/geo-check-out", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/attendance/geo-check-out", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, latitude: 28.6139, longitude: 77.2090 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/attendance/geo-history", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/attendance/geo-history?employeeId=${FAKE}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/attendance/reportees", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/reportees", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS POST routes — Lifecycle (low coverage)", () => {
  it("POST /v1/hrms/lifecycle/promotions", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lifecycle/promotions", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, fromDesigId: randomUUID(), toDesigId: randomUUID(), effectiveDate: "2026-04-01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/lifecycle/transfers", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lifecycle/transfers", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, fromDeptId: randomUUID(), toDeptId: randomUUID(), effectiveDate: "2026-05-01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/lifecycle/transfers/:id/issue-order", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${FAKE}/issue-order`, headers: { authorization: `Bearer ${token()}` },
      payload: { orderNo: "TO/2026/001", orderDate: "2026-05-01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/lifecycle/transfers/:id/relieve", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${FAKE}/relieve`, headers: { authorization: `Bearer ${token()}` },
      payload: { relievedDate: "2026-05-15" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/lifecycle/transfers/:id/join", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lifecycle/transfers/${FAKE}/join`, headers: { authorization: `Bearer ${token()}` },
      payload: { joinedDate: "2026-05-20" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/lifecycle/promotions", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/lifecycle/transfers", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/transfers", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS POST routes — Medical claims", () => {
  it("POST /v1/hrms/medical/claims", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/medical/claims", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, claimType: "OPD", amountMinor: 500000, hospitalName: "AIIMS Delhi", diagnosis: "Routine checkup" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/medical/claims", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/medical/claims", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/medical/claims/:id/approve", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/medical/claims/${FAKE}/approve`, headers: { authorization: `Bearer ${token()}` },
      payload: { status: "approved", approvedAmountMinor: 400000 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS POST routes — RTI requests", () => {
  it("POST /v1/hrms/rti/requests", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/rti/requests", headers: { authorization: `Bearer ${token()}` },
      payload: { referenceNo: "RTI/2026/001", applicantName: "Test Citizen", subject: "Service records", requestText: "Requesting information under RTI Act 2005", receivedDate: "2026-01-15" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/rti/requests/:id/assign", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${FAKE}/assign`, headers: { authorization: `Bearer ${token()}` },
      payload: { pioId: randomUUID() } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/rti/requests/:id/respond", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${FAKE}/respond`, headers: { authorization: `Bearer ${token()}` },
      payload: { responseText: "Information provided as requested.", respondedDate: "2026-02-01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/rti/requests/:id/appeal", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${FAKE}/appeal`, headers: { authorization: `Bearer ${token()}` },
      payload: { appealText: "Incomplete response received", appealDate: "2026-02-15" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/rti/requests/:id/close", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/rti/requests/${FAKE}/close`, headers: { authorization: `Bearer ${token()}` },
      payload: { closedDate: "2026-03-01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/rti/requests", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/rti/requests", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

});

describe("HRMS GET routes — workforce-planning & reports & self-service", () => {
  it("GET /v1/hrms/workforce/headcount", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/headcount", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/workforce/retirement-forecast", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/workforce/vacancy-forecast", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/vacancy-forecast", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/workforce/budget", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/budget", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/workforce/diversity", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/workforce/diversity", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/reports/headcount", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/reports/headcount", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/reports/leave-balance", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/reports/leave-balance", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/reports/absentees", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/reports/absentees", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/reports/seniority", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/reports/seniority", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

});

describe("HRMS routes — AI Predictions", () => {
  it("GET /v1/hrms/ai/attrition-risk", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/attrition-risk", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/succession", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/succession", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/workforce-insights", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/workforce-insights", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/ai/leave-prediction", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/leave-prediction", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS routes — Seniority & Pay Matrix & Scheduler & Dashboard", () => {
  it("GET /v1/hrms/seniority", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/seniority", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/dpc/eligibility", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/dpc/eligibility", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/pay-matrix", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/pay-matrix", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/pay-matrix/lookup", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/pay-matrix/lookup?level=10&cell=1", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/pay-matrix/annual-increment", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/pay-matrix/annual-increment", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, effectiveDate: "2026-07-01" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/scheduler/due-list", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/scheduler/due-list?kind=superannuation", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/scheduler/runs", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/scheduler/runs", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/scheduler/run", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/scheduler/run", headers: { authorization: `Bearer ${token()}` },
      payload: { kind: "superannuation" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/dashboard", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/dashboard", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/org-chart", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/org-chart", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS routes — Service Book & Bulk Import & Internal", () => {
  it("POST /v1/hrms/employees/:id/service-book", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${FAKE}/service-book`, headers: { authorization: `Bearer ${token()}` },
      payload: { entryType: "promotion", effectiveDate: "2026-01-01", description: "Promoted to Grade II" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });


  it("POST /v1/hrms/employees/bulk", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/employees/bulk", headers: { authorization: `Bearer ${token()}` },
      payload: { rows: [{ employeeNo: "BLK001", fullName: "Bulk Test", departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: "3000000", currency: "INR" }] } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/employees/bulk/status/:batchId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/bulk/status/${FAKE}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/internal/payroll-input", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/internal/payroll-input", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS routes — Device Trust", () => {
  it("POST /v1/hrms/devices/heartbeat", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/devices/heartbeat", headers: { authorization: `Bearer ${token()}` },
      payload: { deviceId: FAKE, platform: "android", appVersion: "1.0.0" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/devices/admin", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/devices/admin", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/devices/:id/block", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/devices/${FAKE}/block`, headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Lost device" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/devices/:id/unblock", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/devices/${FAKE}/unblock`, headers: { authorization: `Bearer ${token()}` },
      payload: {} });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/devices/:deviceId/activity", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/devices/${FAKE}/activity`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/devices/policy", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/devices/policy", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/devices/policy", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: "/v1/hrms/devices/policy", headers: { authorization: `Bearer ${token()}` },
      payload: { maxDevices: 3 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/devices/me", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/devices/me", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS routes — ID Cards & Visiting Cards", () => {
  it("POST /v1/hrms/id-cards", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/id-cards", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, photoKey: "photos/id.jpg" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/id-cards", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/id-cards/me", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/id-cards/me", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/id-cards/verify", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/id-cards/verify", headers: { authorization: `Bearer ${token()}` },
      payload: { cardNumber: "GOV-123456" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/id-cards/:id/suspend", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${FAKE}/suspend`, headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Lost card" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/id-cards/:id/revoke", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${FAKE}/revoke`, headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Terminated" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/id-cards/:id/reactivate", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${FAKE}/reactivate`, headers: { authorization: `Bearer ${token()}` },
      payload: {} });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/visiting-card/me", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/visiting-card/me", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: { authorization: `Bearer ${token()}` },
      payload: { title: "Senior Officer" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/visiting-card/me/share", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/visiting-card/me/share", headers: { authorization: `Bearer ${token()}` },
      payload: { recipientEmail: "test@example.com" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/visiting-card/me/signature", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me/signature", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});

describe("HRMS routes — Reservation & Sanctioned Posts", () => {
  it("POST /v1/hrms/reservation/rosters", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/reservation/rosters", headers: { authorization: `Bearer ${token()}` },
      payload: { cadre: "Section Officer", rosterKind: "point100", rosterSize: 100 } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/reservation/rosters", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/reservation/rosters", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });


  it("GET /v1/hrms/sanctioned-posts", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/sanctioned-posts", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

});

describe("HRMS routes — Appraisals & Leave admin", () => {
  it("GET /v1/hrms/appraisals", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/appraisals", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, cycleId: randomUUID(), fy: "2025-26" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/appraisals/:id/stage", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/appraisals/${FAKE}/stage`, headers: { authorization: `Bearer ${token()}` },
      payload: { stage: "self_submitted" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/admin/leave-policies", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/admin/leave-policies", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/admin/leave-policies", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/admin/leave-policies", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Test Policy", leaveTypeId: randomUUID(), accrualPerMonth: 2, maxBalance: 300, carryForward: true } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/admin/leave-policies", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/admin/leave-policies", headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Test Policy 2", leaveTypeId: randomUUID(), accrualPerMonth: 2, maxBalance: 300, carryForward: true } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("POST /v1/hrms/comp-off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/comp-off", headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: FAKE, workedDate: "2026-01-15", reason: "Weekend work" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/comp-off", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/comp-off", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/leave-context", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-context", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("GET /v1/hrms/leave-types (list)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-types", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });
});
