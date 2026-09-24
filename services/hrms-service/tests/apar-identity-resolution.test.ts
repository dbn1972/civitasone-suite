/**
 * APAR — real-DB identity-resolution regression (no mocks).
 *
 * PR #1535 code review finding: resolveAparReadScope / stageOwner /
 * assertStageOwner compared `ctx.actorId` (the JWT `sub`) directly against
 * `hrms_appraisals.employeeId` / `reportingOfficerId` / etc, assuming actor
 * ids and these columns share one identity space. They don't:
 *
 *  - `employeeId` (and the three officer-id columns) hold an
 *    `hrms_employees.id` -- the row HR picked via the employee-picker UI
 *    (apps/web's `hr/apar/new/page.tsx` posts `emp.id`) -- and both insert
 *    paths (apar/f3-consumer.ts's apar_routes__0, appraisals/consumer.ts)
 *    store whatever UUID the POST body contained, verbatim.
 *  - The actor<->employee link instead lives on `hrms_employees.userRef`,
 *    resolved by employee/actor-link.ts's `resolveEmployeeForActor` -- the
 *    pattern self-service/routes.ts and employee/routes.ts's
 *    `resolveManagerScope` already used correctly for every OTHER
 *    actor-facing lookup in this module.
 *
 * apar-routes.test.ts (the existing PR's own test file) mocks the DB
 * entirely and sets `employeeId = actorId` directly in its fixtures, so it
 * could never have caught this. This file instead seeds REAL rows into a
 * real Postgres (via `withTenantScope`, the same real-DB seeding helper
 * apar-nested-tx-deadlock.test.ts already uses) with `employeeId`
 * deliberately DIFFERENT from the acting actor's JWT `sub` -- exactly the
 * shape the real create-APAR flow produces -- then drives the REAL HTTP
 * routes (`app.inject`, no mocks anywhere in this file) to prove the fix
 * end-to-end: read-scope (list + detail) AND the stage-transition
 * ownership chain (`assertStageOwner`), for both the employeeId path and
 * the reportingOfficerId path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsAppraisals } from "../src/modules/appraisals/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenant per run: every query in this module is tenant-scoped, so this
// gives the test hermetic isolation from any other data in the shared dev
// DB (including other worktrees/agents) without needing explicit cleanup --
// same convention apar-nested-tx-deadlock.test.ts uses.
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-apar-identity" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(opts: {
  userRef: string; fullName: string; createdBy: string; managerId?: string;
}): Promise<string> {
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
    ...(opts.managerId ? { managerId: opts.managerId } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedAppraisal(opts: {
  employeeId: string;
  reportingOfficerId?: string;
  reviewingOfficerId?: string;
  acceptingAuthorityId?: string;
  status: string;
  createdBy: string;
}): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsAppraisals).values({
    id, tenantId: TENANT, employeeId: opts.employeeId,
    appraisalPeriod: "2026-27", status: opts.status,
    reportingOfficerId: opts.reportingOfficerId ?? randomUUID(),
    reviewingOfficerId: opts.reviewingOfficerId ?? randomUUID(),
    acceptingAuthorityId: opts.acceptingAuthorityId ?? randomUUID(),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

// Actor ids (JWT `sub`) -- deliberately random and UNRELATED to any
// hrms_employees.id below; only each employee row's `userRef` ties them
// together, exactly like a real onboarded user.
const ALICE_ACTOR = randomUUID();
const BOB_ACTOR = randomUUID();
const CAROL_ACTOR = randomUUID(); // never linked to Alice's appraisal at all

let app: FastifyInstance;
let aliceEmpId: string;
let bobEmpId: string;

beforeAll(async () => {
  app = await buildApp();
  // Bob is Alice's people-manager (hrms_employees.managerId) AND her APAR
  // reporting officer (hrms_appraisals.reportingOfficerId) -- two distinct
  // relationships in this domain, both exercised below.
  bobEmpId = await seedEmployee({ userRef: BOB_ACTOR, fullName: "Bob Reporting-Officer", createdBy: BOB_ACTOR });
  aliceEmpId = await seedEmployee({ userRef: ALICE_ACTOR, managerId: bobEmpId, fullName: "Alice Employee", createdBy: ALICE_ACTOR });
  await seedEmployee({ userRef: CAROL_ACTOR, fullName: "Carol Outsider", createdBy: CAROL_ACTOR });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("APAR — real-DB identity resolution (employeeId is hrms_employees.id, not actorId)", () => {
  it("sanity: seeded employeeId genuinely differs from the actor's own JWT sub", () => {
    // This is the exact real-world condition PR #1535's resolveAparReadScope
    // got wrong (and that apar-routes.test.ts's employeeId===actorId
    // fixtures could never exercise).
    expect(aliceEmpId).not.toBe(ALICE_ACTOR);
    expect(bobEmpId).not.toBe(BOB_ACTOR);
  });

  it("employee sees her own appraisal in the list, even though employeeId !== her actorId", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth(ALICE_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(aparId);
  });

  it("employee sees her own appraisal by GET /:id, even though employeeId !== her actorId", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${aparId}`, headers: auth(ALICE_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().appraisal.id).toBe(aparId);
    expect(r.json().appraisal.employeeId).toBe(aliceEmpId);
  });

  it("an unrelated employee (Carol) gets 404 on Alice's appraisal by id -- no leak", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${aparId}`, headers: auth(CAROL_ACTOR, ["employee"]) });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
  });

  it("Bob (real people-manager) sees Alice's appraisal via the manager scope (hrms_employees.managerId)", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth(BOB_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(aparId);
  });

  it("Carol (not Alice's manager) does NOT see Alice's appraisal via the manager scope", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: auth(CAROL_ACTOR, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(aparId);
  });

  it("Alice can submit her OWN self-appraisal end-to-end (assertStageOwner resolves the employeeId path)", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/apar/${aparId}/self-appraisal`,
      headers: auth(ALICE_ACTOR, ["employee"]), payload: { selfAppraisal: "Delivered the Q4 rollout on schedule." },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("reporting_officer");
  });

  it("Carol (not the appraisee) cannot submit Alice's self-appraisal", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "self_pending", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/apar/${aparId}/self-appraisal`,
      headers: auth(CAROL_ACTOR, ["employee"]), payload: { selfAppraisal: "not mine to submit" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
  });

  it("Bob (real reporting officer) can score the reporting stage end-to-end (assertStageOwner resolves the reportingOfficerId path)", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "reporting_officer", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/apar/${aparId}/reporting`,
      headers: auth(BOB_ACTOR, ["manager"]),
      payload: {
        penPicture: "Consistently strong delivery.",
        scores: [{ attribute: "integrity", weight: 60, score: 9 }, { attribute: "leadership", weight: 40, score: 8 }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("reviewing_officer");
  });

  it("Carol (not the reporting officer) cannot score the reporting stage", async () => {
    const aparId = await seedAppraisal({
      employeeId: aliceEmpId, reportingOfficerId: bobEmpId, status: "reporting_officer", createdBy: BOB_ACTOR,
    });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/apar/${aparId}/reporting`,
      headers: auth(CAROL_ACTOR, ["manager"]),
      payload: { penPicture: "x", scores: [{ attribute: "integrity", weight: 100, score: 5 }] },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_STAGE_OWNER");
  });
});
