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
import { queue } from "../src/shared/infra.js";
import { registerF3_training_admin_Consumers } from "../src/modules/training-admin/f3-consumer.js";

// These routes answer 200/201 as soon as the write is QUEUED; the real database write
// happens in the F3 consumer, which buildApp() does NOT register (only worker.ts does).
// Without registering + draining it here the suite asserted only the optimistic HTTP
// response, so the consumer could crash on undefined locals and nothing would notice.
registerF3_training_admin_Consumers(queue);
async function drainF3() {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
function f3Dlq() {
  return (queue as unknown as import("@civitasone/queue").MemoryQueue).dlq;
}
import { hrmsTrainings, hrmsNominations } from "../src/modules/training/schema.js";
import { trainingSessions, sessionAttendance } from "../src/modules/training-admin/schema.js";
import { COMMANDS } from "../src/topics.js";
import { eq, and } from "drizzle-orm";

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
    await drainF3();
    expect(res.statusCode).toBe(201);
    expect(res.json().capacity).toBe(1);
    sessionId = res.json().id;
  });
});

describe("nomination approval — maker-checker + waitlist", () => {
  it("rejects approval by the nominator (maker == checker)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomA}/approve`,
      headers: auth(tok(NOM)), payload: { sessionId } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("approves the first nomination into the single seat", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomA}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(res.json().waitlistPosition).toBeNull();
  });

  it("waitlists the second nomination once capacity is full", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomB}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("waitlisted");
    expect(res.json().waitlistPosition).toBe(1);
  });

  it("promotes the waitlisted nomination when the seat is freed", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomA}/reject`, headers: bare(tok(CHECKER)) });
    await drainF3();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
    expect(res.json().promoted).toBe(nomB);
  });
});

describe("attendance capture", () => {
  it("marks attendance and returns a summary", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${sessionId}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_B, status: "present" } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    // idempotent upsert — re-mark same employee as absent
    res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${sessionId}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_B, status: "absent" } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    res = await app.inject({ method: "POST", url: `/v1/hrms/sessions/${sessionId}/attendance`,
      headers: auth(tok(CHECKER)), payload: { employeeId: EMP_A, status: "present" } });
    await drainF3();
    expect(res.statusCode).toBe(201);

    res = await app.inject({ method: "GET", url: `/v1/hrms/sessions/${sessionId}/attendance`, headers: bare(tok(CHECKER)) });
    await drainF3();
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
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
});

describe("route guards", () => {
  it("404s approving a missing nomination", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${randomUUID()}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("404s approving into a missing session", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomC}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId: randomUUID() } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("409s approving an already-decided nomination", async () => {
    // nomB was promoted to approved earlier.
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${nomB}/approve`,
      headers: auth(tok(CHECKER)), payload: { sessionId } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
  it("404s rejecting a missing nomination", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/nominations/${randomUUID()}/reject`, headers: bare(tok(CHECKER)) });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("404s creating a session on a missing training", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/trainings/${randomUUID()}/sessions`,
      headers: auth(tok(CHECKER)), payload: { title: "x", sessionDate: "2026-02-01" } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("400s an invalid session payload (validation branch)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/trainings/${trainingId}/sessions`,
      headers: auth(tok(CHECKER)), payload: { title: "", sessionDate: "not-a-date" } });
    await drainF3();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// F3 write-consumer regression tests.
//
// The routes above answer 200/201 the moment the command is queued, so a crash in
// the consumer is invisible to them (and the assertions they DO make are further
// masked by routes.ts returning publishF3Write's ACK envelope instead of the real
// row — `capacity`/`status` come back undefined regardless of this consumer).
//
// These tests therefore drive the consumer directly, which is the only place the
// write actually happens. Before the fix each case below threw a ReferenceError on
// an undefined local (`sid`, `outcome`/`waitlistPosition`, `freedApproved`/`sessionId`)
// and landed in the DLQ having written nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe("F3 write consumer — training-admin", () => {
  const S_TRAINING = randomUUID();
  const S_SESSION = randomUUID();
  const S_EMP1 = randomUUID();
  const S_EMP2 = randomUUID();
  const S_NOM1 = randomUUID();
  const S_NOM2 = randomUUID();

  async function publishF3(op: string, id: string, params: Record<string, unknown>, body: Record<string, unknown> = {}) {
    tenantStorage.enterWith({ tenantId: TENANT });
    await queue.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(),
      type: COMMANDS.f3RouteWrite,
      tenantId: TENANT,
      actorId: CHECKER,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { op, id, tenantId: TENANT, body, params, query: {} },
    });
    await drainF3();
  }

  beforeAll(async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await db.transaction(async (tx) => {
      for (const [eid, name] of [[S_EMP1, "F3 Emp 1"], [S_EMP2, "F3 Emp 2"]] as const) {
        await tx.execute(sql`insert into employee.hrms_employees
          (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
          values (${eid}::uuid, ${TENANT}::uuid, ${"F3-" + eid.slice(0, 8)}, ${name},
                  ${randomUUID()}::uuid, ${randomUUID()}::uuid, '2020-01-01', ${NOM}::uuid, ${NOM}::uuid)`);
      }
      await tx.insert(hrmsTrainings).values({
        id: S_TRAINING, tenantId: TENANT, title: "F3 Training", fromDate: "2026-03-01", toDate: "2026-03-02",
        maxParticipants: 30, status: "planned", createdBy: NOM, updatedBy: NOM,
      });
    });
    f3Dlq().length = 0;
  });

  it("training_admin_routes__0 — actually inserts the session, keyed by the id the route returned", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("training_admin_routes__0", S_SESSION, { id: S_TRAINING },
      { title: "F3 Batch", sessionDate: "2026-03-01", capacity: 1 });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(trainingSessions)
      .where(and(eq(trainingSessions.tenantId, TENANT), eq(trainingSessions.id, S_SESSION))));
    expect(rows).toHaveLength(1);
    // trainingId must come from the :id path param, not from the message id.
    expect(rows[0]!.trainingId).toBe(S_TRAINING);
    expect(rows[0]!.capacity).toBe(1);
    expect(rows[0]!.status).toBe("scheduled");
  });

  it("training_admin_routes__0 — reapplies the route's Zod default for capacity", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    const sid = randomUUID();
    await publishF3("training_admin_routes__0", sid, { id: S_TRAINING },
      { title: "F3 No Capacity", sessionDate: "2026-03-05" });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(trainingSessions)
      .where(and(eq(trainingSessions.tenantId, TENANT), eq(trainingSessions.id, sid))));
    expect(rows[0]!.capacity).toBe(30);
  });

  it("training_admin_routes__1 — approves into the seat, then waitlists once capacity is full", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await db.transaction(async (tx) => {
      await tx.insert(hrmsNominations).values([
        { id: S_NOM1, tenantId: TENANT, trainingId: S_TRAINING, employeeId: S_EMP1, status: "nominated", nominatedBy: NOM, createdBy: NOM, updatedBy: NOM },
        { id: S_NOM2, tenantId: TENANT, trainingId: S_TRAINING, employeeId: S_EMP2, status: "nominated", nominatedBy: NOM, createdBy: NOM, updatedBy: NOM },
      ]);
    });

    // Session capacity is 1, so the first approval takes the seat...
    await publishF3("training_admin_routes__1", randomUUID(), { id: S_NOM1 }, { sessionId: S_SESSION });
    expect(f3Dlq()).toHaveLength(0);
    let rows = await db.transaction((tx) => tx.select().from(hrmsNominations)
      .where(and(eq(hrmsNominations.tenantId, TENANT), eq(hrmsNominations.id, S_NOM1))));
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.waitlistPosition).toBeNull();

    // ...and the second is waitlisted at position 1.
    await publishF3("training_admin_routes__1", randomUUID(), { id: S_NOM2 }, { sessionId: S_SESSION });
    expect(f3Dlq()).toHaveLength(0);
    rows = await db.transaction((tx) => tx.select().from(hrmsNominations)
      .where(and(eq(hrmsNominations.tenantId, TENANT), eq(hrmsNominations.id, S_NOM2))));
    expect(rows[0]!.status).toBe("waitlisted");
    expect(rows[0]!.waitlistPosition).toBe(1);
  });

  it("training_admin_routes__2 — rejecting the seated nomination promotes the waitlisted one", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("training_admin_routes__2", randomUUID(), { id: S_NOM1 }, {});
    expect(f3Dlq()).toHaveLength(0);

    const rejected = await db.transaction((tx) => tx.select().from(hrmsNominations)
      .where(and(eq(hrmsNominations.tenantId, TENANT), eq(hrmsNominations.id, S_NOM1))));
    expect(rejected[0]!.status).toBe("rejected");

    // freedApproved was true (the nomination was 'approved' before the reject), so the
    // waitlisted candidate is promoted into the freed seat.
    const promoted = await db.transaction((tx) => tx.select().from(hrmsNominations)
      .where(and(eq(hrmsNominations.tenantId, TENANT), eq(hrmsNominations.id, S_NOM2))));
    expect(promoted[0]!.status).toBe("approved");
    expect(promoted[0]!.waitlistPosition).toBeNull();
  });

  it("training_admin_routes__3 — records attendance against the :id session", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("training_admin_routes__3", randomUUID(), { id: S_SESSION }, { employeeId: S_EMP1, status: "absent" });
    expect(f3Dlq()).toHaveLength(0);

    const rows = await db.transaction((tx) => tx.select().from(sessionAttendance)
      .where(and(eq(sessionAttendance.tenantId, TENANT), eq(sessionAttendance.sessionId, S_SESSION))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.employeeId).toBe(S_EMP1);
    expect(rows[0]!.status).toBe("absent");
  });
});
