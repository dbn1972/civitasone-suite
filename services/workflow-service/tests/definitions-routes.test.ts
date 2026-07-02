/**
 * Coverage tests for definitions/routes.ts (23.71% → target: 80%+).
 * Tests CRUD + deploy + template clone.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { seedDefinition, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-ccc000000001";
const ACTOR = "aaaaaaaa-3333-4000-8000-ccc000000001";

const tenants: string[] = [TENANT];
function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["workflow_admin"], sid: "sess-001" }, SECRET);
}
function userToken() {
  return signToken({ sub: "bbbbbbbb-3333-4000-8000-ccc000000002", tid: TENANT, roles: ["workflow_user"], sid: "sess-001" }, SECRET);
}

afterEach(async () => { await cleanup(TENANT); });
afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/workflow/definitions", () => {
  it("creates a draft definition with nodes + edges", async () => {
    const app = await buildApp();
    const code = `def_${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        code,
        name: "Test Workflow",
        nodes: [
          { nodeKey: "s1", name: "Step 1", nodeType: "task" },
          { nodeKey: "s2", name: "Step 2", nodeType: "task" },
        ],
        edges: [{ fromNode: "s1", toNode: "s2" }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.code).toBe(code);
    expect(body.data.status).toBe("draft");
    expect(body.data.version).toBe(1);
  });

  it("creates a minimal definition (no graph)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { code: `min_${randomUUID().slice(0, 8)}`, name: "Min" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
  });

  it("returns 400 for invalid graph (dangling edge)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        code: `bad_${randomUUID().slice(0, 8)}`,
        name: "Bad Graph",
        nodes: [{ nodeKey: "s1", name: "Step 1" }],
        edges: [{ fromNode: "s1", toNode: "nonexistent" }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_GRAPH");
  });

  it("returns 403 for non-admin user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: { code: "test", name: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("auto-increments version for same code", async () => {
    const app = await buildApp();
    const code = `ver_${randomUUID().slice(0, 8)}`;
    await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { code, name: "V1" },
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { code, name: "V2" },
    });
    await app.close();
    expect(res2.json().data.version).toBe(2);
  });
});

describe("GET /v1/workflow/definitions", () => {
  it("lists definitions for tenant", async () => {
    const app = await buildApp();
    await seedDefinition(TENANT, [
      { nodeKey: "a", name: "A", nodeType: "task", sortOrder: 1 },
    ], []);
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/definitions",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /v1/workflow/definitions/:id", () => {
  it("returns definition with nodes and edges", async () => {
    const def = await seedDefinition(TENANT, [
      { nodeKey: "a", name: "A", nodeType: "task", sortOrder: 1 },
      { nodeKey: "b", name: "B", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "a", toNode: "b", sortOrder: 1 }]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/definitions/${def.id}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.nodes.length).toBe(2);
    expect(res.json().data.edges.length).toBe(1);
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/definitions/${randomUUID()}`,
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/workflow/definitions/:id/deploy", () => {
  it("deploys a draft definition (activates it)", async () => {
    const def = await seedDefinition(TENANT, [
      { nodeKey: "a", name: "A", nodeType: "task", sortOrder: 1 },
    ], [], { status: "draft" });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${def.id}/deploy`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("active");
  });

  it("returns 409 for already-active definition", async () => {
    const def = await seedDefinition(TENANT, [
      { nodeKey: "a", name: "A", nodeType: "task", sortOrder: 1 },
    ], []);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${def.id}/deploy`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_DEPLOYED");
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/definitions/${randomUUID()}/deploy`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/workflow/templates", () => {
  it("returns template definitions", async () => {
    await seedDefinition(TENANT, [
      { nodeKey: "t1", name: "T1", nodeType: "task", sortOrder: 1 },
    ], [], { isTemplate: true });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/templates",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
    expect(res.json().data[0].isTemplate).toBe(true);
  });
});

describe("POST /v1/workflow/templates/:id/clone", () => {
  it("clones a template into the tenant as a draft", async () => {
    const tpl = await seedDefinition(TENANT, [
      { nodeKey: "x1", name: "X1", nodeType: "task", sortOrder: 1 },
      { nodeKey: "x2", name: "X2", nodeType: "task", sortOrder: 2 },
    ], [{ fromNode: "x1", toNode: "x2", sortOrder: 1 }], { isTemplate: true });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/templates/${tpl.id}/clone`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "My Clone" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe("draft");
    expect(res.json().data.clonedFrom).toBe(tpl.id);
  });

  it("returns 404 for non-template id", async () => {
    const def = await seedDefinition(TENANT, [
      { nodeKey: "y", name: "Y", nodeType: "task", sortOrder: 1 },
    ], []);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/templates/${def.id}/clone`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
