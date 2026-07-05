/**
 * Simulation route coverage tests — validates the HTTP layer for
 * POST /v1/workflow/definitions/:id/simulate.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";
import { seedDefinition, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000099";
const UNKNOWN_ID = "00000000-dead-4000-8000-000000000003";

function makeToken(roles: string[] = ["workflow_admin"], sub = "00000000-0001-4000-8000-000000000001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

const tenants: string[] = [];
function trackTenant(t: string) { tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/workflow/definitions/:id/simulate", () => {
  it("returns simulation results for a valid definition", async () => {
    const tenantId = trackTenant(TENANT);
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "start", sortOrder: 1 },
      { nodeKey: "review", name: "Review", nodeType: "task", slaMinutes: 60, sortOrder: 2 },
      { nodeKey: "end", name: "End", nodeType: "end", sortOrder: 3 },
    ], [
      { fromNode: "start", toNode: "review", sortOrder: 1 },
      { fromNode: "review", toNode: "end", sortOrder: 1 },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${def.id}/simulate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { instances: 50 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalSimulated).toBe(50);
    expect(body.data.avgSteps).toBeGreaterThan(0);
    expect(body.data.pathDistribution.length).toBeGreaterThan(0);
    expect(body.data.bottleneckNodes.length).toBeGreaterThan(0);
  });

  it("accepts contextVariants for condition-aware simulation", async () => {
    const tenantId = trackTenant(TENANT);
    const def = await seedDefinition(tenantId, [
      { nodeKey: "start", name: "Start", nodeType: "start", sortOrder: 1 },
      { nodeKey: "gateway", name: "Gateway", nodeType: "xor", sortOrder: 2 },
      { nodeKey: "fast", name: "Fast Track", nodeType: "task", sortOrder: 3 },
      { nodeKey: "slow", name: "Full Review", nodeType: "task", sortOrder: 4 },
      { nodeKey: "end", name: "End", nodeType: "end", sortOrder: 5 },
    ], [
      { fromNode: "start", toNode: "gateway", sortOrder: 1 },
      { fromNode: "gateway", toNode: "fast", condition: "amount < 5000", sortOrder: 1 },
      { fromNode: "gateway", toNode: "slow", condition: "amount >= 5000", sortOrder: 2 },
      { fromNode: "fast", toNode: "end", sortOrder: 1 },
      { fromNode: "slow", toNode: "end", sortOrder: 1 },
    ]);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${def.id}/simulate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: {
        instances: 4,
        contextVariants: [
          { amount: 1000 },
          { amount: 10000 },
          { amount: 2000 },
          { amount: 50000 },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalSimulated).toBe(4);
    expect(body.data.pathDistribution.length).toBe(2);
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/simulate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { instances: 10 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for definition with no nodes", async () => {
    const tenantId = trackTenant(TENANT);
    const def = await seedDefinition(tenantId, [], []);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${def.id}/simulate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { instances: 10 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("EMPTY_GRAPH");
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/simulate`,
      payload: { instances: 10 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/simulate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_user"])}` },
      payload: { instances: 10 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for instances exceeding max (10000)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${UNKNOWN_ID}/simulate`,
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { instances: 50000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions/not-a-uuid/simulate",
      headers: { authorization: `Bearer ${makeToken(["workflow_admin"])}` },
      payload: { instances: 10 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
