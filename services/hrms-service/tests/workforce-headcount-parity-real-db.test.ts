/**
 * GAP2-HRMS-WORKFORCE-01 — headcount population parity (real DB, no mocks).
 *
 * GET /v1/hrms/workforce/headcount must count the SAME population in all three
 * groupBy branches so the web's "Total Headcount" (the sum of a tab's
 * breakdown) is identical regardless of which tab is open.
 *
 * The bug: the department/grade branches used an INNER JOIN to
 * hrms_departments / hrms_designations. hrms_employees has no FK constraints,
 * so an employee whose department_id/designation_id points at a since-deleted
 * master row (reachable after a permitted department delete — the delete guard
 * excludes retired/terminated, but headcount counts them) was silently DROPPED
 * from those two tabs, while the join-free `type` branch still counted it. The
 * three tabs then reported three different totals for one workforce.
 *
 * This seeds a tenant with N non-separated employees where one is `retired`
 * with a department_id/designation_id that match no master row (orphaned, as
 * left behind after a permitted department delete) and asserts the three
 * totals are equal. On the OLD code department/grade are short by the orphan
 * while type is complete, so this FAILS pre-fix and PASSES after the LEFT JOIN
 * / COALESCE-bucket fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function auth(roles: string[]): { authorization: string } {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-wf-headcount" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();

  await withTenantScope(db, TENANT, async (tx) => {
    const deptId = randomUUID();
    await tx.insert(hrmsDepartments).values({
      id: deptId, tenantId: TENANT, code: "ENG", name: "Engineering",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    const desigId = randomUUID();
    await tx.insert(hrmsDesignations).values({
      id: desigId, tenantId: TENANT, code: "MGR", name: "Manager", level: 4,
      payGrade: "L4", createdBy: ACTOR, updatedBy: ACTOR,
    });

    // Two normal confirmed employees with valid dept/designation.
    await tx.insert(hrmsEmployees).values([
      {
        id: randomUUID(), tenantId: TENANT, employeeNo: "WF-1", fullName: "Alice Normal",
        departmentId: deptId, designationId: desigId, dateOfJoining: "2015-01-01",
        employeeType: "permanent", status: "confirmed", createdBy: ACTOR, updatedBy: ACTOR,
      },
      {
        id: randomUUID(), tenantId: TENANT, employeeNo: "WF-2", fullName: "Bob Normal",
        departmentId: deptId, designationId: desigId, dateOfJoining: "2016-01-01",
        employeeType: "permanent", status: "confirmed", createdBy: ACTOR, updatedBy: ACTOR,
      },
      // Orphaned-FK employee: retired, with department_id/designation_id that
      // match NO master row (as left behind after a permitted department
      // delete). Non-separated, so headcount counts it; the INNER-JOIN
      // department/grade branches used to drop it.
      {
        id: randomUUID(), tenantId: TENANT, employeeNo: "WF-ORPHAN", fullName: "Carol Retired",
        departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2000-01-01",
        employeeType: "permanent", status: "retired", createdBy: ACTOR, updatedBy: ACTOR,
      },
    ]);
  });
});

afterAll(async () => {
  await app.close();
});

async function total(groupBy: string): Promise<number> {
  const r = await app.inject({
    method: "GET", url: `/v1/hrms/workforce/headcount?groupBy=${groupBy}`,
    headers: auth(["hr_admin"]),
  });
  expect(r.statusCode).toBe(200);
  return r.json().data.total as number;
}

describe("GET /v1/hrms/workforce/headcount — population parity (GAP2-HRMS-WORKFORCE-01)", () => {
  it("counts the same N (incl. an orphaned-FK retired employee) across type/department/grade", async () => {
    const byType = await total("type");
    const byDept = await total("department");
    const byGrade = await total("grade");

    // 3 non-separated employees seeded (incl. the orphan). The `type` branch
    // never joined, so it has always been complete.
    expect(byType).toBe(3);
    // The fix makes department/grade equal to type (they used to be 2).
    expect(byDept).toBe(byType);
    expect(byGrade).toBe(byType);
  });

  it("buckets the orphaned-FK employee under 'unassigned'/'ungraded' rather than dropping it", async () => {
    const rDept = await app.inject({
      method: "GET", url: "/v1/hrms/workforce/headcount?groupBy=department",
      headers: auth(["hr_admin"]),
    });
    const deptKeys = (rDept.json().data.breakdown as { group_key: string }[]).map((b) => b.group_key);
    expect(deptKeys).toContain("unassigned");

    const rGrade = await app.inject({
      method: "GET", url: "/v1/hrms/workforce/headcount?groupBy=grade",
      headers: auth(["hr_admin"]),
    });
    const gradeKeys = (rGrade.json().data.breakdown as { group_key: string }[]).map((b) => b.group_key);
    expect(gradeKeys).toContain("ungraded");
  });
});
