/**
 * SVC-121/122 -- GET /v1/hrms/nominations?employeeId=... read endpoint.
 * Asserts the endpoint returns ONLY the caller-tenant's nominations for the
 * given employee (RLS-safe), with the correct approval state and linked
 * training/session info. Tenant A and tenant B each seed nominations; tenant A
 * must never see tenant B's rows -- including when it asks for B's employee id.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { tenantStorage } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsTrainings, hrmsNominations } from "../src/modules/training/schema.js";
import { trainingSessions } from "../src/modules/training-admin/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const EMP_A = randomUUID(); // tenant A employee
const EMP_B = randomUUID(); // tenant B employee

function tok(tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
const trA = randomUUID();
const trA2 = randomUUID();
const trB = randomUUID();
const sessA = randomUUID();
const nomAApproved = randomUUID();
const nomAPending = randomUUID();
const nomB = randomUUID();

async function seedTenant(tenant: string, emp: string) {
  tenantStorage.enterWith({ tenantId: tenant });
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      values (${emp}::uuid, ${tenant}::uuid, ${"E-" + emp.slice(0, 8)}, 'Emp X',
              ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2020-01-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
}

beforeAll(async () => {
  app = await buildApp();
  await seedTenant(TENANT_A, EMP_A);
  await seedTenant(TENANT_B, EMP_B);

  tenantStorage.enterWith({ tenantId: TENANT_A });
  await db.transaction(async (tx) => {
    await tx.insert(hrmsTrainings).values({
      id: trA, tenantId: TENANT_A, title: "Ethics A", fromDate: "2026-03-01", toDate: "2026-03-02",
      venue: "Hall A", maxParticipants: 30, status: "planned", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsTrainings).values({
      id: trA2, tenantId: TENANT_A, title: "Safety A", fromDate: "2026-03-10", toDate: "2026-03-11",
      maxParticipants: 30, status: "planned", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(trainingSessions).values({
      id: sessA, tenantId: TENANT_A, trainingId: trA, title: "Batch A1",
      sessionDate: "2026-03-01", capacity: 10, status: "scheduled", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsNominations).values([
      { id: nomAApproved, tenantId: TENANT_A, trainingId: trA, employeeId: EMP_A, sessionId: sessA,
        status: "approved", nominatedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
      { id: nomAPending, tenantId: TENANT_A, trainingId: trA2, employeeId: EMP_A,
        status: "nominated", nominatedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  });

  tenantStorage.enterWith({ tenantId: TENANT_B });
  await db.transaction(async (tx) => {
    await tx.insert(hrmsTrainings).values({
      id: trB, tenantId: TENANT_B, title: "Ethics B", fromDate: "2026-04-01", toDate: "2026-04-02",
      maxParticipants: 30, status: "planned", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsNominations).values(
      { id: nomB, tenantId: TENANT_B, trainingId: trB, employeeId: EMP_B,
        status: "waitlisted", nominatedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR },
    );
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/nominations -- my nominations (RLS-safe)", () => {
  it("returns only the caller-tenant's nominations for the employee, with approval state + training info", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/nominations?employeeId=${EMP_A}`,
      headers: bare(tok(TENANT_A)),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(nomAApproved);
    expect(ids).toContain(nomAPending);
    expect(ids).not.toContain(nomB);

    const approved = rows.find((r) => r.id === nomAApproved)!;
    expect(approved.approvalState).toBe("approved");
    expect(approved.trainingTitle).toBe("Ethics A");
    expect(approved.venue).toBe("Hall A");
    expect(approved.sessionTitle).toBe("Batch A1");

    const pending = rows.find((r) => r.id === nomAPending)!;
    expect(pending.approvalState).toBe("pending"); // "nominated" -> pending
  });

  it("RLS: tenant A querying tenant B's employee id sees nothing (no cross-tenant leak)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/nominations?employeeId=${EMP_B}`,
      headers: bare(tok(TENANT_A)),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(0);
  });

  it("symmetry: tenant B sees only its own waitlisted nomination", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/hrms/nominations?employeeId=${EMP_B}`,
      headers: bare(tok(TENANT_B)),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(nomB);
    expect(rows[0].approvalState).toBe("waitlisted");
  });

  it("400s when employeeId is not a uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/nominations?employeeId=not-a-uuid", headers: bare(tok(TENANT_A)) });
    expect(res.statusCode).toBe(400);
  });
});
