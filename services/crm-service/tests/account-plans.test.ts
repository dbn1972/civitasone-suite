/**
 * Strategic account plan tests (KA-001).
 * Covers list/filter, create, patch with optimistic locking, and activation
 * (including the 422 for a non-draft plan).
 *
 * Writes are CQRS: the route returns 202 Accepted and the consumer applies the
 * row, so every mutating helper drains the queue and state is asserted through
 * the read path.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

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

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
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
  await drainQueue();
  return res;
}

async function patchPlan(id: string, payload: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/crm/account-plans/${id}`,
    headers: headers(),
    payload,
  });
  await app.close();
  await drainQueue();
  return res;
}

async function activatePlan(accountId: string, planId: string) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: `/v1/crm/accounts/${accountId}/plans/${planId}/activate`,
    headers: headers(["crm_admin"]),
  });
  await app.close();
  await drainQueue();
  return res;
}

/** Read a plan back through the real list route, after the consumer applied. */
async function fetchPlan(id: string): Promise<Record<string, unknown>> {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/crm/account-plans?limit=200",
    headers: headers(),
  });
  await app.close();
  const row = res.json().data.find((r: { id: string }) => r.id === id);
  expect(row, `account plan ${id} was never applied by the consumer`).toBeDefined();
  return row;
}

describe("POST /v1/crm/account-plans", () => {
  it("creates a draft plan → 202, applied as draft", async () => {
    const res = await createPlan({
      accountId: ACCOUNT_A,
      planYear: 2026,
      objectives: [{ title: "Grow ARR 20%", metric: "ARR", targetDate: "2026-12-31" }],
      whiteSpace: [{ productLine: "Analytics", rationale: "No footprint yet" }],
      risks: [{ description: "Budget freeze pending", severity: "high" }],
      ownerId: ACTOR,
    });

    expect(res.statusCode).toBe(202);
    const row = await fetchPlan(res.json().id);
    expect(row.status).toBe("draft");
    expect(row.planYear).toBe(2026);
    expect(row.objectives).toHaveLength(1);
    expect(row.version).toBe(1);
  });

  it("defaults empty collections", async () => {
    const res = await createPlan({ accountId: ACCOUNT_B, planYear: 2026 });
    expect(res.statusCode).toBe(202);
    const row = await fetchPlan(res.json().id);
    expect(row.objectives).toEqual([]);
    expect(row.risks).toEqual([]);
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
  it("amends risks and bumps the version → 202", async () => {
    const created = await createPlan({ accountId: ACCOUNT_A, planYear: 2028 });
    const id = created.json().id;

    const res = await patchPlan(id, {
      risks: [{ description: "Key sponsor is leaving", severity: "high" }],
      version: 1,
    });

    expect(res.statusCode).toBe(202);
    const row = await fetchPlan(id);
    expect(row.risks).toHaveLength(1);
    expect(row.version).toBe(2);
  });

  it("returns 409 on a stale version", async () => {
    const created = await createPlan({ accountId: ACCOUNT_A, planYear: 2029 });
    const id = created.json().id;

    const res = await patchPlan(id, { status: "closed", version: 42 });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
    // The stale write must never reach the consumer, or it would be dropped
    // silently after the caller was told the command was accepted.
    expect((await fetchPlan(id)).status).toBe("draft");
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
  it("promotes a draft to active → 202, applied as active", async () => {
    const created = await createPlan({ accountId: ACCOUNT_B, planYear: 2027 });
    const planId = created.json().id;

    const res = await activatePlan(ACCOUNT_B, planId);

    expect(res.statusCode).toBe(202);
    const row = await fetchPlan(planId);
    expect(row.status).toBe("active");
    expect(row.version).toBe(2);
  });

  it("refuses to activate an already active plan → 422", async () => {
    const created = await createPlan({ accountId: ACCOUNT_B, planYear: 2030 });
    const planId = created.json().id;

    expect((await activatePlan(ACCOUNT_B, planId)).statusCode).toBe(202);
    const second = await activatePlan(ACCOUNT_B, planId);

    expect(second.statusCode).toBe(422);
    expect(second.json().code).toBe("INVALID_STATE");
  });

  it("returns 404 when the plan belongs to a different account", async () => {
    const created = await createPlan({ accountId: ACCOUNT_B, planYear: 2031 });
    const planId = created.json().id;

    const res = await activatePlan(ACCOUNT_A, planId);
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
