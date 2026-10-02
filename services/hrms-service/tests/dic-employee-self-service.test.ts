/**
 * ═══════════════════════════════════════════════════════════════════════
 * EMPLOYEE SELF-SERVICE — Arjun Nair's Complete Experience
 * Tests what an employee CAN do and CANNOT do
 * ═══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

// Arjun Nair — regular employee
const ARJUN = { id: randomUUID(), roles: ["employee"] };
// Priya — HR admin (for comparison)
const PRIYA = { id: randomUUID(), roles: ["hr_admin", "super_admin"] };

function h(p: { id: string; roles: string[] }) {
  const token = signToken({ sub: p.id, tid: TENANT, roles: p.roles, sid: `s-${p.id.slice(0,6)}` }, SECRET, 7200);
  return { authorization: `Bearer ${token}`, "x-tenant-id": TENANT, "content-type": "application/json" };
}

// Arjun's own hrms_employees row, linked to his login through user_ref (the
// link employee/actor-link.ts resolveEmployeeForActor reads). Self-service
// writes such as POST /v1/hrms/nominations only accept a non-HR caller whose
// login resolves to an employee row (#1545, training/routes.ts
// resolveOwnEmployeeIdIfNonHr; 403 NO_EMPLOYEE_LINK otherwise), and this
// file's random tenant had no employee rows at all. The row reuses ARJUN.id
// as its employee id so every existing `employeeId: ARJUN.id` payload below
// keeps naming Arjun himself.
const COLLEAGUE_ID = randomUUID();
async function seedArjunEmployee(): Promise<void> {
  const system = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id: ARJUN.id, tenantId: TENANT, employeeNo: `ARJ-${ARJUN.id.slice(0, 8)}`,
      fullName: "Arjun Nair", departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2021-04-01", status: "confirmed",
      userRef: ARJUN.id, createdBy: system, updatedBy: system,
    });
    // A colleague carrying PII, so B2's "no PII in the directory" check has
    // a real row to inspect rather than passing on an empty list.
    await tx.insert(hrmsEmployees).values({
      id: COLLEAGUE_ID, tenantId: TENANT, employeeNo: `COL-${COLLEAGUE_ID.slice(0, 8)}`,
      fullName: "Meera Iyer", departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2019-06-01", status: "confirmed", managerId: ARJUN.id,
      dateOfBirth: "1990-05-17", pan: "ABCPE1234F", mobile: "9812345670",
      createdBy: system, updatedBy: system,
    });
  }));
}

let app: FastifyInstance;
beforeAll(async () => { await seedArjunEmployee(); app = await buildApp(); await app.ready(); });
afterAll(async () => {
  await app.close();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
  })).catch(() => {});
});

// ═══════════════════════════════════════════════════════════
// SECTION A: What Employee CAN Do (Self-Service)
// ═══════════════════════════════════════════════════════════

describe("A. Employee CAN — Leave Self-Service", () => {
  it("A1. Apply for leave", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-applications", headers: h(ARJUN), payload: {
      employeeId: ARJUN.id, leaveTypeId: randomUUID(), allocId: randomUUID(),
      fromDate: "2024-12-25", toDate: "2024-12-27", daysApplied: 3, reason: "Year-end break",
    }});
    expect(r.statusCode).not.toBe(401);
    expect(r.statusCode).not.toBe(403);
    console.log(`  ✓ A1 Apply leave: ${r.statusCode}`);
  });

  it("A2. Apply via leave-requests alias", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-requests", headers: h(ARJUN), payload: {
      employeeId: ARJUN.id, leaveTypeId: randomUUID(), allocId: randomUUID(),
      fromDate: "2025-01-02", toDate: "2025-01-03", daysApplied: 2,
    }});
    expect(r.statusCode).not.toBe(403);
    console.log(`  ✓ A2 Leave request: ${r.statusCode}`);
  });

  it("A3. View my leave applications", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-applications?limit=10", headers: h(ARJUN) });
    expect(r.statusCode).toBe(200);
    console.log(`  ✓ A3 View applications: 200`);
  });

  it("A4. View leave request details", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-requests?limit=10", headers: h(ARJUN) });
    expect(r.statusCode).toBe(200);
    console.log(`  ✓ A4 Leave details: 200`);
  });

  it("A5. View leave allocations (balances)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-allocations", headers: h(ARJUN) });
    expect(r.statusCode).toBe(200);
    console.log(`  ✓ A5 Balances: 200`);
  });
});

describe("A. Employee CAN — Training Self-Service", () => {
  it("A6. Browse training programs", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/training-programs?limit=10", headers: h(ARJUN) });
    expect(r.statusCode).toBe(200);
    console.log(`  ✓ A6 Training list: 200`);
  });

  it("A7. Self-nominate for training", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/nominations", headers: h(ARJUN), payload: {
      trainingId: randomUUID(), employeeId: ARJUN.id,
    }});
    expect(r.statusCode).not.toBe(403);
    console.log(`  ✓ A7 Nominate: ${r.statusCode}`);
  });

  it("A8. View my nominations", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/nominations?employeeId=${ARJUN.id}&limit=10`, headers: h(ARJUN) });
    expect(r.statusCode).toBe(200);
    console.log(`  ✓ A8 My nominations: 200`);
  });
});

describe("A. Employee CAN — Appraisal Self-Service", () => {
  it("A9. Submit 360° self-feedback", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/appraisals/${randomUUID()}/360-feedback`, headers: h(ARJUN), payload: {
      reviewerId: ARJUN.id, relationship: "self", comments: "Delivered all sprint commitments on time",
    }});
    // 201 or 404 (appraisal not in DB) — NOT 403
    expect(r.statusCode).not.toBe(403);
    console.log(`  ✓ A9 360 feedback: ${r.statusCode}`);
  });

  it("A10. File rating appeal", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/appraisals/${randomUUID()}/appeal`, headers: h(ARJUN), payload: {
      employeeId: ARJUN.id, appealReason: "Rating does not reflect my project delivery and on-time metrics for 3 consecutive sprints", pipLinked: false,
    }});
    expect(r.statusCode).not.toBe(403);
    console.log(`  ✓ A10 Appeal: ${r.statusCode}`);
  });
});

// ═══════════════════════════════════════════════════════════
// SECTION B: What Employee CANNOT Do (Boundaries)
// ═══════════════════════════════════════════════════════════

describe("B. Employee CANNOT — HR Admin Operations", () => {
  it("B1. Cannot create employees", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: h(ARJUN), payload: { fullName:"X", employeeNo:"X", department:"X", designation:"X", dateOfJoining:"2024-01-01", employeeType:"permanent" }});
    expect(r.statusCode).toBe(403);
  });

  it("B2. Employee directory is open to all staff, without PII (#1499)", async () => {
    // #1499 deliberately added "employee" to the directory LIST route's
    // DIRECTORY_ROLES (employee/routes.ts): it backs hr/directory and carries
    // no PII or salary. The richer GET /employees/:id stays on READER_ROLES.
    const r = await app.inject({ method: "GET", url: "/v1/hrms/employees?limit=50", headers: h(ARJUN) });
    expect(r.statusCode).toBe(200);
    const rows = (r.json().data ?? []) as Array<Record<string, unknown>>;
    expect(rows.some((row) => row.id === COLLEAGUE_ID)).toBe(true);
    for (const row of rows) {
      for (const pii of ["pan", "aadhaarRef", "mobile", "phone", "bankAccountNo", "bankIfsc", "basicMinor", "dateOfBirth"]) {
        expect(row).not.toHaveProperty(pii);
      }
    }
  });

  it("B3. Cannot create leave types", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-types", headers: h(ARJUN), payload: { name:"X", code:"X", maxDays:5 }});
    expect(r.statusCode).toBe(403);
  });

  it("B4. Cannot allocate leave", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-allocations", headers: h(ARJUN), payload: { employeeId: randomUUID(), leaveTypeId: randomUUID(), totalDays: 10, year: 2024 }});
    expect(r.statusCode).toBe(403);
  });

  it("B5. Cannot approve leave", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/leave-applications/${randomUUID()}/approve`, headers: h(ARJUN) });
    expect(r.statusCode).toBe(403);
  });

  it("B6. Cannot reject leave", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/leave-applications/${randomUUID()}/reject`, headers: h(ARJUN), payload: { reason: "test" }});
    expect(r.statusCode).toBe(403);
  });

  it("B7. Cannot mark attendance", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/attendance", headers: h(ARJUN), payload: { records: [{ employeeId: ARJUN.id, attendanceDate: "2024-11-04", status: "present" }] }});
    expect(r.statusCode).toBe(403);
  });

  it("B8. Cannot view attendance summary", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary", headers: h(ARJUN) });
    expect(r.statusCode).toBe(403);
  });

  it("B9. Cannot lock attendance", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/attendance/locks", headers: h(ARJUN), payload: { period: "2024-10" }});
    expect(r.statusCode).toBe(403);
  });

  it("B10. Cannot create training", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/trainings", headers: h(ARJUN), payload: { title:"X", type:"mandatory", startDate:"2025-01-01", endDate:"2025-01-02" }});
    expect(r.statusCode).toBe(403);
  });

  it("B11. Cannot open disciplinary case", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${randomUUID()}/disciplinary-cases`, headers: h(ARJUN), payload: { caseNo:"X", allegation:"test" }});
    expect(r.statusCode).toBe(403);
  });

  it("B12. Cannot suspend employee", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${randomUUID()}/suspensions`, headers: h(ARJUN), payload: { fromDate:"2024-12-01", paySuspended:true }});
    expect(r.statusCode).toBe(403);
  });

  it("B13. Cannot transfer employee", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${randomUUID()}/transfer/submit-approval`, headers: h(ARJUN), payload: { fromDeptId: randomUUID(), toDeptId: randomUUID(), effectiveDate: "2025-01-01" }});
    expect(r.statusCode).toBe(403);
  });

  it("B14. Cannot promote employee", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${randomUUID()}/promotion/submit-approval`, headers: h(ARJUN), payload: { fromDesigId: randomUUID(), toDesigId: randomUUID(), effectiveDate: "2025-01-01" }});
    expect(r.statusCode).toBe(403);
  });

  it("B15. Cannot create appraisal cycle", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: h(ARJUN), payload: { employeeId: randomUUID(), appraisalPeriod: "FY 2024-25" }});
    expect(r.statusCode).toBe(403);
  });
});

describe("B. Employee CANNOT — Unauthenticated rejected", () => {
  it("B16. No token → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/leave-applications" });
    expect(r.statusCode).toBe(401);
  });

  it("B17. No token on POST → 401", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/hrms/leave-applications", payload: {} });
    expect(r.statusCode).toBe(401);
  });

  it("B18. No token on attendance → 401", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary" });
    expect(r.statusCode).toBe(401);
  });
});
