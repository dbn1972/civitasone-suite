/**
 * Strategic account plan tests (KA-001).
 * Covers list/filter, create, patch with optimistic locking, and activation
 * (including the 422 for a non-draft plan).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000061";
const ACTOR = "cccccccc-3333-4000-8000-000000000061";
const ACCOUNT_A = "dddddddd-4444-4000-8000-00000000061a";
const ACCOUNT_B = "dddddddd-4444-4000-8000-00000000061b";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000061";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-plans" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.account_plans WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function createPlan(payload: Record<string, unknown>, roles = ["crm_user"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/account-plans",
    headers: headers(roles),
    payload,
  });
  await app.close();
  return res;
}

describe("POST /v1/crm/account-plans", () => {
  it("creates a draft plan → 201", async () => {
    const res = await createPlan({
      accountId: ACCOUNT_A,
      planYear: 2026,
      objectives: [{ title: "Grow ARR 20%", metric: "ARR", targetDate: "2026-12-31" }],
      whiteSpace: [{ productLine: "Analytics", rationale: "No footprint yet" }],
      risks: [{ description: "Budget freeze pending", severity: "high" }],
      ownerId: ACTOR,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.status).toBe("draft");
    expect(body.data.planYear).toBe(2026);
    expect(body.data.objectives).toHaveLength(1);
    expect(body.data.version).toBe(1);
  });

  it("defaults empty collections", async () => {
    const res = await createPlan({ accountId: ACCOUNT_B, planYear: 2026 });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.objectives).toEqual([]);
    expect(res.json().data.risks).toEqual([]);
  });

  it("rejects a duplicate account/year → 409", async () => {
    const res = await createPlan({ accountId: ACCOUNT_A, planYear: 2026 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PLAN_EXISTS");
  });

  it("rejects an implausible plan year → 400", async () => {
    const res = await createPlan({ accountId: ACCOUNT_A, planYear: 19999 });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid accountId → 400", async () => {
    const res = await createPlan({ accountId: "nope", planYear: 2027 });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/account-plans",
      payload: { accountId: ACCOUNT_A, planYear: 2027 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const res = await createPlan({ accountId: ACCOUNT_A, planYear: 2027 }, ["citizen"]);
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/account-plans", () => {
  it("returns the list envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/account-plans", headers: headers() });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 50 });
  });

  it("filters by accountId, planYear and status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/account-plans?accountId=${ACCOUNT_A}&planYear=2026&status=draft`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].accountId).toBe(ACCOUNT_A);
  });

  it("returns an empty page beyond the end", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/account-plans?page=50&limit=10",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("rejects limit above the 200 clamp → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/account-plans?limit=201",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/account-plans" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/accounts/:id/plans", () => {
  it("lists plans for one account", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${ACCOUNT_A}/plans`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(1);
  });

  it("returns an empty list for an account with no plans", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${NONEXIST}/plans`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 400 for a non-uuid account", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/accounts/not-a-uuid/plans",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/crm/accounts/${ACCOUNT_A}/plans` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/crm/account-plans/:id", () => {
  it("amends risks and bumps the version → 200", async () => {
    const created = await createPlan({ accountId: ACCOUNT_A, planYear: 2028 });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/account-plans/${id}`,
      headers: headers(),
      payload: { risks: [{ description: "Key sponsor is leaving", severity: "high" }], version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
  });

  it("returns 409 on a stale version", async () => {
    const created = await createPlan({ accountId: ACCOUNT_A, planYear: 2029 });
    const id = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/account-plans/${id}`,
      headers: headers(),
      payload: { status: "closed", version: 42 },
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("rejects an empty patch → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/account-plans/${NONEXIST}`,
      headers: headers(),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown plan", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/account-plans/${NONEXIST}`,
      headers: headers(),
      payload: { status: "closed" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/account-plans/${NONEXIST}`,
      payload: { status: "closed" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/accounts/:id/plans/:planId/activate", () => {
  it("promotes a draft to active → 200", async () => {
    const created = await createPlan({ accountId: ACCOUNT_B, planYear: 2027 });
    const planId = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_B}/plans/${planId}/activate`,
      headers: headers(["crm_admin"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("active");
    expect(res.json().data.version).toBe(2);
  });

  it("refuses to activate an already active plan → 422", async () => {
    const created = await createPlan({ accountId: ACCOUNT_B, planYear: 2030 });
    const planId = created.json().data.id;

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_B}/plans/${planId}/activate`,
      headers: headers(["crm_admin"]),
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_B}/plans/${planId}/activate`,
      headers: headers(["crm_admin"]),
    });
    await app.close();

    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("INVALID_STATE");
  });

  it("returns 404 when the plan belongs to a different account", async () => {
    const created = await createPlan({ accountId: ACCOUNT_B, planYear: 2031 });
    const planId = created.json().data.id;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_A}/plans/${planId}/activate`,
      headers: headers(["crm_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid planId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_A}/plans/not-a-uuid/activate`,
      headers: headers(["crm_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_A}/plans/${NONEXIST}/activate`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user (activation is an admin act)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/accounts/${ACCOUNT_A}/plans/${NONEXIST}/activate`,
      headers: headers(["crm_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
