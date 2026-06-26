/**
 * ABAC route tests (inject, HS256 test JWTs, real DB + memory queue).
 *
 * Covers: admin auth guard, tenant isolation on rule storage, and the
 * decision endpoint (permit / deny-overrides / default-deny / cross-tenant).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerAbacConsumers } from "../src/modules/abac/consumer.js";

registerAbacConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Unique tenants per run so prior-run DB rows never leak into assertions.
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ADMIN = randomUUID();
const USER = randomUUID();
const ROLE_MGR = randomUUID();
const createdRuleIds: string[] = [];

function tok(tid: string, roles: string[], sub = ADMIN) {
  return signToken({ sub, tid, roles, sid: "s" }, SECRET);
}
const adminA = { authorization: `Bearer ${tok(TENANT_A, ["tenant_admin"])}`, "content-type": "application/json" };
const adminB = { authorization: `Bearer ${tok(TENANT_B, ["tenant_admin"])}`, "content-type": "application/json" };
const staffA = { authorization: `Bearer ${tok(TENANT_A, ["staff"], USER)}`, "content-type": "application/json" };

const app = await buildApp();

async function post(url: string, body: unknown, headers: Record<string, string>) {
  return app.inject({ method: "POST", url, headers, payload: body as object });
}
async function get(url: string, headers: Record<string, string>) {
  return app.inject({ method: "GET", url, headers });
}

// Poll until the create consumer has materialized the rule (visible via GET).
async function waitRule(id: string, headers: Record<string, string>) {
  for (let i = 0; i < 40; i++) {
    const r = await get(`/v1/policy/abac/rules/${id}`, headers);
    if (r.statusCode === 200) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`rule ${id} never materialized`);
}

const ownerAllow = {
  effect: "allow",
  action: "approve",
  resourceType: "leave",
  predicates: [{ op: "owner-match" }, { op: "tenant-match" }],
};

let ruleAId = "";

beforeAll(async () => {
  // Tenant A: an allow rule for ROLE_MGR on leave.approve, owner+tenant scoped.
  const c = await post("/v1/policy/abac/rules", { roleId: ROLE_MGR, expression: ownerAllow }, adminA);
  expect(c.statusCode).toBe(202);
  ruleAId = JSON.parse(c.body).id;
  createdRuleIds.push(ruleAId);
  await waitRule(ruleAId, adminA);
});

afterAll(async () => {
  for (const id of createdRuleIds) {
    await app.inject({ method: "DELETE", url: `/v1/policy/abac/rules/${id}`, headers: adminA });
  }
});

describe("auth guard", () => {
  it("rejects unauthenticated callers (no token) on rule CRUD", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/policy/abac/rules" });
    expect(r.statusCode).toBe(401);
  });

  it("rejects non-admin role with 403 on rule CRUD", async () => {
    const r = await get("/v1/policy/abac/rules", staffA);
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).code).toBe("FORBIDDEN");
  });

  it("admin can list rules", async () => {
    const r = await get("/v1/policy/abac/rules", adminA);
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(r.body).data)).toBe(true);
  });
});

describe("tenant isolation", () => {
  it("tenant B cannot see tenant A's rule by id (404)", async () => {
    const r = await get(`/v1/policy/abac/rules/${ruleAId}`, adminB);
    expect(r.statusCode).toBe(404);
  });

  it("tenant B's rule list excludes tenant A's rule", async () => {
    const r = await get("/v1/policy/abac/rules", adminB);
    const ids = JSON.parse(r.body).data.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(ruleAId);
  });
});

describe("evaluate decision endpoint", () => {
  const permitReq = {
    subject: { id: USER, roleIds: [ROLE_MGR], attrs: { userId: USER } },
    action: "approve",
    resource: { type: "leave", attrs: { ownerId: USER, tenantId: TENANT_A } },
    context: {},
  };

  it("permits when an allow rule matches", async () => {
    const r = await post("/v1/policy/abac/evaluate", permitReq, staffA);
    expect(r.statusCode).toBe(200);
    const d = JSON.parse(r.body);
    expect(d.decision).toBe("permit");
    expect(d.matchedRuleId).toBe(ruleAId);
  });

  it("default-deny when subject lacks the role", async () => {
    const r = await post("/v1/policy/abac/evaluate",
      { ...permitReq, subject: { id: USER, roleIds: [], attrs: { userId: USER } } }, staffA);
    const d = JSON.parse(r.body);
    expect(d.decision).toBe("deny");
    expect(d.reason).toContain("default-deny");
  });

  it("denies when owner does not match (predicate fails)", async () => {
    const r = await post("/v1/policy/abac/evaluate",
      { ...permitReq, resource: { type: "leave", attrs: { ownerId: "someone-else", tenantId: TENANT_A } } }, staffA);
    expect(JSON.parse(r.body).decision).toBe("deny");
  });

  it("evaluation is scoped to caller's tenant — tenant B sees no rules, default-deny", async () => {
    const r = await post("/v1/policy/abac/evaluate", permitReq,
      { authorization: `Bearer ${tok(TENANT_B, ["staff"], USER)}`, "content-type": "application/json" });
    const d = JSON.parse(r.body);
    expect(d.decision).toBe("deny");
  });

  it("deny-overrides: a deny rule beats the allow rule", async () => {
    const denyAll = { effect: "deny", action: "approve", resourceType: "leave", predicates: [] };
    const c = await post("/v1/policy/abac/rules", { roleId: ROLE_MGR, expression: denyAll }, adminA);
    const denyId = JSON.parse(c.body).id;
    createdRuleIds.push(denyId);
    await waitRule(denyId, adminA);
    const r = await post("/v1/policy/abac/evaluate", permitReq, staffA);
    const d = JSON.parse(r.body);
    expect(d.decision).toBe("deny");
    expect(d.matchedRuleId).toBe(denyId);
  });
});
