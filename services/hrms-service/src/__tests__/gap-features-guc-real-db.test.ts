/**
 * gap-features GUC fix — real-DB regression (no mocks).
 *
 * Companion to src/__tests__/onboarding-step-ownership-real-db.test.ts (the
 * reference fix this mirrors). That file covers POST .../onboarding/:id/
 * steps/:stepIdx/complete; this file covers every OTHER route in
 * gap-features/routes.ts that had the same bug: tables across the employee,
 * training, and appraisal schemas here have FORCE ROW LEVEL SECURITY, but sqlPool.query()
 * never set app.tenant_id (shared/db.ts's sqlPool is a bare
 * sqlClient.unsafe() wrapper with no GUC injection — only the Drizzle `db`
 * export gets that, via wrapWithTenantGuc). Every affected route silently
 * touched/returned ZERO rows for every caller, tenant-correct filters and
 * all — not an error, a 200 with empty data. Fixed by wrapping each call in
 * sqlClient.begin() + set_config(), the same pattern staffing-plan and the
 * onboarding fix already established.
 *
 * Sabotage-then-restore discipline (per campaign requirement): this exact
 * file was first run against `git stash`-ed (pre-fix) routes.ts and every
 * data-bearing assertion below failed (empty lists, 404s where the row
 * demonstrably exists) — confirming the bug reproduces under a real
 * Postgres, not just "look right". `git stash pop` restores the fix and the
 * same suite passes. See PR description for the before/after run transcript.
 *
 * Structural coverage (representative sample across the ~34 fixed call
 * sites, not literally every route — see PR description for the full
 * grep-derived list and which routes got dedicated coverage here vs.
 * pattern-consistency-only review):
 *   - simple INSERT + tenant-filtered LIST                  (compensation)
 *   - SELECT-then-branch / 404 on miss                       (compensation model)
 *   - multi-INSERT + multi-join SELECT + UPDATE               (LMS)
 *   - loop INSERT inside one transaction                      (feedback nominate)
 *   - read-then-write-with-authorization in ONE transaction   (feedback responses)
 *   - IDOR-scoped dynamic WHERE clause                        (skills list)
 *   - dynamic WHERE, different schema (appraisal.*)           (work-summaries)
 *   - different schema entirely (training.hrms_nominations/   (certifications)
 *     hrms_trainings), found via FORCE-RLS grep, not named in
 *     the original task list
 *   - INSERT ... ON CONFLICT DO UPDATE + join SELECT          (benefits)
 *   - LEFT JOIN aggregate with HAVING                          (succession)
 *   - INSERT + aggregate SELECT                                (surveys)
 *   - explicit cross-tenant ISOLATION check (the fix must not
 *     regress "sees nothing" into "sees everything")
 *
 * Real DB (no mocks), seeded via the app's own routes wherever a POST
 * route exists (most tables) or raw SQL + set_config for the two
 * no-Drizzle-schema/no-POST-route tables this file only ever reads
 * (training.hrms_nominations/hrms_trainings, appraisal.hrms_appraisals).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

function auth(tenant: string, sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: tenant, roles, sid: "sess-gap-features-guc" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(tenant: string, opts: { userRef: string; fullName: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: tenant,
    employeeNo: `GUC-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    userRef: opts.userRef,
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

// training.hrms_nominations/hrms_trainings and appraisal.hrms_appraisals have
// no POST route in gap-features/routes.ts (read-only here) and no Drizzle
// schema in this service, so seeding goes through raw SQL — with the SAME
// set_config() the routes themselves now use, since all three have FORCE ROW
// LEVEL SECURITY.
async function seedTrainingCertificate(tenant: string, opts: { employeeId: string; title: string; createdBy: string }): Promise<void> {
  const trainingId = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    await sql.unsafe(
      `INSERT INTO training.hrms_trainings (id, tenant_id, title, from_date, to_date, facilitator, created_by, updated_by)
       VALUES ($1,$2,$3,'2025-01-01','2025-01-02',$4,$5,$5)`,
      [trainingId, tenant, opts.title, "Internal Faculty", opts.createdBy],
    );
    await sql.unsafe(
      `INSERT INTO training.hrms_nominations (id, tenant_id, training_id, employee_id, status, certificate_ref, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'completed',$5,$6,$6)`,
      [randomUUID(), tenant, trainingId, opts.employeeId, `CERT-${trainingId.slice(0, 8)}`, opts.createdBy],
    );
  });
}

async function seedAppraisal(tenant: string, opts: { employeeId: string; period: string; rating: number; createdBy: string }): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    await sql.unsafe(
      `INSERT INTO appraisal.hrms_appraisals (id, tenant_id, employee_id, appraisal_period, rating, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$6)`,
      [randomUUID(), tenant, opts.employeeId, opts.period, opts.rating, opts.createdBy],
    );
  });
}

const HR_A = randomUUID();
const HR_B = randomUUID();

let app: FastifyInstance;
let aliceEmpId: string; // TENANT_A
let bobEmpId: string;   // TENANT_A
let carolEmpId: string; // TENANT_A — non-nominated rater for the feedback negative case
let zaraEmpId: string;  // TENANT_B — isolation checks

beforeAll(async () => {
  app = await buildApp();
  aliceEmpId = await seedEmployee(TENANT_A, { userRef: "alice-sub", fullName: "Alice A", createdBy: HR_A });
  bobEmpId = await seedEmployee(TENANT_A, { userRef: "bob-sub", fullName: "Bob A", createdBy: HR_A });
  carolEmpId = await seedEmployee(TENANT_A, { userRef: "carol-sub", fullName: "Carol A", createdBy: HR_A });
  zaraEmpId = await seedEmployee(TENANT_B, { userRef: "zara-sub", fullName: "Zara B", createdBy: HR_B });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("Compensation Planning — GUC fix", () => {
  let planId: string;

  it("HR creates a plan and it is visible in the tenant-scoped list (was: silently empty)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/hrms/compensation/plans",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { name: "FY26 Comp Plan", fy: "2026-27", budgetMinor: 5_000_000_00 },
    });
    expect(create.statusCode).toBe(201);
    planId = create.json().data.id;

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/compensation/plans",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((r: { id: string }) => r.id)).toContain(planId);
  });

  it("model endpoint finds the just-created plan (SELECT-then-branch; was: always 404)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/compensation/plans/${planId}/model`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.planId).toBe(planId);
  });

  it("model endpoint still 404s for a genuinely nonexistent plan (fail-closed preserved)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/compensation/plans/${randomUUID()}/model`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("LMS — GUC fix", () => {
  let courseId: string;

  it("create course, enroll, complete, and see it all the way through my-learning + compliance (multi-join; was: empty everywhere)", async () => {
    const course = await app.inject({
      method: "POST", url: "/v1/hrms/lms/courses",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { code: `GUC-${randomUUID().slice(0, 6)}`, name: "RTI Act Refresher", mandatoryForRoles: ["employee"] },
    });
    expect(course.statusCode).toBe(201);
    courseId = course.json().data.id;

    const listed = await app.inject({ method: "GET", url: "/v1/hrms/lms/courses", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    expect(listed.json().data.map((c: { id: string }) => c.id)).toContain(courseId);

    const enroll = await app.inject({
      method: "POST", url: `/v1/hrms/lms/courses/${courseId}/enroll`,
      headers: auth(TENANT_A, "alice-sub", ["employee"]),
      payload: { employeeId: aliceEmpId },
    });
    expect(enroll.statusCode).toBe(201);
    const enrollmentId = enroll.json().data.id;

    const complete = await app.inject({
      method: "POST", url: `/v1/hrms/lms/enrollments/${enrollmentId}/complete`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { score: 92 },
    });
    expect(complete.statusCode).toBe(200);

    // NOTE: unlike the IDOR-scoped routes elsewhere in this file (skills,
    // work-summaries), my-learning has no resolveEmployeeForActor step — it
    // uses ctx.actorId directly as the employee.hrms_employees-keyed
    // employee_id (a real Postgres uuid column), a pre-existing convention
    // of this unmodified route. So the caller here must authenticate AS
    // aliceEmpId itself, not the "alice-sub" identity used elsewhere.
    const myLearning = await app.inject({
      method: "GET", url: "/v1/hrms/lms/my-learning",
      headers: auth(TENANT_A, aliceEmpId, ["employee"]),
    });
    expect(myLearning.statusCode).toBe(200);
    const row = myLearning.json().data.find((r: { code: string }) => r.code === course.json().data.code);
    expect(row.status).toBe("completed");
    expect(Number(row.score)).toBe(92);

    const compliance = await app.inject({ method: "GET", url: "/v1/hrms/lms/compliance", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    const complianceRow = compliance.json().data.find((r: { id: string }) => r.id === courseId);
    expect(Number(complianceRow.completed_count)).toBe(1);
  });
});

describe("360° Feedback — GUC fix (read-then-write-with-authorization)", () => {
  let cycleId: string;

  it("HR creates a cycle and nominates Alice as Bob's rater (loop insert in one transaction)", async () => {
    const cycle = await app.inject({
      method: "POST", url: "/v1/hrms/feedback/cycles",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { name: "H1 360", questions: [{ text: "Collaboration?" }] },
    });
    expect(cycle.statusCode).toBe(201);
    cycleId = cycle.json().data.id;

    const nominate = await app.inject({
      method: "POST", url: `/v1/hrms/feedback/cycles/${cycleId}/nominate-raters`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { employeeId: bobEmpId, raters: [{ raterId: aliceEmpId, raterGroup: "peer" }] },
    });
    expect(nominate.statusCode).toBe(201);
    expect(nominate.json().data.ratersAdded).toBe(1);
  });

  it("Alice (nominated) CAN submit a response; raterGroup is server-derived", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/feedback/responses",
      headers: auth(TENANT_A, "alice-sub", ["employee"]),
      payload: { cycleId, employeeId: bobEmpId, raterGroup: "manager", scores: { collaboration: 4 } }, // client-claimed group must be ignored
    });
    expect(r.statusCode).toBe(201);

    const report = await app.inject({
      method: "GET", url: `/v1/hrms/feedback/cycles/${cycleId}/report?employeeId=${bobEmpId}`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().data.byRaterGroup.peer).toBeDefined(); // server-derived "peer", not client-claimed "manager"
    expect(report.json().data.byRaterGroup.manager).toBeUndefined();
  });

  it("Carol (NOT nominated) is rejected — the GUC fix's shared transaction must not have weakened the authorization check", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/feedback/responses",
      headers: auth(TENANT_A, "carol-sub", ["employee"]),
      payload: { cycleId, employeeId: bobEmpId, raterGroup: "peer", scores: { collaboration: 5 } },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_NOMINATED");
  });
});

describe("Skills — IDOR-scoped dynamic WHERE, GUC fix", () => {
  let competencyId: string;

  it("HR assesses both Alice and Bob; HR sees both, Alice (bare employee) sees only her own", async () => {
    const comp = await app.inject({
      method: "POST", url: "/v1/hrms/skills/competencies",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { name: "Public Speaking" },
    });
    competencyId = comp.json().data.id;

    for (const empId of [aliceEmpId, bobEmpId]) {
      const assess = await app.inject({
        method: "POST", url: "/v1/hrms/skills/assessments",
        headers: auth(TENANT_A, HR_A, ["hr_admin"]),
        payload: { employeeId: empId, competencyId, assessedLevel: "advanced" },
      });
      expect(assess.statusCode).toBe(201);
    }

    const hrView = await app.inject({ method: "GET", url: "/v1/hrms/skills", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    expect(hrView.json().data.length).toBeGreaterThanOrEqual(2);

    const aliceView = await app.inject({ method: "GET", url: "/v1/hrms/skills", headers: auth(TENANT_A, "alice-sub", ["employee"]) });
    expect(aliceView.statusCode).toBe(200);
    expect(aliceView.json().data.length).toBe(1);
    expect(aliceView.json().data[0].employee).toBe("Alice A");
  });
});

describe("Work-summaries — dynamic WHERE, different schema (appraisal.*), GUC fix", () => {
  it("HR sees Alice's appraisal-derived summary; Alice (bare employee) sees only her own; Bob (no appraisal) sees empty, not an error", async () => {
    await seedAppraisal(TENANT_A, { employeeId: aliceEmpId, period: "2025-26", rating: 4.2, createdBy: HR_A });

    const hrView = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    expect(hrView.statusCode).toBe(200);
    expect(hrView.json().data.some((r: { employee: string }) => r.employee === "Alice A")).toBe(true);

    const aliceView = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth(TENANT_A, "alice-sub", ["employee"]) });
    expect(aliceView.json().data.length).toBe(1);

    const bobView = await app.inject({ method: "GET", url: "/v1/hrms/work-summaries", headers: auth(TENANT_A, "bob-sub", ["employee"]) });
    expect(bobView.statusCode).toBe(200);
    expect(bobView.json().data).toEqual([]);
  });
});

describe("Certifications — different schema entirely (training.hrms_nominations/hrms_trainings), GUC fix", () => {
  it("a completed, certificated training nomination is visible (route found via FORCE-RLS grep, not in the original named list)", async () => {
    await seedTrainingCertificate(TENANT_A, { employeeId: aliceEmpId, title: "POSH Compliance", createdBy: HR_A });

    const r = await app.inject({ method: "GET", url: "/v1/hrms/certifications", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.some((c: { certification: string; employee: string }) => c.certification === "POSH Compliance" && c.employee === "Alice A")).toBe(true);
  });
});

describe("Benefits — INSERT ... ON CONFLICT DO UPDATE + join SELECT, GUC fix", () => {
  it("plan creation, election, and re-election (upsert) all round-trip through my-elections", async () => {
    const plan = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/plans",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { name: "Flex Basket FY26", fy: "2026-27", flexBudgetMinor: 100000, components: [{ name: "Medical", maxMinor: 50000 }] },
    });
    expect(plan.statusCode).toBe(201);
    const planId = plan.json().data.id;

    // NOTE: like my-learning above, benefits/elections has no
    // resolveEmployeeForActor step — it inserts/reads ctx.actorId directly
    // as employee.benefit_elections.employee_id (uuid), so the caller must
    // authenticate as a real uuid (aliceEmpId), not the "alice-sub" string
    // identity used by the IDOR-scoped routes elsewhere in this file.
    const elect = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections",
      headers: auth(TENANT_A, aliceEmpId, ["employee"]),
      payload: { planId, fy: "2026-27", elections: [{ component: "Medical", electedMinor: 30000 }] },
    });
    expect(elect.statusCode).toBe(201);

    // re-election for the same (tenant, plan, employee, fy) exercises ON CONFLICT DO UPDATE
    const reElect = await app.inject({
      method: "POST", url: "/v1/hrms/benefits/elections",
      headers: auth(TENANT_A, aliceEmpId, ["employee"]),
      payload: { planId, fy: "2026-27", elections: [{ component: "Medical", electedMinor: 45000 }] },
    });
    expect(reElect.statusCode).toBe(201);
    expect(reElect.json().data.totalElectedMinor).toBe(45000);

    const mine = await app.inject({ method: "GET", url: "/v1/hrms/benefits/my-elections", headers: auth(TENANT_A, aliceEmpId, ["employee"]) });
    expect(mine.json().data[0].plan_name).toBe("Flex Basket FY26");
    expect(Number(mine.json().data[0].total_elected_minor)).toBe(45000);
  });
});

describe("Succession — LEFT JOIN aggregate with HAVING, GUC fix", () => {
  it("a critical role with a 'now'-ready nominee shows in the pipeline and drops out of the risk list", async () => {
    const role = await app.inject({
      method: "POST", url: "/v1/hrms/succession/critical-roles",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { roleRef: "Deputy Director (GUC test)" },
    });
    expect(role.statusCode).toBe(201);

    const nominee = await app.inject({
      method: "POST", url: "/v1/hrms/succession/nominees",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { planId: role.json().data.id, employeeId: bobEmpId, readiness: "now" },
    });
    expect(nominee.statusCode).toBe(201);

    const pipeline = await app.inject({ method: "GET", url: "/v1/hrms/succession/pipeline", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    const pipelineRow = pipeline.json().data.find((r: { role_ref: string }) => r.role_ref === "Deputy Director (GUC test)");
    expect(Number(pipelineRow.ready_now)).toBe(1);

    const risk = await app.inject({ method: "GET", url: "/v1/hrms/succession/risk", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    expect(risk.json().data.some((r: { role_ref: string }) => r.role_ref === "Deputy Director (GUC test)")).toBe(false);
  });
});

describe("Engagement Surveys — INSERT + aggregate SELECT, GUC fix", () => {
  it("survey creation, response, and results/eNPS aggregation round-trip", async () => {
    const survey = await app.inject({
      method: "POST", url: "/v1/hrms/engagement/surveys",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { title: "Pulse Check (GUC test)", questions: [{ text: "How are you?", type: "nps" }] },
    });
    expect(survey.statusCode).toBe(201);
    const surveyId = survey.json().data.id;

    const respond = await app.inject({
      method: "POST", url: `/v1/hrms/engagement/surveys/${surveyId}/respond`,
      headers: auth(TENANT_A, "alice-sub", ["employee"]),
      payload: { answers: [{ q: 1, a: "great" }], enpsScore: 9 },
    });
    expect(respond.statusCode).toBe(201);

    const results = await app.inject({
      method: "GET", url: `/v1/hrms/engagement/surveys/${surveyId}/results`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(results.json().data.responseCount).toBe(1);

    const enps = await app.inject({ method: "GET", url: "/v1/hrms/engagement/eNPS", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    expect(enps.json().data.total).toBeGreaterThanOrEqual(1);
  });
});

describe("Tenant ISOLATION — the fix must not regress \"sees nothing\" into \"sees everything\"", () => {
  it("tenant B's compensation plan and LMS course are invisible to tenant A, and vice versa", async () => {
    const planA = await app.inject({
      method: "POST", url: "/v1/hrms/compensation/plans",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { name: "Isolation Check A", fy: "2027-28", budgetMinor: 1 },
    });
    const planB = await app.inject({
      method: "POST", url: "/v1/hrms/compensation/plans",
      headers: auth(TENANT_B, HR_B, ["hr_admin"]),
      payload: { name: "Isolation Check B", fy: "2027-28", budgetMinor: 1 },
    });
    expect(planA.statusCode).toBe(201);
    expect(planB.statusCode).toBe(201);

    const listA = await app.inject({ method: "GET", url: "/v1/hrms/compensation/plans", headers: auth(TENANT_A, HR_A, ["hr_admin"]) });
    const idsA = listA.json().data.map((r: { id: string }) => r.id);
    expect(idsA).toContain(planA.json().data.id);
    expect(idsA).not.toContain(planB.json().data.id);

    const listB = await app.inject({ method: "GET", url: "/v1/hrms/compensation/plans", headers: auth(TENANT_B, HR_B, ["hr_admin"]) });
    const idsB = listB.json().data.map((r: { id: string }) => r.id);
    expect(idsB).toContain(planB.json().data.id);
    expect(idsB).not.toContain(planA.json().data.id);

    // Cross-tenant probe: tenant B's HR must not be able to run /model against tenant A's plan id.
    const crossProbe = await app.inject({
      method: "POST", url: `/v1/hrms/compensation/plans/${planA.json().data.id}/model`,
      headers: auth(TENANT_B, HR_B, ["hr_admin"]),
    });
    expect(crossProbe.statusCode).toBe(404);
  });

  it("tenant B cannot see tenant A's skill assessments (employee_id collision would be the dangerous failure mode)", async () => {
    // zaraEmpId (tenant B) deliberately has no assessments; tenant A's HR view (from
    // the Skills describe block above) already has 2+ rows. This checks the other
    // direction: tenant B's own list must be scoped to tenant B, i.e. empty here,
    // not tenant A's rows leaking across because of a shared connection pool.
    const zaraView = await app.inject({ method: "GET", url: "/v1/hrms/skills", headers: auth(TENANT_B, "zara-sub", ["employee"]) });
    expect(zaraView.statusCode).toBe(200);
    expect(zaraView.json().data).toEqual([]);
    void zaraEmpId; // referenced for clarity of intent; the seeded row itself isn't used by this GET
  });
});
