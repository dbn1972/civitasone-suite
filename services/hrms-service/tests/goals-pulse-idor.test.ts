/**
 * Goal check-ins + pulse surveys — IDOR / missing-role-gate regression
 * (real DB, no mocks).
 *
 * Audit findings:
 *  - GET /v1/hrms/goals/:id/checkins had no requireRole call and no
 *    ownership filter beyond goal_id/tenant_id -- any authenticated tenant
 *    user could read any employee's goal check-in notes by UUID. Fixed to
 *    mirror POST .../checkin's existing ownership check (both keyed on
 *    ctx.actorId directly -- hrms.goals.employee_id is NOT an
 *    hrms_employees.id, verified via the real INSERT path in
 *    POST /v1/hrms/goals; see the comment on the route itself).
 *  - POST /v1/hrms/pulse-surveys had no requireRole despite its own comment
 *    claiming "(HR admin)" -- any authenticated user could create org-wide
 *    surveys.
 *  - GET /v1/hrms/pulse-surveys/:id/results had no requireRole, risking
 *    de-anonymization of a supposedly-anonymous survey.
 *
 * NOTE on test infra: hrms.goals / hrms.goal_checkins have FORCE ROW LEVEL
 * SECURITY (migrations/0123_rls_completeness.sql). This module's raw
 * sqlPool/sqlClient queries are NOT wrapped by wrapWithTenantGuc (that only
 * wraps Drizzle's db.transaction()) and this route file never sets
 * app.tenant_id itself -- confirmed by directly probing POST /v1/hrms/goals,
 * which 500s with "new row violates row-level security policy for table
 * goals" against a real DB. That is a genuine, separate, pre-existing bug
 * (flagged separately, out of scope for this PR) -- unrelated to the IDOR
 * fix under test here. To make this route's OWN queries usable at all in a
 * real-DB test, a session-level app.tenant_id is set once via the exact
 * sqlPool/sqlClient singleton the route imports (postgres.js reuses one
 * connection under this file's sequential, non-concurrent test execution --
 * empirically verified). Fixtures are still seeded transactionally (LOCAL
 * GUC, the same pattern gap-features/routes.ts's staffing-plan route uses)
 * so seeding does not depend on that connection-reuse assumption.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient, sqlPool } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-goals-idor" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedGoal(employeeActorId: string, title: string): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO hrms.goals (id, tenant_id, employee_id, title, description, category, key_results, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', 'individual', '[]', NOW(), NOW())`,
      [id, TENANT, employeeActorId, title],
    );
  });
  return id;
}

async function seedCheckin(goalId: string, employeeActorId: string, progress: number, note: string): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO hrms.goal_checkins (id, goal_id, tenant_id, employee_id, progress, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, goalId, TENANT, employeeActorId, progress, note],
    );
  });
  return id;
}

const ALICE_ACTOR = randomUUID();
const CAROL_ACTOR = randomUUID(); // attacker — has no relation to Alice's goal
const HR_ACTOR = randomUUID();

let app: FastifyInstance;
let aliceGoalId: string;
let aliceCheckinId: string;

beforeAll(async () => {
  app = await buildApp();

  aliceGoalId = await seedGoal(ALICE_ACTOR, "Ship the Q4 rollout");
  aliceCheckinId = await seedCheckin(aliceGoalId, ALICE_ACTOR, 40, "Kicked off design phase");

  // See file header: makes this route's own (unwrapped) sqlPool queries
  // usable for the app.inject calls below, independent of the separate
  // pre-existing GUC-wrapping gap.
  await sqlPool.query("SELECT set_config('app.tenant_id', $1, false)", [TENANT]);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/goals/:id/checkins — ownership + role gate", () => {
  it("legitimate access still works: Alice reads her OWN goal's check-in history", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/goals/${aliceGoalId}/checkins`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(aliceCheckinId);
  });

  it("IDOR closed: Carol (unrelated employee) cannot read Alice's goal check-ins by UUID", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/goals/${aliceGoalId}/checkins`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
  });

  it("role gate: an unrecognized role is rejected", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/goals/${aliceGoalId}/checkins`,
      headers: auth(CAROL_ACTOR, ["some_other_service_role"]),
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("POST /v1/hrms/pulse-surveys — role gate (comment claims HR admin; previously ungated)", () => {
  it("a bare employee cannot create an org-wide pulse survey", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/pulse-surveys",
      headers: auth(CAROL_ACTOR, ["employee"]),
      payload: { question: "How are you feeling about the new cafeteria menu?" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("HR can still create a pulse survey (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/pulse-surveys",
      headers: auth(HR_ACTOR, ["hr_admin"]),
      payload: { question: "How are you feeling about the new cafeteria menu?" },
    });
    expect(r.statusCode).toBe(201);
  });
});

describe("GET /v1/hrms/pulse-surveys/:id/results — role gate (previously ungated, de-anonymization risk)", () => {
  let surveyId: string;

  beforeAll(async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/pulse-surveys",
      headers: auth(HR_ACTOR, ["hr_admin"]),
      payload: { question: "Rate your work-life balance this quarter." },
    });
    surveyId = r.json().id;
  });

  it("a bare employee cannot read the (supposedly anonymous) results", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/pulse-surveys/${surveyId}/results`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
  });

  it("HR can still read the aggregated results (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/pulse-surveys/${surveyId}/results`,
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().surveyId).toBe(surveyId);
  });
});
