/**
 * Skills gap-analysis / 360 feedback / skills+work-summaries dumps — IDOR
 * and write-side gaming regression (real DB, no mocks).
 *
 * Audit findings (services/hrms-service/src/modules/gap-features/routes.ts):
 *  - GET /v1/hrms/skills/gap-analysis?employeeId= had no ownership check.
 *  - POST /v1/hrms/feedback/cycles/:id/nominate-raters let any employee
 *    nominate who rates a colleague.
 *  - POST /v1/hrms/feedback/responses let the caller self-attribute
 *    raterGroup and submit fabricated scores about anyone with no check
 *    they are an actually-nominated rater.
 *  - GET /v1/hrms/skills and GET /v1/hrms/work-summaries were org-wide list
 *    dumps with no employee filter.
 *
 * NOTE on test infra: employee.skill_assessments, employee.competencies,
 * employee.feedback_nominations (and siblings) have FORCE ROW LEVEL
 * SECURITY. This module's raw sqlPool/sqlClient queries are not wrapped by
 * wrapWithTenantGuc and the module never sets app.tenant_id itself --
 * confirmed by directly probing inserts against these tables, which fail
 * with "new row violates row-level security policy" against a real DB. This
 * is a genuine, separate, pre-existing bug (flagged separately, out of
 * scope for this PR). As in goals-pulse-idor.test.ts, a session-level
 * app.tenant_id is set once via the exact sqlPool/sqlClient singleton the
 * route imports so this module's own queries are usable for the app.inject
 * calls below; fixtures are still seeded transactionally (LOCAL GUC) so
 * seeding does not depend on connection-reuse behavior.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient, sqlPool } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function auth(sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: TENANT, roles, sid: "sess-feedback-idor" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(opts: { userRef: string; fullName: string; managerId?: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `REG-${id.slice(0, 8)}`, fullName: opts.fullName,
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    userRef: opts.userRef, ...(opts.managerId ? { managerId: opts.managerId } : {}),
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

async function seedRaw(sqlText: string, params: unknown[]): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(sqlText, params as never[]);
  });
}

const ALICE_ACTOR = randomUUID();
const BOB_ACTOR = randomUUID();   // Alice's people-manager
const CAROL_ACTOR = randomUUID(); // unrelated employee — the attacker
const DAVE_ACTOR = randomUUID();  // genuinely nominated rater for Alice
const EVE_ACTOR = randomUUID();   // never nominated as anyone's rater, anywhere, by any test
const HR_ACTOR = randomUUID();

let app: FastifyInstance;
let aliceEmpId: string;
let bobEmpId: string;
let carolEmpId: string;
let daveEmpId: string;
let eveEmpId: string;
let competencyId: string;
let cycleId: string;

beforeAll(async () => {
  app = await buildApp();

  bobEmpId = await seedEmployee({ userRef: BOB_ACTOR, fullName: "Bob Manager", createdBy: HR_ACTOR });
  aliceEmpId = await seedEmployee({ userRef: ALICE_ACTOR, fullName: "Alice Employee", managerId: bobEmpId, createdBy: HR_ACTOR });
  carolEmpId = await seedEmployee({ userRef: CAROL_ACTOR, fullName: "Carol Outsider", createdBy: HR_ACTOR });
  daveEmpId = await seedEmployee({ userRef: DAVE_ACTOR, fullName: "Dave Rater", createdBy: HR_ACTOR });
  eveEmpId = await seedEmployee({ userRef: EVE_ACTOR, fullName: "Eve Never-Nominated", createdBy: HR_ACTOR });

  competencyId = randomUUID();
  await seedRaw(
    `INSERT INTO employee.competencies (id, tenant_id, name, category, created_by) VALUES ($1, $2, 'Stakeholder Management', 'technical', $3)`,
    [competencyId, TENANT, HR_ACTOR],
  );
  await seedRaw(
    `INSERT INTO employee.role_competency_map (id, tenant_id, role_ref, competency_id, required_level) VALUES ($1, $2, 'ROLE-X', $3, 'advanced')`,
    [randomUUID(), TENANT, competencyId],
  );
  // Alice's REAL assessed level -- distinct from "not_assessed" so a passing
  // assertion below proves real per-employee data flowed through.
  await seedRaw(
    `INSERT INTO employee.skill_assessments (id, tenant_id, employee_id, competency_id, assessed_level, assessed_by) VALUES ($1, $2, $3, $4, 'intermediate', $5)`,
    [randomUUID(), TENANT, aliceEmpId, competencyId, HR_ACTOR],
  );

  cycleId = randomUUID();
  await seedRaw(
    `INSERT INTO employee.feedback_cycles (id, tenant_id, name, created_by) VALUES ($1, $2, 'H1 2026 360', $3)`,
    [cycleId, TENANT, HR_ACTOR],
  );
  // Dave is genuinely nominated to rate Alice, as "peer".
  await seedRaw(
    `INSERT INTO employee.feedback_nominations (id, tenant_id, cycle_id, employee_id, rater_id, rater_group) VALUES ($1, $2, $3, $4, $5, 'peer')`,
    [randomUUID(), TENANT, cycleId, aliceEmpId, daveEmpId],
  );

  await seedRaw(
    `INSERT INTO appraisal.hrms_appraisals (id, tenant_id, employee_id, appraisal_period, status, reviewer_id, created_by, updated_by)
     VALUES ($1, $2, $3, '2026-27', 'pending', $4, $4, $4)`,
    [randomUUID(), TENANT, aliceEmpId, HR_ACTOR],
  );

  // See file header: makes this module's own (unwrapped) sqlPool queries
  // usable for the app.inject calls below.
  await sqlPool.query("SELECT set_config('app.tenant_id', $1, false)", [TENANT]);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/skills/gap-analysis — ownership", () => {
  it("legitimate access still works: Alice reads her OWN gap analysis", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/skills/gap-analysis?employeeId=${aliceEmpId}`,
      headers: auth(ALICE_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.some((row: { actual_level: string }) => row.actual_level === "intermediate")).toBe(true);
  });

  it("IDOR closed: Carol requesting Alice's employeeId is forced onto her OWN (not-assessed) data", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/skills/gap-analysis?employeeId=${aliceEmpId}`,
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    // Forced onto Carol's own record, which never held this competency.
    expect(r.json().data.every((row: { actual_level: string }) => row.actual_level === "not_assessed")).toBe(true);
  });
});

describe("POST /v1/hrms/feedback/cycles/:id/nominate-raters — authorization", () => {
  it("an unrelated employee (Carol) cannot nominate raters for Alice", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/feedback/cycles/${cycleId}/nominate-raters`,
      headers: auth(CAROL_ACTOR, ["employee"]),
      payload: { employeeId: aliceEmpId, raters: [{ raterId: carolEmpId, raterGroup: "peer" }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it("Alice's real manager (Bob) CAN nominate raters for her", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/feedback/cycles/${cycleId}/nominate-raters`,
      headers: auth(BOB_ACTOR, ["manager"]),
      payload: { employeeId: aliceEmpId, raters: [{ raterId: daveEmpId, raterGroup: "manager" }] },
    });
    expect(r.statusCode).toBe(201);
  });

  it("HR can still nominate raters for anyone (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/feedback/cycles/${cycleId}/nominate-raters`,
      headers: auth(HR_ACTOR, ["hr_admin"]),
      payload: { employeeId: aliceEmpId, raters: [{ raterId: carolEmpId, raterGroup: "peer" }] },
    });
    expect(r.statusCode).toBe(201);
  });
});

describe("POST /v1/hrms/feedback/responses — nominated-rater verification, server-derived raterGroup", () => {
  // Uses Eve, not Carol: the "nominate-raters" describe block above
  // includes a legitimate HR-nominates-Carol-as-a-peer-rater case as one of
  // its own assertions, which for real (correctly) creates a nomination row
  // for Carol as a side effect -- so by this point Carol is no longer
  // "un-nominated". Eve is never nominated by any test in this file.
  it("an un-nominated caller (Eve) cannot submit a 360 response about Alice", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/feedback/responses",
      headers: auth(EVE_ACTOR, ["employee"]),
      payload: { cycleId, employeeId: aliceEmpId, raterGroup: "manager", scores: { integrity: 5 } },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_NOMINATED");
  });

  it("Dave (genuinely nominated as 'peer') CAN respond, and the client-supplied raterGroup ('manager') is ignored in favor of the real nomination ('peer')", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/feedback/responses",
      headers: auth(DAVE_ACTOR, ["employee"]),
      // Deliberately lies about raterGroup -- server must derive "peer" from
      // the nomination row, not trust this.
      payload: { cycleId, employeeId: aliceEmpId, raterGroup: "manager", scores: { integrity: 4 } },
    });
    expect(r.statusCode).toBe(201);

    // Verify directly against the DB (bypassing app-layer trust entirely):
    const rows = await sqlPool.query<{ rater_group: string }>(
      `SELECT rater_group FROM employee.feedback_responses WHERE tenant_id = $1 AND cycle_id = $2 AND employee_id = $3`,
      [TENANT, cycleId, aliceEmpId],
    );
    expect(rows.rows.some((row) => row.rater_group === "peer")).toBe(true);
    expect(rows.rows.some((row) => row.rater_group === "manager")).toBe(false);
  });
});

describe("GET /v1/hrms/skills and GET /v1/hrms/work-summaries — self-scope for non-HR callers", () => {
  it("GET /v1/hrms/skills: Carol (non-HR) does not see Alice's assessed skills", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/skills",
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.some((row: { employee: string }) => row.employee === "Alice Employee")).toBe(false);
  });

  it("GET /v1/hrms/skills: HR still sees the full tenant-wide list (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/skills",
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.some((row: { employee: string }) => row.employee === "Alice Employee")).toBe(true);
  });

  it("GET /v1/hrms/work-summaries: Carol (non-HR) does not see Alice's appraisal-derived summary", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/work-summaries",
      headers: auth(CAROL_ACTOR, ["employee"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.some((row: { employee: string }) => row.employee === "Alice Employee")).toBe(false);
  });

  it("GET /v1/hrms/work-summaries: HR still sees the full tenant-wide list (unrestricted, unchanged)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/work-summaries",
      headers: auth(HR_ACTOR, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.some((row: { employee: string }) => row.employee === "Alice Employee")).toBe(true);
  });
});
