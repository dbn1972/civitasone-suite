/**
 * HRMS POST route coverage — valid payloads that pass zod validation
 * to reach deeper into handler code paths (DB calls, etc.)
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";
import { hrmsMedicalClaims } from "../src/modules/medical/schema.js";
import { hrmsProfilePhotos } from "../src/modules/face-verification/schema.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-9999-4000-8000-000000000009";
const FAKE = randomUUID();

function token(roles = ["hr_admin", "super_admin", "admin", "hr_officer", "manager", "payroll_admin", "finance_officer", "audit_admin", "officer", "employee"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

/**
 * Fixture helpers for the five "expected 404 not to be 404" cases below.
 * All five call an endpoint that correctly 404s for a resource that does not
 * exist (a genuine, intentional check — see the root-cause comments at each
 * call site) — the original tests hit these with a bare `randomUUID()` and no
 * seeded row, so they could never pass. Each helper inserts a real row in the
 * exact starting state the endpoint requires, tenant-scoped the same way the
 * production write path scopes it (RLS is FORCEd on every table touched here).
 */
async function seedIdCard(status: "active" | "suspended"): Promise<string> {
  const id = randomUUID();
  const cardNumber = `TST/${Date.now()}/${Math.floor(Math.random() * 100000)}`;
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO hrms.id_cards
      (id, tenant_id, holder_name, card_type, card_number, valid_until, status, qr_payload, issued_by)
    VALUES
      (${id}, ${TENANT}, 'Route Coverage Fixture', 'employee', ${cardNumber}, '2030-01-01', ${status}, 'CVO1:fixture:fixture', ${UUID})
  `);
  return id;
}

async function seedMedicalClaim(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsMedicalClaims).values({
    id, tenantId: TENANT, employeeId: randomUUID(), claimType: "outdoor",
    amountMinor: 500000n, hospitalName: "AIIMS Delhi", diagnosis: "Routine checkup",
    status: "pending", createdBy: UUID, updatedBy: UUID,
  })));
  return id;
}

async function seedProfilePhoto(employeeId: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsProfilePhotos).values({
    tenantId: TENANT, employeeId, photoKey: "photos/route-coverage-fixture.jpg",
  })));
}

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
    // Root cause: the POST above issues its write via publishF3Write (an async
    // command consumed by registerFaceVerificationConsumers, which only runs in
    // worker.ts — buildApp() here builds the HTTP app alone, so nothing ever
    // consumes that command and no hrms_profile_photos row is created. GET was
    // then always checking a FAKE id with no row behind it, for any id. Seed the
    // row this endpoint actually reads directly instead of relying on the POST's
    // (in this test process, never-delivered) async write.
    await seedProfilePhoto(FAKE);
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
    // Root cause: the handler correctly 404s ("medical claim not found") for a
    // claim id with no matching row — FAKE was never a real claim. Seed one in
    // 'pending' status (the only status the approve transition accepts).
    const claimId = await seedMedicalClaim();
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/medical/claims/${claimId}/approve`, headers: { authorization: `Bearer ${token()}` },
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
    // Root cause: hrms.id_cards has RLS ENABLEd + FORCEd, and this route (like
    // medical/routes.ts and workforce-planning/routes.ts before their fix)
    // talked to the DB via a raw, unscoped sqlPool query with no app.tenant_id
    // GUC set — RLS fails CLOSED, so the UPDATE always matched zero rows,
    // 404ing even for a genuinely existing card. Fixed in
    // src/modules/id-cards/routes.ts (suspend/revoke/reactivate now use
    // withRawTenantGuc, mirroring the established pattern). FAKE was also never
    // a real card row; seed one in 'active' status, the state suspend requires.
    const cardId = await seedIdCard("active");
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${cardId}/suspend`, headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Lost card" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/id-cards/:id/revoke", async () => {
    // Same RLS-GUC root cause as suspend above, now fixed in routes.ts. Revoke
    // accepts a card in 'active' or 'suspended' status; seed 'active'.
    const cardId = await seedIdCard("active");
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${cardId}/revoke`, headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Terminated" } });
    await app.close();
    expect(r.statusCode).not.toBe(404);
  });

  it("PATCH /v1/hrms/id-cards/:id/reactivate", async () => {
    // Same RLS-GUC root cause as suspend above, now fixed in routes.ts.
    // Reactivate requires a card currently 'suspended'.
    const cardId = await seedIdCard("suspended");
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/id-cards/${cardId}/reactivate`, headers: { authorization: `Bearer ${token()}` },
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
