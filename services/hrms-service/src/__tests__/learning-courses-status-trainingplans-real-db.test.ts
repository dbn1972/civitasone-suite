/**
 * GAP-LEARNING-COURSES-01 (status scoping) + GAP-LEARNING-TRAINING-PLANS-05
 * (year filter / pagination), real-DB round-trip.
 *
 * COURSES-01: non-HR roles only ever see published courses in the list, and a
 * draft/retired course 404s for them on the detail route; HR sees all and can
 * filter by status.
 *
 * TRAINING-PLANS-05: the list route returns {data,total}, honours ?year and
 * ?limit/?offset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const TENANT     = "facade00-1ea2-4000-8000-000000000b01";
const SEED_ACTOR = "facade00-1ea2-4000-8000-0000000000fe";

const PUB_COURSE   = "facade00-1ea2-4000-8000-0000000000f1";
const DRAFT_COURSE = "facade00-1ea2-4000-8000-0000000000f2";

const PLAN_2025 = "facade00-1ea2-4000-8000-0000000000a1";
const PLAN_2026A = "facade00-1ea2-4000-8000-0000000000a2";
const PLAN_2026B = "facade00-1ea2-4000-8000-0000000000a3";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-learning-courses-tp" }, SECRET);
}
const empToken = tok(["employee"], "learning-courses-emp");
const hrToken  = tok(["hr_admin"], "learning-courses-hr");

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, TENANT, fn);

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM learning.training_plans WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM learning.courses WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();
  await asTenant((tx) => tx`
    INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
    VALUES (${PUB_COURSE}, ${TENANT}, 'PUB-1', 'Published Course', 'general', '2', 'published', ${SEED_ACTOR})`);
  await asTenant((tx) => tx`
    INSERT INTO learning.courses (id, tenant_id, code, title, category, credit_hours, status, created_by)
    VALUES (${DRAFT_COURSE}, ${TENANT}, 'DRAFT-1', 'Draft Course', 'general', '1', 'draft', ${SEED_ACTOR})`);

  for (const [id, yr] of [[PLAN_2025, 2025], [PLAN_2026A, 2026], [PLAN_2026B, 2026]] as const) {
    await asTenant((tx) => tx`
      INSERT INTO learning.training_plans (id, tenant_id, title, plan_year, status, created_by)
      VALUES (${id}, ${TENANT}, ${"Plan " + id.slice(-2)}, ${yr}, 'draft', ${SEED_ACTOR})`);
  }

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/learning/courses — status scoping (GAP-LEARNING-COURSES-01)", () => {
  it("employee sees ONLY published courses", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/learning/courses", headers: { authorization: `Bearer ${empToken}` } });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ id: string; status: string }>;
    expect(rows.every((c) => c.status === "published")).toBe(true);
    expect(rows.some((c) => c.id === DRAFT_COURSE)).toBe(false);
    expect(rows.some((c) => c.id === PUB_COURSE)).toBe(true);
  });

  it("employee cannot pass ?status=draft to reveal drafts", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/learning/courses?status=draft", headers: { authorization: `Bearer ${empToken}` } });
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ id: string }>;
    expect(rows.some((c) => c.id === DRAFT_COURSE)).toBe(false);
  });

  it("HR sees all, and can filter by status=draft", async () => {
    const all = await app.inject({ method: "GET", url: "/v1/hrms/learning/courses", headers: { authorization: `Bearer ${hrToken}` } });
    const allRows = all.json() as Array<{ id: string }>;
    expect(allRows.some((c) => c.id === DRAFT_COURSE)).toBe(true);
    expect(allRows.some((c) => c.id === PUB_COURSE)).toBe(true);

    const drafts = await app.inject({ method: "GET", url: "/v1/hrms/learning/courses?status=draft", headers: { authorization: `Bearer ${hrToken}` } });
    const draftRows = drafts.json() as Array<{ id: string; status: string }>;
    expect(draftRows.every((c) => c.status === "draft")).toBe(true);
    expect(draftRows.some((c) => c.id === DRAFT_COURSE)).toBe(true);
  });

  it("employee gets 404 on a draft course detail; HR gets 200", async () => {
    const empRes = await app.inject({ method: "GET", url: `/v1/hrms/learning/courses/${DRAFT_COURSE}`, headers: { authorization: `Bearer ${empToken}` } });
    expect(empRes.statusCode).toBe(404);
    const hrRes = await app.inject({ method: "GET", url: `/v1/hrms/learning/courses/${DRAFT_COURSE}`, headers: { authorization: `Bearer ${hrToken}` } });
    expect(hrRes.statusCode).toBe(200);
  });
});

describe("GET /v1/hrms/learning/training-plans — pagination/year (GAP-LEARNING-TRAINING-PLANS-05)", () => {
  it("returns {data,total} with total across all 3 plans", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/learning/training-plans", headers: { authorization: `Bearer ${empToken}` } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { data: unknown[]; total: number };
    expect(body.total).toBe(3);
    expect(body.data.length).toBe(3);
  });

  it("?year=2026 returns only the two 2026 plans", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/learning/training-plans?year=2026", headers: { authorization: `Bearer ${empToken}` } });
    const body = r.json() as { data: Array<{ planYear: number }>; total: number };
    expect(body.total).toBe(2);
    expect(body.data.every((p) => p.planYear === 2026)).toBe(true);
  });

  it("?limit=1&offset=0 returns 1 row but total still reflects the full set", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/learning/training-plans?limit=1&offset=0", headers: { authorization: `Bearer ${empToken}` } });
    const body = r.json() as { data: unknown[]; total: number };
    expect(body.data.length).toBe(1);
    expect(body.total).toBe(3);
  });
});
