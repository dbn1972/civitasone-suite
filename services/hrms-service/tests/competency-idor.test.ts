/**
 * Competency profile / gap-analysis — IDOR regression (real DB, no mocks).
 *
 * Audit finding: GET .../employees/:id/profile and GET .../gap-analysis
 * took the target employee from the path/query with no ownership check --
 * any employee holding a colleague's hrms_employees.id (obtainable from
 * org-chart/leaderboard endpoints) could pull their competency profile.
 * Seeds employees with employeeId deliberately different from their actor
 * id (real onboarding shape) and drives the real HTTP routes end-to-end,
 * mirroring apar-identity-resolution.test.ts's approach for the same class
 * of bug. The write path (PUT .../employees/:id/competencies) was already
 * correctly HR-only and is intentionally not touched or retested here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { frameworks, competencies, roleRequirements, employeeCompetencies } from "../src/modules/competency/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-competency-idor" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(opts: { userRef: string; fullName: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT,
    employeeNo: `REG-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    userRef: opts.userRef,
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

const ALICE_ACTOR = randomUUID();
const CAROL_ACTOR = randomUUID();
const BOB_ACTOR = randomUUID(); // manager role, not HR
const HR_ACTOR = randomUUID();

let app: FastifyInstance;
let aliceEmpId: string;
let carolEmpId: string;
let competencyId: string;
const ROLE_CODE = "ROLE-TEST-1";

beforeAll(async () => {
  app = await buildApp();

  aliceEmpId = await seedEmployee({ userRef: ALICE_ACTOR, fullName: "Alice Employee", createdBy: HR_ACTOR });
  carolEmpId = await seedEmployee({ userRef: CAROL_ACTOR, fullName: "Carol Outsider", createdBy: HR_ACTOR });

  const frameworkId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(frameworks).values({
    id: frameworkId, tenantId: TENANT, name: "Core Framework", status: "active", createdBy: HR_ACTOR,
  }));

  competencyId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(competencies).values({
    id: competencyId, tenantId: TENANT, frameworkId, code: "COMP-1", name: "Test Competency",
    category: "technical", maxLevel: 5, certifiedLevel: 3,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(roleRequirements).values({
    id: randomUUID(), tenantId: TENANT, roleCode: ROLE_CODE, competencyId, requiredLevel: 3,
  }));

  // Alice holds this competency at level 2 -- a REAL achieved score, distinct
  // from the competency definition's maxLevel (5), so a passing gap-analysis
  // assertion below genuinely proves real data flowed through, not a
  // coincidence of both being the same number.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(employeeCompetencies).values({
    id: randomUUID(), tenantId: TENANT, employeeId: aliceEmpId, competencyId, currentLevel: 2, source: "manual",
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("competency profile/gap-analysis — real-DB identity resolution", () => {
  it("sanity: seeded employeeId genuinely differs from the actor's own JWT sub", () => {
    expect(aliceEmpId).not.toBe(ALICE_ACTOR);
    expect(carolEmpId).not.toBe(CAROL_ACTOR);
  });

  it("GET .../employees/:id/profile: employee sees her OWN profile", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/employees/${aliceEmpId}/profile`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ competencyId: string; currentLevel: number }>;
    expect(rows.some((row) => row.competencyId === competencyId && row.currentLevel === 2)).toBe(true);
  });

  it("GET .../employees/:id/profile: IDOR closed — Carol requesting Alice's id gets 404, not Alice's data", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/employees/${aliceEmpId}/profile`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET .../employees/:id/profile: manager can still read an arbitrary employee's profile (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/employees/${aliceEmpId}/profile`,
      headers: auth(BOB_ACTOR, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
  });

  it("GET .../employees/:id/profile: HR can still read an arbitrary employee's profile (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/employees/${aliceEmpId}/profile`,
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
  });

  it("GET .../gap-analysis: employee sees her OWN real gap analysis (held level 2 vs required 3)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/gap-analysis?employeeId=${aliceEmpId}&roleCode=${ROLE_CODE}`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.rows[0].heldLevel).toBe(2);
    expect(body.rows[0].requiredLevel).toBe(3);
    expect(body.rows[0].gap).toBe(1);
  });

  it("GET .../gap-analysis: IDOR closed — Carol requesting Alice's employeeId gets 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/gap-analysis?employeeId=${aliceEmpId}&roleCode=${ROLE_CODE}`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET .../gap-analysis: Carol can still read her OWN gap analysis (legitimate self-access still works)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/gap-analysis?employeeId=${carolEmpId}&roleCode=${ROLE_CODE}`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    // Carol holds nothing yet -- 0 held vs 3 required.
    expect(r.json().rows[0].heldLevel).toBe(0);
  });
});
