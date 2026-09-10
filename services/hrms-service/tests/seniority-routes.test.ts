/**
 * Seniority + DPC eligibility routes — comprehensive coverage:
 *
 *  - GET /v1/hrms/seniority, GET /v1/hrms/dpc/eligibility: ranking
 *    correctness, tie-break-by-merit-grade, department/designation
 *    filtering, and boundary validation (restored here after PR #1163
 *    accidentally dropped this suite while rewriting the file for the
 *    DOM-019 producer tests below — these GET routes were NOT touched by
 *    that PR, so the coverage is re-seeded against the real DB in the same
 *    end-to-end style the rest of this file now uses, rather than reverting
 *    to the old mocked-db.js approach).
 *
 *  - DOM-019 regression: `hrms.seniority.generate` / `hrms.seniority.approve`
 *    had a real, correct consumer (fixed under DOM-004) but no producer
 *    anywhere in the fleet — no route, no scheduled job, nothing ever called
 *    `queue.publish` for either command, so the consumer was unreachable in
 *    production.
 *
 *    These tests prove the full path now works end-to-end through a real HTTP
 *    caller: POST /v1/hrms/seniority/generate and POST
 *    /v1/hrms/seniority/:id/approve publish the commands, the real consumer
 *    (registered here exactly as worker.ts does in production) processes them,
 *    and the result is a real, queryable row in the database — not just an
 *    accepted HTTP response.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsAppraisals } from "../src/modules/appraisals/schema.js";
import { hrmsSeniorityLists, hrmsSeniorityListEntries } from "../src/modules/seniority/schema.js";
import { registerSeniorityConsumers } from "../src/modules/seniority/consumer.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT  = "11111111-aaaa-4000-8000-0000000000d9";
const ACTOR   = "00000000-aaaa-4000-8000-0000000000d9";
const DEPT_1  = "77777777-aaaa-4000-8000-0000000000d9";
const DESIG_1 = "88888888-bbbb-4000-8000-0000000000d9";
const EMP_1   = "22222222-bbbb-4000-8000-0000000000d9";
const EMP_2   = "22222222-cccc-4000-8000-0000000000d9";

// worker.ts registers this consumer on the real queue in production; do the
// same here so a route's publish is actually picked up and processed, the
// way it would be by the live worker process.
registerSeniorityConsumers(queue);
async function drain() {
  await (queue as unknown as MemoryQueue).drain();
}

const tok = (roles = ["hr_admin"]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsSeniorityListEntries).where(eq(hrmsSeniorityListEntries.tenantId, TENANT));
    await tx.delete(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
  }));
}

async function seedOrg() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({
      id: DEPT_1, tenantId: TENANT, code: "DEPT-D19", name: "DOM-019 Dept",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: DESIG_1, tenantId: TENANT, code: "DESIG-D19", name: "DOM-019 Designation",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-D19-001", fullName: "Senior One",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2009-01-01",
      dateOfBirth: "1974-01-01", status: "confirmed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_2, tenantId: TENANT, employeeNo: "EMP-D19-002", fullName: "Junior Two",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2019-01-01",
      dateOfBirth: "1991-01-01", status: "confirmed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeAll(async () => { await wipe(); await seedOrg(); await wipeReadFixtures(); await seedReadFixtures(); });
afterAll(async () => { await wipe(); await wipeReadFixtures(); await sqlClient.end(); });

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures for the restored GET-route regression coverage below. Isolated
   under their own tenant so ranking/tie-break/filter assertions can't be
   perturbed by the DOM-019 producer fixtures (or each other) sharing the
   same real database.
   ═══════════════════════════════════════════════════════════════════════════ */
const TENANT_R  = "44444444-aaaa-4000-8000-0000000000d9";
const DEPT_R       = "77777777-cccc-4000-8000-0000000000d9";
const OTHER_DEPT_R  = "77777777-dddd-4000-8000-0000000000d9";
const TIE_DEPT_R    = "77777777-eeee-4000-8000-0000000000d9";
const EMPTY_DEPT_R  = "77777777-ffff-4000-8000-0000000000d9"; // never assigned to any employee
const DESIG_R       = "88888888-cccc-4000-8000-0000000000d9";
const OTHER_DESIG_R = "88888888-dddd-4000-8000-0000000000d9";

const EMP1_R        = "22222222-1111-4000-8000-0000000000d9"; // DOJ 2015, DOB 1980 -> rank 1
const EMP2_R        = "22222222-2222-4000-8000-0000000000d9"; // DOJ 2020 -> rank last
const EMP3_R        = "22222222-3333-4000-8000-0000000000d9"; // DOJ 2015 (tie w/ EMP1), DOB 1982 -> rank 2
const EMP_SEP_R     = "22222222-4444-4000-8000-0000000000d9"; // status separated -> excluded
const EMP_OTHERDEPT_R  = "22222222-5555-4000-8000-0000000000d9";
const EMP_OTHERDESIG_R = "22222222-6666-4000-8000-0000000000d9";
const EMP_A_R       = "22222222-7777-4000-8000-0000000000d9"; // tie-break: lower merit grade
const EMP_B_R       = "22222222-8888-4000-8000-0000000000d9"; // tie-break: higher merit grade -> ranked first

const tokR = (roles = ["hr_admin"]) => signToken({ sub: ACTOR, tid: TENANT_R, roles, sid: "s" }, SECRET);
const authR = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tokR(roles)}` });

async function wipeReadFixtures() {
  await runWithTenant(TENANT_R, () => db.transaction(async (tx) => {
    await tx.delete(hrmsAppraisals).where(eq(hrmsAppraisals.tenantId, TENANT_R));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT_R));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT_R));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT_R));
  }));
}

async function seedReadFixtures() {
  await runWithTenant(TENANT_R, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values([
      { id: DEPT_R, tenantId: TENANT_R, code: "DEPT-R", name: "Read-coverage Dept", createdBy: ACTOR, updatedBy: ACTOR },
      { id: OTHER_DEPT_R, tenantId: TENANT_R, code: "DEPT-R-OTHER", name: "Other Dept", createdBy: ACTOR, updatedBy: ACTOR },
      { id: TIE_DEPT_R, tenantId: TENANT_R, code: "DEPT-R-TIE", name: "Tie-break Dept", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(hrmsDesignations).values([
      { id: DESIG_R, tenantId: TENANT_R, code: "DESIG-R", name: "Read-coverage Designation", createdBy: ACTOR, updatedBy: ACTOR },
      { id: OTHER_DESIG_R, tenantId: TENANT_R, code: "DESIG-R-OTHER", name: "Other Designation", createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(hrmsEmployees).values([
      {
        id: EMP1_R, tenantId: TENANT_R, employeeNo: "EMP-R-001", fullName: "Alice Senior",
        departmentId: DEPT_R, designationId: DESIG_R, dateOfJoining: "2015-03-01",
        dateOfBirth: "1980-06-15", confirmationDate: "2015-09-01", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP2_R, tenantId: TENANT_R, employeeNo: "EMP-R-002", fullName: "Bob Junior",
        departmentId: DEPT_R, designationId: DESIG_R, dateOfJoining: "2020-07-01",
        dateOfBirth: "1990-01-10", confirmationDate: "2021-01-01", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP3_R, tenantId: TENANT_R, employeeNo: "EMP-R-003", fullName: "Charlie Same",
        departmentId: DEPT_R, designationId: DESIG_R, dateOfJoining: "2015-03-01",
        dateOfBirth: "1982-08-20", confirmationDate: "2015-09-01", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP_SEP_R, tenantId: TENANT_R, employeeNo: "EMP-R-004", fullName: "Dave Gone",
        departmentId: DEPT_R, designationId: DESIG_R, dateOfJoining: "2010-01-01",
        dateOfBirth: "1975-01-01", status: "separated",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP_OTHERDEPT_R, tenantId: TENANT_R, employeeNo: "EMP-R-005", fullName: "Eve Other",
        departmentId: OTHER_DEPT_R, designationId: DESIG_R, dateOfJoining: "2016-01-01",
        dateOfBirth: "1983-01-01", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP_OTHERDESIG_R, tenantId: TENANT_R, employeeNo: "EMP-R-006", fullName: "Frank Other",
        departmentId: DEPT_R, designationId: OTHER_DESIG_R, dateOfJoining: "2016-01-01",
        dateOfBirth: "1983-01-01", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP_A_R, tenantId: TENANT_R, employeeNo: "EMP-R-00A", fullName: "Alpha",
        departmentId: TIE_DEPT_R, designationId: DESIG_R, dateOfJoining: "2018-01-01",
        dateOfBirth: "1985-05-05", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: EMP_B_R, tenantId: TENANT_R, employeeNo: "EMP-R-00B", fullName: "Beta",
        departmentId: TIE_DEPT_R, designationId: DESIG_R, dateOfJoining: "2018-01-01",
        dateOfBirth: "1985-05-05", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR,
      },
    ]);
    await tx.insert(hrmsAppraisals).values([
      {
        tenantId: TENANT_R, employeeId: EMP_A_R, appraisalPeriod: "2024-25",
        overallGrade: "6.00", createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        tenantId: TENANT_R, employeeId: EMP_B_R, appraisalPeriod: "2024-25",
        overallGrade: "9.00", createdBy: ACTOR, updatedBy: ACTOR,
      },
    ]);
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   GET /v1/hrms/seniority (restored — see file header)
   ═══════════════════════════════════════════════════════════════════════════ */
describe("GET /v1/hrms/seniority", () => {
  it("200 — returns ranked seniority list", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?departmentId=${DEPT_R}&designationId=${DESIG_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toBeDefined();
    expect(body.count).toBeGreaterThan(0);
    expect(body.asOf).toBeDefined();
    // EMP1 joined 2015-03-01 with DOB 1980 → rank 1 (older than EMP3 with same join date)
    expect(body.data[0].employeeNo).toBe("EMP-R-001");
    expect(body.data[0].rank).toBe(1);
    // EMP3 same join date but younger → rank 2
    expect(body.data[1].employeeNo).toBe("EMP-R-003");
    expect(body.data[1].rank).toBe(2);
    // EMP2 joined later → rank 3
    expect(body.data[2].employeeNo).toBe("EMP-R-002");
    expect(body.data[2].rank).toBe(3);
    // Separated employees excluded
    expect(body.data.every((d: { employeeNo: string }) => d.employeeNo !== "EMP-R-004")).toBe(true);
    await app.close();
  });

  it("200 — filters by departmentId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?departmentId=${DEPT_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.every((d: { departmentId: string }) => d.departmentId === DEPT_R)).toBe(true);
    expect(body.data.some((d: { employeeNo: string }) => d.employeeNo === "EMP-R-005")).toBe(false);
    await app.close();
  });

  it("200 — filters by designationId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?designationId=${DESIG_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data.every((d: { designationId: string }) => d.designationId === DESIG_R)).toBe(true);
    expect(body.data.some((d: { employeeNo: string }) => d.employeeNo === "EMP-R-006")).toBe(false);
    await app.close();
  });

  it("200 — accepts asOf date parameter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority?asOf=2024-01-01",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().asOf).toBe("2024-01-01");
    await app.close();
  });

  it("200 — empty list when no employees match", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?departmentId=${EMPTY_DEPT_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().count).toBe(0);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("200 — tie-break by merit grade DESC when DOJ and DOB equal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/seniority?departmentId=${TIE_DEPT_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    // Higher merit grade → ranked first when DOJ and DOB are tied
    expect(body.data[0].employeeNo).toBe("EMP-R-00B");
    expect(body.data[1].employeeNo).toBe("EMP-R-00A");
    await app.close();
  });

  it("400 — invalid departmentId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority?departmentId=not-a-uuid",
      headers: authR(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid designationId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority?designationId=xyz",
      headers: authR(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (employee)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: authR(["employee"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("403 — insufficient role (viewer)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: authR(["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — hr_officer can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: authR(["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — super_admin can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: authR(["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — manager can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/seniority",
      headers: authR(["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   GET /v1/hrms/dpc/eligibility (restored — see file header)
   ═══════════════════════════════════════════════════════════════════════════ */
describe("GET /v1/hrms/dpc/eligibility", () => {
  it("200 — returns eligible and ineligible buckets", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=5",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.eligible).toBeDefined();
    expect(body.ineligible).toBeDefined();
    expect(body.eligibleCount).toBeDefined();
    expect(body.ineligibleCount).toBeDefined();
    expect(body.minQualifyingYears).toBe(5);
    expect(body.asOf).toBeDefined();
    expect(body.eligibleCount + body.ineligibleCount).toBe(body.eligible.length + body.ineligible.length);
    await app.close();
  });

  it("200 — eligible employees get eligibilityRank field", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=3",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    if (body.eligible.length > 0) {
      expect(body.eligible[0].eligibilityRank).toBe(1);
    }
    await app.close();
  });

  it("200 — defaults minQualifyingYears to 5", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().minQualifyingYears).toBe(5);
    await app.close();
  });

  it("200 — filters by departmentId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/dpc/eligibility?departmentId=${DEPT_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const allEmployees = [...body.eligible, ...body.ineligible];
    expect(allEmployees.every((d: { departmentId: string }) => d.departmentId === DEPT_R)).toBe(true);
    await app.close();
  });

  it("200 — filters by designationId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/dpc/eligibility?designationId=${DESIG_R}`,
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const allEmployees = [...body.eligible, ...body.ineligible];
    expect(allEmployees.every((d: { designationId: string }) => d.designationId === DESIG_R)).toBe(true);
    await app.close();
  });

  it("200 — accepts custom asOf date", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?asOf=2024-01-01&minQualifyingYears=8",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.asOf).toBe("2024-01-01");
    expect(body.minQualifyingYears).toBe(8);
    await app.close();
  });

  it("200 — high minQualifyingYears puts everyone ineligible", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=40",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.eligibleCount).toBe(0);
    expect(body.ineligibleCount).toBeGreaterThan(0);
    await app.close();
  });

  it("200 — zero minQualifyingYears puts everyone eligible", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=0",
      headers: authR(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.eligibleCount).toBeGreaterThan(0);
    expect(body.ineligibleCount).toBe(0);
    await app.close();
  });

  it("400 — invalid departmentId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?departmentId=bad-id",
      headers: authR(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid designationId (not a UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?designationId=nope",
      headers: authR(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — minQualifyingYears exceeds max (40)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=41",
      headers: authR(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — minQualifyingYears negative", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility?minQualifyingYears=-1",
      headers: authR(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (employee)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: authR(["employee"]),
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("403 — insufficient role (viewer)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: authR(["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("200 — hr_officer can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: authR(["hr_officer"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — super_admin can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: authR(["super_admin"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — manager can access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/dpc/eligibility",
      headers: authR(["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   POST /v1/hrms/seniority/generate + /approve — DOM-019 producer wired to
   the real DOM-004 consumer
   ═══════════════════════════════════════════════════════════════════════════ */
describe("POST /v1/hrms/seniority/generate — DOM-019 producer wired to the real DOM-004 consumer", () => {
  it("202s, publishes the command, and the consumer persists a real snapshot", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(), payload: { departmentId: DEPT_1, asOf: "2026-09-10" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    await app.close();

    // The 202 above is only proof the command was queued — drain the real
    // consumer and check the database for a real persisted row, the way
    // DOM-004's own test does.
    await drain();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, body.id))));
    expect(lists).toHaveLength(1);
    expect(lists[0]?.status).toBe("generated");
    expect(lists[0]?.entryCount).toBe(2);
    expect(lists[0]?.generatedBy).toBe(ACTOR);

    const entries = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityListEntries)
        .where(eq(hrmsSeniorityListEntries.seniorityListId, body.id))));
    expect(entries).toHaveLength(2);
    const byRank = [...entries].sort((a, b) => a.rank - b.rank);
    expect(byRank[0]?.employeeNo).toBe("EMP-D19-001"); // joined 2009 -> senior -> rank 1
    expect(byRank[1]?.employeeNo).toBe("EMP-D19-002");
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/seniority/generate", payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager (read-only role) cannot trigger generate", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(["manager"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("400 — invalid departmentId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(), payload: { departmentId: "not-a-uuid" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /v1/hrms/seniority/:id/approve — DOM-019 producer wired to the real DOM-004 consumer", () => {
  it("202s, publishes the command, and the consumer flips the list to approved", async () => {
    // Generate a real list first via the real route (full chain, not a
    // hand-seeded row), then approve it via the real route too.
    const genApp = await buildApp();
    const genRes = await genApp.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(), payload: { departmentId: DEPT_1, asOf: "2026-09-10" },
    });
    const listId = genRes.json().id as string;
    await genApp.close();
    await drain();

    const approveApp = await buildApp();
    const r = await approveApp.inject({
      method: "POST", url: `/v1/hrms/seniority/${listId}/approve`,
      headers: auth(), payload: { remarks: "verified end-to-end for DOM-019" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBe(listId);
    expect(body.status).toBe("accepted");
    await approveApp.close();

    await drain();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, listId))));
    expect(lists).toHaveLength(1);
    expect(lists[0]?.status).toBe("approved");
    expect(lists[0]?.approvedBy).toBe(ACTOR);
    expect(lists[0]?.approvedAt).not.toBeNull();
    expect(lists[0]?.remarks).toBe("verified end-to-end for DOM-019");
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/seniority/${EMP_1}/approve`, payload: {},
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager (read-only role) cannot approve", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/seniority/${EMP_1}/approve`,
      headers: auth(["manager"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("400 — invalid id param", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/not-a-uuid/approve",
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});
