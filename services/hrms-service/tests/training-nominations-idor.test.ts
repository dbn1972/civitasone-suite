/**
 * Training nominations — IDOR regression (real DB, no mocks).
 *
 * Audit finding: GET/POST /v1/hrms/nominations took a client-supplied
 * employeeId with no check against the caller's real identity, despite a
 * comment on the GET route claiming "an employee's own nominations".
 * hrms_nominations.employeeId is an hrms_employees.id (schema.ts), NOT the
 * caller's JWT `sub` (ctx.actorId) -- a different id space (see
 * employee/actor-link.ts). This seeds employees with employeeId
 * deliberately different from their actor id (exactly like the real
 * onboarding flow) and drives the real HTTP routes end-to-end, mirroring
 * apar-identity-resolution.test.ts's approach for the same class of bug.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import { hrmsTrainings, hrmsNominations } from "../src/modules/training/schema.js";
import { registerTrainingConsumers } from "../src/modules/training/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-training-idor" }, SECRET, 3600);
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

// Actor ids (JWT `sub`) -- deliberately random and UNRELATED to any
// hrms_employees.id below; only each employee row's `userRef` ties them
// together, exactly like a real onboarded user.
const ALICE_ACTOR = randomUUID();
const CAROL_ACTOR = randomUUID();
const HR_ACTOR = randomUUID();

let app: FastifyInstance;
let aliceEmpId: string;
let carolEmpId: string;
let trainingId: string;
let nominationId: string;

const settle = () => new Promise<void>((r) => setTimeout(r, 300));

beforeAll(async () => {
  app = await buildApp();
  registerTrainingConsumers(queue);
  await queue.start();

  aliceEmpId = await seedEmployee({ userRef: ALICE_ACTOR, fullName: "Alice Employee", createdBy: HR_ACTOR });
  carolEmpId = await seedEmployee({ userRef: CAROL_ACTOR, fullName: "Carol Outsider", createdBy: HR_ACTOR });

  trainingId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsTrainings).values({
    id: trainingId, tenantId: TENANT, title: "Ethics Training",
    fromDate: "2026-03-01", toDate: "2026-03-02", maxParticipants: 30,
    status: "planned", createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));

  nominationId = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsNominations).values({
    id: nominationId, tenantId: TENANT, trainingId, employeeId: aliceEmpId,
    status: "nominated", createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("training nominations — real-DB identity resolution (employeeId is hrms_employees.id, not actorId)", () => {
  it("sanity: seeded employeeId genuinely differs from the actor's own JWT sub", () => {
    expect(aliceEmpId).not.toBe(ALICE_ACTOR);
    expect(carolEmpId).not.toBe(CAROL_ACTOR);
  });

  it("GET /v1/hrms/nominations: employee sees her OWN nominations when she asks for her own id", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/nominations?employeeId=${aliceEmpId}`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toContain(nominationId);
  });

  it("GET /v1/hrms/nominations: IDOR closed — Carol asking for Alice's employeeId is forced onto her OWN (empty) list", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/nominations?employeeId=${aliceEmpId}`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as Array<{ id: string }>).map((n) => n.id);
    expect(ids).not.toContain(nominationId);
  });

  it("GET /v1/hrms/nominations: HR can still look up an arbitrary employee's nominations (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/nominations?employeeId=${aliceEmpId}`,
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as Array<{ id: string }>).map((n) => n.id);
    expect(ids).toContain(nominationId);
  });

  it("POST /v1/hrms/nominations: FK check rejects a non-existent trainingId (orphaned-record guard)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/nominations",
      headers: auth(ALICE_ACTOR, ["employee"]),
      payload: { trainingId: randomUUID(), employeeId: aliceEmpId },
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /v1/hrms/nominations: FK check rejects a non-existent employeeId (orphaned-record guard)", async () => {
    // Must be an HR caller here: a non-HR caller's employeeId is forced onto
    // their OWN (real, valid) resolved id by the self-scoping fix above, so
    // a bare "employee" caller could never actually reach the FK check with
    // a bogus employeeId -- only HR passes an arbitrary employeeId through
    // unchanged, which is what this specific guard needs to exercise.
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/nominations",
      headers: auth(HR_ACTOR, ["hr_admin"]),
      payload: { trainingId, employeeId: randomUUID() },
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST /v1/hrms/nominations: IDOR closed — Carol submitting Alice's employeeId creates the nomination for CAROL, not Alice", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/nominations",
      headers: auth(CAROL_ACTOR, ["employee"]),
      payload: { trainingId, employeeId: aliceEmpId },
    });
    expect(r.statusCode).toBe(202);
    await settle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const carolRows = await withTenantScope(db, TENANT, (tx: any) => tx.select().from(hrmsNominations)
      .where(and(eq(hrmsNominations.tenantId, TENANT), eq(hrmsNominations.trainingId, trainingId), eq(hrmsNominations.employeeId, carolEmpId))));
    expect(carolRows.length).toBe(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aliceRows = await withTenantScope(db, TENANT, (tx: any) => tx.select().from(hrmsNominations)
      .where(and(eq(hrmsNominations.tenantId, TENANT), eq(hrmsNominations.trainingId, trainingId), eq(hrmsNominations.employeeId, aliceEmpId))));
    // Alice still only has her original seeded nomination -- Carol's attempted
    // on-behalf-of submission did not create a second row under Alice's id.
    expect(aliceRows.length).toBe(1);
  });

  it("POST /v1/hrms/nominations: HR can still nominate an arbitrary employee (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/nominations",
      headers: auth(HR_ACTOR, ["hr_admin"]),
      payload: { trainingId, employeeId: aliceEmpId },
    });
    expect(r.statusCode).toBe(202);
  });

  it("POST /v1/hrms/nominations: a non-HR caller with no linked employee record is rejected, not silently accepted", async () => {
    const GHOST_ACTOR = randomUUID(); // never seeded as an hrms_employees row
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/nominations",
      headers: auth(GHOST_ACTOR, ["employee"]),
      payload: { trainingId, employeeId: aliceEmpId },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NO_EMPLOYEE_LINK");
  });
});
