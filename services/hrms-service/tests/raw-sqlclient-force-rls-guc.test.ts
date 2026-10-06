/**
 * Raw sqlClient/sqlPool FORCE-RLS GUC fix -- real-DB regression (no mocks).
 *
 * Companion to tests/force-rls-scoped-read-fix.test.ts (PR #1626, Drizzle
 * `db`/scopedRead surface) and src/__tests__/gap-features-guc-real-db.test.ts
 * (PR #1560, the first raw-sqlPool instance of this same defect in this
 * service). This file covers the raw sqlPool/sqlClient surface's remaining
 * instances across social/pulse-routes.ts, gap-features/performance-dev-routes.ts,
 * ai-predictions/routes.ts, ai-ml/face-verification.ts, and
 * ai-ml/plugin-registry.ts: a query against a FORCE ROW LEVEL SECURITY table
 * ran on a bare pooled connection (sqlPool, or a raw sqlClient template-tag
 * call with no .begin()/set_config()), so under hrms_svc (NOBYPASSRLS) every
 * policy failed CLOSED -- 200/201 with silently empty/zero data, never an
 * error. Fixed by wrapping every affected call site in withRawTenantGuc
 * (@civitasone/db), the same helper already proven correct elsewhere in this
 * service (medical/routes.ts, workforce-planning, id-cards, social/routes.ts).
 *
 * visiting-cards/routes.ts and ai-ml/nlu-chatbot.ts (manager_info) and
 * social/pulse-routes.ts's own /assistant manager_info branch are
 * deliberately NOT covered by a passing end-to-end test here even though the
 * GUC wrap was applied to them too: each has a SEPARATE, deeper,
 * pre-existing bug (columns that don't exist on employee.hrms_employees --
 * first_name/last_name/designation/department/phone/employee_code/photo_url/
 * branch/user_id/reporting_to -- plus a nonexistent public.tenants join in
 * visiting-cards' GET /me) that makes them 500 both before and after this
 * fix, for a reason unrelated to tenant scoping. See those files' own header
 * comments and the PR description for the full detail. Writing a green
 * integration test against a route that still 500s would be misleading, so
 * this file does not attempt it; the GUC wrap on those routes is reviewed by
 * inspection instead. gap-features/performance-dev-routes.ts's GET
 * /learning-paths has the same shape of problem (wrong/ambiguous join target
 * plus a type-mismatch on qualitative-vs-numeric skill levels) and is
 * likewise not covered here for the same reason.
 *
 * Sabotage-then-restore discipline (per campaign requirement): this file was
 * first run against `git stash`-ed (pre-fix) routes and every assertion
 * below that depends on the fix failed (empty lists/zero counts/404s where
 * the row demonstrably exists) -- confirming the bug reproduces under a real
 * Postgres, not just "looks right". `git stash pop` restores the fix and the
 * same suite passes. See PR description for the before/after run transcript.
 *
 * Verified the connecting role directly against the live dev Postgres before
 * relying on any of the below: hrms_svc, rolbypassrls=false, rolsuper=false
 * (not a Docker POSTGRES_USER-created superuser).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees } from "../src/modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const HR_A = randomUUID();
const HR_B = randomUUID();

function auth(tenant: string, sub: string, roles: string[]): { authorization: string } {
  const jwt = signToken({ sub, tid: tenant, roles, sid: "sess-raw-sqlclient-guc" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function seedEmployee(tenant: string, opts: { fullName: string; createdBy: string }): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, tenant, (tx: any) => tx.insert(hrmsEmployees).values({
    id, tenantId: tenant,
    employeeNo: `RAWGUC-${id.slice(0, 8)}`,
    fullName: opts.fullName,
    departmentId: randomUUID(),
    designationId: randomUUID(),
    dateOfJoining: "2020-01-15",
    dateOfBirth: "1990-01-01",
    status: "confirmed",
    createdBy: opts.createdBy, updatedBy: opts.createdBy,
  }));
  return id;
}

// hrms.ai_prediction_log has no POST route (plugin-registry.ts only reads/
// updates it) -- seed via raw SQL + set_config, the same tenant-scoping the
// route itself now uses.
async function seedPredictionLog(tenant: string, opts: { pluginId: string; confidence: number; outcome: string }): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    await sql.unsafe(
      `INSERT INTO hrms.ai_prediction_log (id, tenant_id, plugin_id, confidence, latency_ms, outcome, created_at)
       VALUES ($1, $2, $3, $4, 120, $5, NOW())`,
      [id, tenant, opts.pluginId, opts.confidence, opts.outcome],
    );
  });
  return id;
}

let app: FastifyInstance;
let empA1: string; // TENANT_A
let empA2: string; // TENANT_A
let empB1: string; // TENANT_B -- isolation checks

beforeAll(async () => {
  app = await buildApp();
  empA1 = await seedEmployee(TENANT_A, { fullName: "Alice A", createdBy: HR_A });
  empA2 = await seedEmployee(TENANT_A, { fullName: "Bob A", createdBy: HR_A });
  empB1 = await seedEmployee(TENANT_B, { fullName: "Zara B", createdBy: HR_B });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("social/pulse-routes.ts -- Pulse Surveys GUC fix", () => {
  let surveyId: string;

  it("create, list, respond, and see real aggregated results (was: silently empty)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/hrms/pulse-surveys",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
      payload: { question: "How is team morale this sprint?", category: "engagement" },
    });
    expect(create.statusCode).toBe(201);
    surveyId = create.json().id;

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/pulse-surveys",
      headers: auth(TENANT_A, empA1, ["employee"]),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((s: { id: string }) => s.id)).toContain(surveyId);

    const respond = await app.inject({
      method: "POST", url: `/v1/hrms/pulse-surveys/${surveyId}/respond`,
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { score: 5, comment: "Great sprint!" },
    });
    expect(respond.statusCode).toBe(200);

    const results = await app.inject({
      method: "GET", url: `/v1/hrms/pulse-surveys/${surveyId}/results`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(results.statusCode).toBe(200);
    const body = results.json();
    expect(body.total).toBe(1);
    expect(body.avgScore).toBe(5);
    expect(body.distribution).toHaveLength(1);
  });

  it("awards leaderboard points for responding (was: silently zero rows written)", async () => {
    const myPoints = await app.inject({
      method: "GET", url: "/v1/hrms/leaderboard/my-points",
      headers: auth(TENANT_A, empA1, ["employee"]),
    });
    expect(myPoints.statusCode).toBe(200);
    const body = myPoints.json();
    expect(body.totalPoints).toBeGreaterThanOrEqual(5);
    expect(body.breakdown.map((b: { reason: string }) => b.reason)).toContain("survey_responded");
  });

  it("responding to a nonexistent/wrong-tenant survey still 404s (fail-closed preserved)", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/pulse-surveys/${randomUUID()}/respond`,
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { score: 3 },
    });
    expect(r.statusCode).toBe(404);
  });

  it("tenant B cannot see tenant A's survey (isolation preserved, not regressed to cross-tenant)", async () => {
    const list = await app.inject({
      method: "GET", url: "/v1/hrms/pulse-surveys",
      headers: auth(TENANT_B, empB1, ["employee"]),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((s: { id: string }) => s.id)).not.toContain(surveyId);
  });
});

describe("social/pulse-routes.ts -- Goals/OKR GUC fix", () => {
  let goalId: string;

  it("create, list, and see it via GET /goals (was: silently empty)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/hrms/goals",
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { title: "Ship RLS fix", category: "individual" },
    });
    expect(create.statusCode).toBe(201);
    goalId = create.json().id;

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/goals",
      headers: auth(TENANT_A, empA1, ["employee"]),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((g: { id: string }) => g.id)).toContain(goalId);
  });

  it("check-in to 100% completes the goal, lists in check-in history, and awards completion points (was: 404 on the ownership check, silently empty history, zero points)", async () => {
    const checkin = await app.inject({
      method: "POST", url: `/v1/hrms/goals/${goalId}/checkin`,
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { progress: 100, note: "Done" },
    });
    expect(checkin.statusCode).toBe(200);

    const history = await app.inject({
      method: "GET", url: `/v1/hrms/goals/${goalId}/checkins`,
      headers: auth(TENANT_A, empA1, ["employee"]),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toHaveLength(1);
    expect(history.json().data[0].progress).toBe(100);

    const myPoints = await app.inject({
      method: "GET", url: "/v1/hrms/leaderboard/my-points",
      headers: auth(TENANT_A, empA1, ["employee"]),
    });
    expect(myPoints.json().breakdown.map((b: { reason: string }) => b.reason)).toContain("goal_completed");
  });

  it("tenant B cannot see tenant A's goal (isolation preserved)", async () => {
    const list = await app.inject({
      method: "GET", url: "/v1/hrms/goals",
      headers: auth(TENANT_B, empB1, ["employee"]),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((g: { id: string }) => g.id)).not.toContain(goalId);
  });
});

describe("gap-features/performance-dev-routes.ts -- Goals PATCH/DELETE GUC fix", () => {
  it("PATCH updates a real goal that the existence check can now actually see (was: 404 every time)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/hrms/goals",
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { title: "Original title", category: "individual" },
    });
    const goalId = create.json().id;

    const patch = await app.inject({
      method: "PATCH", url: `/v1/hrms/goals/${goalId}`,
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { title: "Updated title", progress: 40 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().updated).toBe(true);

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/goals",
      headers: auth(TENANT_A, empA1, ["employee"]),
    });
    const updated = list.json().data.find((g: { id: string }) => g.id === goalId);
    expect(updated.title).toBe("Updated title");
    expect(updated.progress).toBe(40);
  });

  it("DELETE removes a real goal (was: 404 every time; the row was reachable, just invisible to the bare pool)", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/hrms/goals",
      headers: auth(TENANT_A, empA1, ["employee"]),
      payload: { title: "To be deleted", category: "individual" },
    });
    const goalId = create.json().id;

    const del = await app.inject({
      method: "DELETE", url: `/v1/hrms/goals/${goalId}`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(del.statusCode).toBe(204);

    const delAgain = await app.inject({
      method: "DELETE", url: `/v1/hrms/goals/${goalId}`,
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(delAgain.statusCode).toBe(404); // fail-closed preserved: really gone now, not just always-404
  });
});

describe("ai-predictions/routes.ts -- workforce-insights GUC fix", () => {
  it("reports the real seeded headcount (was: always zero)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/ai/workforce-insights",
      headers: auth(TENANT_A, HR_A, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    // At least the 2 tenant-A employees seeded in beforeAll (other tests in
    // this file may add more to TENANT_A; must not regress to 0).
    expect(r.json().data.totalHeadcount).toBeGreaterThanOrEqual(2);
  });

  it("tenant B's headcount does not include tenant A's employees (isolation preserved)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/ai/workforce-insights",
      headers: auth(TENANT_B, HR_B, ["hr_admin"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.totalHeadcount).toBe(1); // just empB1
  });
});

describe("ai-ml/face-verification.ts -- GUC fix", () => {
  it("enroll, verify (matching selfie), and status all see the real enrolled embedding (was: 404 NOT_ENROLLED / enrolled:false)", async () => {
    const enroll = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/enroll",
      headers: auth(TENANT_A, empA2, ["employee"]),
      payload: { employeeId: empA2, photoKey: "s3://fixtures/empA2-enroll.jpg" },
    });
    expect(enroll.statusCode).toBe(201);
    expect(enroll.json().status).toBe("enrolled");

    const status = await app.inject({
      method: "GET", url: `/v1/hrms/ai/face/status/${empA2}`,
      headers: auth(TENANT_A, empA2, ["employee"]),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().enrolled).toBe(true);

    // Same key as enrollment -> deterministic mock embedding is identical ->
    // cosine similarity 1.0 -> PASS.
    const verify = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/verify",
      headers: auth(TENANT_A, empA2, ["employee"]),
      payload: { employeeId: empA2, selfieKey: "s3://fixtures/empA2-enroll.jpg" },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().result).toBe("PASS");
  });

  it("verifying an employee who was never enrolled in THIS tenant still 404s (fail-closed preserved)", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/ai/face/verify",
      headers: auth(TENANT_B, empB1, ["employee"]),
      payload: { employeeId: empB1, selfieKey: "s3://fixtures/never-enrolled.jpg" },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("ai-ml/plugin-registry.ts -- GUC fix", () => {
  it("enabling a plugin persists and shows up in the list (was: always enabled:false, the default)", async () => {
    // NOTE: all three boolean/int optional fields must be supplied on a
    // plugin's FIRST-ever PATCH. This is unrelated to the GUC fix, but is a
    // real, separate, pre-existing bug (predates this branch, see git log)
    // this test would otherwise trip: the INSERT always supplies all 9
    // columns (never omits one to let its DEFAULT apply), and
    // notify_on_prediction/auto_action/max_predictions_per_day are all NOT
    // NULL -- omitting any of them here 500s with a not-null violation, on
    // both pre-fix and post-fix code (confirmed against unmodified main).
    // Flagged in the PR description; not fixed here (out of scope for a
    // tenant-scoping fix).
    // Configuring an AI plugin is a tenant-admin action: PATCH
    // /v1/hrms/ai/plugins/:id now enforces requireRole(tenant_admin/
    // platform_admin/super_admin), matching the web page's own gate
    // (ai-plugins/page.tsx canConfigure) — GAP-TENANT-ADMIN-AI-PLUGINS-03.
    // This GUC regression is role-agnostic, so authenticate as tenant_admin.
    const patch = await app.inject({
      method: "PATCH", url: "/v1/hrms/ai/plugins/nlu-chatbot",
      headers: auth(TENANT_A, HR_A, ["tenant_admin"]),
      payload: { enabled: true, mode: "active", confidenceThreshold: 65, notifyOnPrediction: true, autoAction: false, maxPredictionsPerDay: 500 },
    });
    expect(patch.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET", url: "/v1/hrms/ai/plugins",
      headers: auth(TENANT_A, HR_A, ["tenant_admin"]),
    });
    expect(list.statusCode).toBe(200);
    const nlu = list.json().data.find((p: { id: string }) => p.id === "nlu-chatbot");
    expect(nlu.enabled).toBe(true);
    expect(nlu.confidenceThreshold).toBe(65);
  });

  it("prediction stats reflect real seeded rows (was: always zero/empty)", async () => {
    const predId = await seedPredictionLog(TENANT_A, { pluginId: "nlu-chatbot", confidence: 82, outcome: "correct" });

    const stats = await app.inject({
      method: "GET", url: "/v1/hrms/ai/plugins/nlu-chatbot/stats",
      headers: auth(TENANT_A, HR_A, ["tenant_admin"]),
    });
    expect(stats.statusCode).toBe(200);
    const body = stats.json().data;
    expect(body.recentPredictions.map((p: { id: string }) => p.id)).toContain(predId);
    expect(body.confidenceDistribution.length).toBeGreaterThan(0);

    const feedback = await app.inject({
      method: "POST", url: "/v1/hrms/ai/plugins/nlu-chatbot/feedback",
      headers: auth(TENANT_A, HR_A, ["tenant_admin"]),
      payload: { predictionId: predId, outcome: "correct", notes: "confirmed by fixture" },
    });
    expect(feedback.statusCode).toBe(200);

    const summary = await app.inject({
      method: "GET", url: "/v1/hrms/ai/plugins/summary",
      headers: auth(TENANT_A, HR_A, ["tenant_admin"]),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.predictionsToday).toBeGreaterThanOrEqual(1);
    expect(summary.json().data.activePlugins).toBeGreaterThanOrEqual(1); // nlu-chatbot enabled above
  });

  it("tenant B sees none of tenant A's plugin config or predictions (isolation preserved)", async () => {
    const list = await app.inject({
      method: "GET", url: "/v1/hrms/ai/plugins",
      headers: auth(TENANT_B, HR_B, ["tenant_admin"]),
    });
    const nlu = list.json().data.find((p: { id: string }) => p.id === "nlu-chatbot");
    expect(nlu.enabled).toBe(false); // tenant B never enabled it -- must not see tenant A's config

    const summary = await app.inject({
      method: "GET", url: "/v1/hrms/ai/plugins/summary",
      headers: auth(TENANT_B, HR_B, ["tenant_admin"]),
    });
    expect(summary.json().data.predictionsToday).toBe(0);
  });
});
