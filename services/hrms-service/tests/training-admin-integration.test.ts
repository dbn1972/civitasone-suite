/**
 * SVC-121 training administration — integration tests through the real Fastify
 * app + DB. Covers session scheduling with capacity, the nomination approval
 * maker-checker gate (approver != nominator), waitlisting past capacity,
 * waitlist promotion on a freed seat, and attendance capture + summary.
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

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const NOM     = "d2222222-0000-4000-8000-000000000001"; // nominator (maker)
const CHECKER = "d3333333-0000-4000-8000-000000000002"; // approver (checker)
const EMP_A = randomUUID();
const EMP_B = randomUUID();
const EMP_C = randomUUID();

function tok(actor: string) {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
const trainingId = randomUUID();
const nomA = randomUUID();
const nomB = randomUUID();
const nomC = randomUUID();
let sessionId: string;

beforeAll(async () => {
  app = await buildApp();
  // Seed a training and two fresh nominations (nominated by NOM).
  tenantStorage.enterWith({ tenantId: TENANT });
  await db.transaction(async (tx) => {
    // Employees must exist — hrms_nominations.employee_id FKs employee.hrms_employees.
    for (const [eid, name] of [[EMP_A, "Emp A"], [EMP_B, "Emp B"], [EMP_C, "Emp C"]] as const) {
      await tx.execute(sql`insert into employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
        values (${eid}::uuid, ${TENANT}::uuid, ${"E-" + eid.slice(0, 8)}, ${name},
                ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2020-01-01', ${NOM}::uuid, ${NOM}::uuid)`);
    }
    await tx.insert(hrmsTrainings).values({
      id: trainingId, tenantId: TENANT, title: "Ethics", fromDate: "2026-02-01", toDate: "2026-02-02",
      maxParticipants: 30, status: "planned", createdBy: NOM, updatedBy: NOM,
    });
    await tx.insert(hrmsNominations).values([
      { id: nomA, tenantId: TENANT, trainingId, employeeId: EMP_A, status: "nominated", nominatedBy: NOM, createdBy: NOM, updatedBy: NOM },
      { id: nomB, tenantId: TENANT, trainingId, employeeId: EMP_B, status: "nominated", nominatedBy: NOM, createdBy: NOM, updatedBy: NOM },
      { id: nomC, tenantId: TENANT, trainingId, employeeId: EMP_C, status: "nominated", nominatedBy: NOM, createdBy: NOM, updatedBy: NOM },
    ]);
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("session scheduling", () => {
  it("creates a session with capacity 1", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/trainings/${trainingId}/sessions`,
      headers: auth(tok(CHECKER)), payload: { title: "Batch 1", sessionDate: "2026-02-01", capacity: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().capacity).toBe(1);
    sessionId = res.json().id;
  });
});

describe("nomination approval — maker-checker + waitlist", () => {
  it("rejects approval by the nominator (maker == checker)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomA}/approve`,
      headers: auth(tok(NOM)), payload: { sessionId } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("approves the first nomination into the single seat", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomA}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(res.json().waitlistPosition).toBeNull();
  });

  it("waitlists the second nomination once capacity is full", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomB}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("waitlisted");
    expect(res.json().waitlistPosition).toBe(1);
  });

  it("promotes the waitlisted nomination when the seat is freed", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomA}/reject`, headers: bare(tok(CHECKER)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
    expect(res.json().promoted).toBe(nomB);
  });
});

describe("attendance capture", () => {
  it("marks attendance and returns a summary", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${sessionId}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_B, status: "present" } });
    expect(res.statusCode).toBe(201);
    // idempotent upsert — re-mark same employee as absent
    res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${sessionId}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_B, status: "absent" } });
    expect(res.statusCode).toBe(201);
    res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${sessionId}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_A, status: "present" } });
    expect(res.statusCode).toBe(201);

    res = await app.inject({ method: "GET", url: `/v1/hrms/sessions/${sessionId}/attendance`, headers: bare(tok(CHECKER)) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records.length).toBe(2); // upsert kept it at 2 distinct employees
    expect(body.summary.total).toBe(2);
    expect(body.summary.present).toBe(1);
    expect(body.summary.absent).toBe(1);
  });

  it("404s attendance for an unknown session", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${randomUUID()}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_A } });
    expect(res.statusCode).toBe(404);
  });
});

describe("route guards", () => {
  it("404s approving a missing nomination", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${randomUUID()}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    expect(res.statusCode).toBe(404);
  });
  it("404s approving into a missing session", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomC}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId: randomUUID() } });
    expect(res.statusCode).toBe(404);
  });
  it("409s approving an already-decided nomination", async () => {
    // nomB was promoted to approved earlier.
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomB}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
  it("404s rejecting a missing nomination", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${randomUUID()}/reject`, headers: bare(tok(CHECKER)) });
    expect(res.statusCode).toBe(404);
  });
  it("404s creating a session on a missing training", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/trainings/${randomUUID()}/sessions`,
      headers: auth(tok(CHECKER)), payload: { title: "x", sessionDate: "2026-02-01" } });
    expect(res.statusCode).toBe(404);
  });
  it("400s an invalid session payload (validation branch)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/trainings/${trainingId}/sessions`,
      headers: auth(tok(CHECKER)), payload: { title: "", sessionDate: "not-a-date" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
