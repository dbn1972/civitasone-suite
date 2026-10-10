/**
 * STAFF_ROLES gate on the HR self-service routes (fix/hr-staff-only-guards).
 *
 * These routes used to call only resolveContext(): any tenant-valid token, including a
 * citizen-portal account, reached them. Each is now behind requireRole(ctx, STAFF_ROLES)
 * (shared/roles.ts), which excludes `citizen`. For EVERY route below:
 *   - a citizen token gets 403 FORBIDDEN, and nothing is written;
 *   - an `employee` token gets through (2xx).
 * Plus the self-service LIST routes return only the caller's own rows (ctx.actorId).
 *
 * Travel / expense creates are commands (route -> 202 -> consumer insert), so the social
 * consumers are registered here and the in-memory queue is drained after each request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerSocialConsumers } from "../modules/social/consumer.js";
import { STAFF_ROLES } from "../shared/roles.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const STAFF = randomUUID();
const OTHER_STAFF = randomUUID();
const CITIZEN = randomUUID();
const TARGET_EMP = randomUUID();

const tok = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-staff-only" }, SECRET, 3600)}`,
});
const staff = () => tok(STAFF, ["employee"]);
const otherStaff = () => tok(OTHER_STAFF, ["employee"]);
const citizen = () => tok(CITIZEN, ["citizen"]);

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();
async function call(method: string, url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await app.inject({ method: method as "GET", url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await drain();
  return res;
}
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, TENANT, fn);

let surveyId = "";
let goalId = "";

beforeAll(async () => {
  app = await buildApp();
  registerSocialConsumers(queue);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees
      (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, user_ref, created_by, updated_by)
    VALUES (${TARGET_EMP}, ${TENANT}, ${`SO-${TARGET_EMP.slice(0, 8)}`}, 'Birthday Target', ${randomUUID()}, ${randomUUID()}, '2020-01-01', 'confirmed', ${randomUUID()}, ${STAFF}, ${STAFF})`);
  const s = await call("POST", "/v1/hrms/pulse-surveys", tok(randomUUID(), ["hr_admin"]), { question: "How is the workload this quarter?" });
  expect(s.statusCode).toBe(201);
  surveyId = s.json().id;
});

afterAll(async () => {
  for (const t of [
    "hrms.pulse_responses", "hrms.pulse_surveys", "hrms.goal_checkins", "hrms.goals", "hrms.leaderboard_points",
    "claims.hrms_expense_claims", "claims.hrms_travel_requests", "employee.hrms_push_devices", "employee.hrms_employees",
  ]) {
    await asTenant((tx) => tx.unsafe(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`)).catch(() => undefined);
  }
  await app.close();
  await sqlClient.end();
});

describe("STAFF_ROLES itself", () => {
  it("never contains citizen or any external principal, and does contain employee + the HR/office roles", () => {
    for (const bad of ["citizen", "service_account", "guest", "public"]) expect(STAFF_ROLES).not.toContain(bad);
    for (const good of ["employee", "manager", "hr_admin", "hr_officer", "payroll_officer", "payroll_admin", "super_admin", "finance_officer"]) {
      expect(STAFF_ROLES).toContain(good);
    }
  });
});

/**
 * One row per guarded route. `body` is a function so rows that depend on a seeded id
 * (survey, goal) resolve after beforeAll.
 */
interface Row { name: string; method: string; url: () => string; body?: () => unknown }
const ROUTES: Row[] = [
  { name: "GET /pulse-surveys", method: "GET", url: () => "/v1/hrms/pulse-surveys" },
  { name: "POST /pulse-surveys/:id/respond", method: "POST", url: () => `/v1/hrms/pulse-surveys/${surveyId}/respond`, body: () => ({ score: 4, comment: "ok" }) },
  { name: "POST /goals", method: "POST", url: () => "/v1/hrms/goals", body: () => ({ title: "Ship the guard fix" }) },
  { name: "GET /goals", method: "GET", url: () => "/v1/hrms/goals" },
  { name: "POST /goals/:id/checkin", method: "POST", url: () => `/v1/hrms/goals/${goalId || randomUUID()}/checkin`, body: () => ({ progress: 40 }) },
  { name: "GET /leaderboard", method: "GET", url: () => "/v1/hrms/leaderboard" },
  { name: "GET /leaderboard/my-points", method: "GET", url: () => "/v1/hrms/leaderboard/my-points" },
  { name: "POST /assistant", method: "POST", url: () => "/v1/hrms/assistant", body: () => ({ message: "show my payslip" }) },
  { name: "POST /birthdays/:id/wish", method: "POST", url: () => `/v1/hrms/birthdays/${TARGET_EMP}/wish`, body: () => ({ message: "Happy birthday" }) },
  { name: "POST /travel-requests", method: "POST", url: () => "/v1/hrms/travel-requests",
    body: () => ({ purpose: "Site inspection visit", destination: "Pune", fromDate: "2026-11-02", toDate: "2026-11-04" }) },
  { name: "GET /travel-requests", method: "GET", url: () => "/v1/hrms/travel-requests" },
  { name: "POST /expenses", method: "POST", url: () => "/v1/hrms/expenses", body: () => ({ category: "transport", amount: 12500, date: "2026-10-01" }) },
  { name: "POST /devices/register", method: "POST", url: () => "/v1/hrms/devices/register", body: () => ({ token: "tok-123456", platform: "android", deviceId: "dev-staff-only-1" }) },
  { name: "GET /orgchart", method: "GET", url: () => "/v1/hrms/orgchart" },
  { name: "POST /devices/heartbeat", method: "POST", url: () => "/v1/hrms/devices/heartbeat",
    body: () => ({ deviceId: "dev-staff-only-1", deviceName: "Pixel", platform: "android", osVersion: "15", appVersion: "1.0.0" }) },
  { name: "GET /devices/me", method: "GET", url: () => "/v1/hrms/devices/me" },
];

describe("citizen token is rejected 403; employee token is admitted", () => {
  // The goal id must exist before the checkin row runs.
  it("seed: staff creates a goal", async () => {
    const r = await call("POST", "/v1/hrms/goals", staff(), { title: "Seed goal for checkin" });
    expect(r.statusCode).toBe(201);
    goalId = r.json().id;
  });

  for (const row of ROUTES) {
    it(`${row.name}: citizen -> 403 (and nothing written)`, async () => {
      const r = await call(row.method, row.url(), citizen(), row.body?.());
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().code).toBe("FORBIDDEN");
    });

    it(`${row.name}: employee -> 2xx`, async () => {
      const r = await call(row.method, row.url(), staff(), row.body?.());
      expect(r.statusCode, r.body).toBeGreaterThanOrEqual(200);
      expect(r.statusCode, r.body).toBeLessThan(300);
    });
  }

  it("a citizen's rejected writes left no rows behind", async () => {
    const [row] = await asTenant((tx) => tx`
      SELECT (SELECT COUNT(*) FROM claims.hrms_travel_requests WHERE employee_id = ${CITIZEN})::int
           + (SELECT COUNT(*) FROM claims.hrms_expense_claims WHERE employee_id = ${CITIZEN})::int
           + (SELECT COUNT(*) FROM hrms.goals WHERE employee_id = ${CITIZEN})::int
           + (SELECT COUNT(*) FROM hrms.pulse_responses WHERE respondent_id = ${CITIZEN})::int AS n`) as unknown as Array<{ n: number }>;
    const n = row?.n ?? -1;
    expect(n).toBe(0);
  });

  it("an unauthenticated request is still 401, not 403", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/goals" });
    expect(r.statusCode).toBe(401);
  });
});

describe("self-service LIST routes return only the caller's own rows", () => {
  it("GET /goals: another employee's goal never appears", async () => {
    const mine = await call("POST", "/v1/hrms/goals", staff(), { title: "Mine only goal" });
    const theirs = await call("POST", "/v1/hrms/goals", otherStaff(), { title: "Somebody else goal" });
    expect(mine.statusCode).toBe(201);
    expect(theirs.statusCode).toBe(201);
    const list = await call("GET", "/v1/hrms/goals?status=all", staff());
    const ids = (list.json().data as Array<{ id: string }>).map((g) => g.id);
    expect(ids).toContain(mine.json().id);
    expect(ids).not.toContain(theirs.json().id);
  });

  it("GET /travel-requests (default scope): only the caller's own requests", async () => {
    const body = { purpose: "Own travel request", destination: "Delhi", fromDate: "2026-12-01", toDate: "2026-12-02" };
    const mine = await call("POST", "/v1/hrms/travel-requests", staff(), body);
    const theirs = await call("POST", "/v1/hrms/travel-requests", otherStaff(), { ...body, purpose: "Someone elses travel" });
    const list = await call("GET", "/v1/hrms/travel-requests", staff());
    const ids = (list.json().data as Array<{ id: string }>).map((g) => g.id);
    expect(ids).toContain(mine.json().id);
    expect(ids).not.toContain(theirs.json().id);
  });

  it("GET /leaderboard/my-points: only the caller's points", async () => {
    await call("POST", `/v1/hrms/pulse-surveys/${surveyId}/respond`, otherStaff(), { score: 5 });
    const mine = await call("GET", "/v1/hrms/leaderboard/my-points", staff());
    const rows = await asTenant((tx) => tx`SELECT COALESCE(SUM(points),0)::int AS p FROM hrms.leaderboard_points WHERE employee_id = ${STAFF}`) as unknown as Array<{ p: number }>;
    expect(mine.json().totalPoints).toBe(rows[0]!.p);
  });

  it("GET /devices/me: only the caller's own devices", async () => {
    await call("POST", "/v1/hrms/devices/heartbeat", otherStaff(), { deviceId: "dev-other-staff-9", deviceName: "Other", platform: "ios", osVersion: "18", appVersion: "1.0.0" });
    const list = await call("GET", "/v1/hrms/devices/me", staff());
    const ids = (list.json().data as Array<{ device_id?: string; deviceId?: string }>).map((d) => d.device_id ?? d.deviceId);
    expect(ids).not.toContain("dev-other-staff-9");
  });
});
