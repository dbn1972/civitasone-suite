/**
 * Real-DB regression guard for GAP-HR-DISCIPLINARY-02/04 and
 * GAP-HR-VIGILANCE-04/06: pagination, case numbers, and stat-card accuracy
 * on the disciplinary/vigilance list routes.
 *
 * Both list routes used to hard LIMIT 200 with no cursor -- case #201+ was
 * permanently unreachable and every stat card (previously computed
 * client-side from just those <=200 rows) silently understated the true
 * total past 200 cases. Both also fabricated a client-side "VIG/"/"GRV/" +
 * first-8-hex-chars case reference instead of returning the real, stored
 * case_no, so the same case showed two different "numbers" depending which
 * screen you were on (list vs. the disciplinary/[id] detail page).
 *
 * Seeds a small, deliberately-not-round number of cases (5) so limit/offset
 * boundaries are exercised without a slow 250-row seed, in a fresh random
 * tenant so stat totals can be asserted precisely with no cross-test
 * pollution risk.
 *
 * Real DB (no mocks), same seeding precedent as
 * disciplinary-vigilance-pii-containment-real-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsDisciplinaryCases } from "../modules/disciplinary/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR_OFFICER_ACTOR = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-disc-vig-pagination" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;

const SPECS = [
  { key: "major1", proceedingType: "major" as const, status: "inquiry_appointed" },
  { key: "major2", proceedingType: "major" as const, status: "closed" },
  { key: "major3", proceedingType: "major" as const, status: "dropped" },
  { key: "minor1", proceedingType: "minor" as const, status: "opened" },
  { key: "minor2", proceedingType: "minor" as const, status: "opened" },
];
const caseNos: Record<string, string> = {};
const caseIds: Record<string, string> = {};

beforeAll(async () => {
  app = await buildApp();

  const deptId = randomUUID();
  const desigId = randomUUID();
  const employeeId = randomUUID();

  for (const s of SPECS) {
    caseIds[s.key] = randomUUID();
    caseNos[s.key] = `PAG-TEST-${s.key.toUpperCase()}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsDepartments).values({
      id: deptId, tenantId: TENANT, code: "PAGT", name: "Pagination Test Dept",
      isActive: true, createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: desigId, tenantId: TENANT, code: "PAGT-D", name: "Pagination Test Designation", level: 5,
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId: TENANT, employeeNo: "PAGT-001", fullName: "Pagination Test Employee",
      departmentId: deptId, designationId: desigId, dateOfJoining: "2020-01-01",
      createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
    });
    await tx.insert(hrmsDisciplinaryCases).values(
      SPECS.map((s) => ({
        id: caseIds[s.key], tenantId: TENANT, employeeId, caseNo: caseNos[s.key],
        proceedingType: s.proceedingType, status: s.status,
        allegation: "Seeded allegation for pagination test.",
        createdBy: HR_OFFICER_ACTOR, updatedBy: HR_OFFICER_ACTOR,
      })),
    );
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/disciplinary-cases (GAP-HR-DISCIPLINARY-02/04)", () => {
  it("returns the real, stored caseNo for each row (not a fabricated client-side reference)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases?limit=10",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === caseIds.major1);
    expect(row?.caseNo).toBe(caseNos.major1);
  });

  it("paginates with limit/offset and reports hasMore/total across the whole tenant", async () => {
    const page1 = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases?limit=3&offset=0",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect((body1.data as unknown[]).length).toBe(3);
    expect(body1.total).toBe(5);
    expect(body1.hasMore).toBe(true);

    const page2 = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases?limit=3&offset=3",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    const body2 = page2.json();
    expect((body2.data as unknown[]).length).toBe(2);
    expect(body2.hasMore).toBe(false);
  });

  it("stat totals count every seeded case, not just the current page", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases?limit=1&offset=0",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect((body.data as unknown[]).length).toBe(1);
    // Only this tenant's 5 seeded cases exist (fresh random TENANT), so the
    // stats must reflect all 5 even though only 1 row came back.
    expect(body.stats).toEqual({ major: 3, minor: 2, open: 3 });
  });

  it("rejects a limit above 200 (zod-validated)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/disciplinary-cases?limit=500",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/hrms/vigilance (GAP-HR-VIGILANCE-04/06)", () => {
  it("returns the real, stored caseNo for each major-case row", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance?limit=10",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === caseIds.major1);
    expect(row?.caseNo).toBe(caseNos.major1);
  });

  it("paginates with limit/offset over major cases (dropped excluded from the default visible total)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance?limit=1&offset=0",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect((body.data as unknown[]).length).toBe(1);
    // 3 seeded major cases, 1 of them dropped (hidden by default) -> visible
    // total is 2, so requesting 1 row with offset 0 must still say hasMore.
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(true);
  });

  it("stat buckets count every major case in the tenant; dropped counts toward total/closed even though hidden from the row list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance?limit=1&offset=0",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    const body = res.json();
    expect(body.stats).toEqual({ chargeMemoStage: 0, underInquiry: 1, closed: 2, total: 3 });
  });

  it("still returns nextHearing alongside the newly-added inquiryAppointedDate alias with the same value", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance?limit=10",
      headers: auth(HR_OFFICER_ACTOR, ["hr_officer"]),
    });
    const rows = res.json().data as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === caseIds.major1);
    expect(row).toBeTruthy();
    expect(row?.nextHearing).toEqual(row?.inquiryAppointedDate);
  });

  it("still 403s a non-HR role (role gate unchanged by the pagination change)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/vigilance",
      headers: auth(randomUUID(), ["manager"]),
    });
    expect(res.statusCode).toBe(403);
  });
});
