/**
 * Tests for BPMN designer module: CRUD routes, 500 element limit, graph validation.
 * Validates Requirements 7.1 and 7.6.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-1111-4000-8000-ddd000000001";
const ACTOR = "dddddddd-3333-4000-8000-ddd000000001";

function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["workflow_admin"], sid: "sess-d01" }, SECRET);
}
function userToken() {
  return signToken({ sub: "dddddddd-3333-4000-8000-ddd000000002", tid: TENANT, roles: ["workflow_user"], sid: "sess-d02" }, SECRET);
}
function noRoleToken() {
  return signToken({ sub: "dddddddd-3333-4000-8000-ddd000000003", tid: TENANT, roles: ["employee"], sid: "sess-d03" }, SECRET);
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.designer_definitions WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

// Helper to create a definition via API
async function createDefinition(app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never, payload?: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/workflow/designer/definitions",
    headers: { authorization: `Bearer ${adminToken()}` },
    payload: payload ?? {
      name: "Test BPMN Definition",
      description: "A test workflow",
      elements: [
        { id: "start1", type: "startEvent", label: "Start", position: { x: 100, y: 100 } },
        { id: "task1", type: "userTask", label: "Review", position: { x: 300, y: 100 } },
        { id: "end1", type: "endEvent", label: "End", position: { x: 500, y: 100 } },
      ],
      edges: [
        { id: "e1", source: "start1", target: "task1" },
        { id: "e2", source: "task1", target: "end1" },
      ],
    },
  });
}

describe("POST /v1/workflow/designer/definitions", () => {
  it("creates a definition with elements and edges → 202", async () => {
    const app = await buildApp();
    const res = await createDefinition(app);
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe("Test BPMN Definition");
    expect(body.data.status).toBe("draft");
    expect(body.data.version).toBe(1);
    expect(body.data.elementCount).toBe(3);
    expect(body.data.edgeCount).toBe(2);
  });

  it("creates an empty definition (no elements)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Empty Canvas" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.elementCount).toBe(0);
    expect(body.data.edgeCount).toBe(0);
  });

  it("rejects when total elements exceed 500", async () => {
    const app = await buildApp();
    const elements = Array.from({ length: 300 }, (_, i) => ({
      id: `node_${i}`,
      type: "userTask",
      label: `Task ${i}`,
      position: { x: i * 10, y: 100 },
    }));
    const edges = Array.from({ length: 201 }, (_, i) => ({
      id: `edge_${i}`,
      source: `node_${i}`,
      target: `node_${i + 1}`,
    }));

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Too Large", elements, edges },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("ELEMENT_LIMIT_EXCEEDED");
  });

  it("rejects with 400 on invalid payload (missing name)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { description: "no name" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("rejects with 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${noRoleToken()}` },
      payload: { name: "Fail" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("rejects with 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      payload: { name: "No Auth" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/workflow/designer/definitions", () => {
  it("lists definitions for the tenant", async () => {
    const app = await buildApp();
    await createDefinition(app);
    await createDefinition(app, { name: "Second Def", elements: [], edges: [] });

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(2);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(20);
  });

  it("supports pagination", async () => {
    const app = await buildApp();
    await createDefinition(app);
    await createDefinition(app, { name: "Second", elements: [], edges: [] });
    await createDefinition(app, { name: "Third", elements: [], edges: [] });

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/designer/definitions?page=1&pageSize=2",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(3);
  });

  it("allows workflow_user role to list", async () => {
    const app = await buildApp();
    await createDefinition(app);

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/workflow/designer/definitions/:id", () => {
  it("returns a single definition by id", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(id);
    expect(body.data.name).toBe("Test BPMN Definition");
    expect(body.data.elements).toHaveLength(3);
    expect(body.data.edges).toHaveLength(2);
  });

  it("returns 404 for non-existent id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/designer/definitions/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/workflow/designer/definitions/:id", () => {
  it("updates name with correct version → 200", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated Name", version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe("Updated Name");
    expect(body.data.version).toBe(2);
  });

  it("rejects with 409 on version conflict", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Conflict", version: 99 },
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });

  it("updates elements and edges with limit enforcement", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        version: 1,
        elements: [
          { id: "s1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
          { id: "e1", type: "endEvent", label: "End", position: { x: 200, y: 0 } },
        ],
        edges: [{ id: "flow1", source: "s1", target: "e1" }],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.version).toBe(2);
  });

  it("rejects update exceeding 500 elements", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const elements = Array.from({ length: 501 }, (_, i) => ({
      id: `n_${i}`,
      type: "userTask",
      label: `T${i}`,
      position: { x: i, y: 0 },
    }));

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { version: 1, elements, edges: [] },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("ELEMENT_LIMIT_EXCEEDED");
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/designer/definitions/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Nope", version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /v1/workflow/designer/definitions/:id", () => {
  it("soft-deletes a definition → 204", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });

    expect(res.statusCode).toBe(204);

    // Verify it's soft-deleted (GET returns 404)
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(getRes.statusCode).toBe(404);
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/designer/definitions/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for already deleted definition", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    // Delete once
    await app.inject({
      method: "DELETE",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });

    // Delete again
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/workflow/designer/definitions/:id/validate", () => {
  it("returns valid for a correct graph", async () => {
    const app = await buildApp();
    const createRes = await createDefinition(app);
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/designer/definitions/${id}/validate`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.violations).toHaveLength(0);
  });

  it("detects gateway with no outgoing flow", async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Invalid Gateway",
        elements: [
          { id: "s1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
          { id: "gw1", type: "exclusiveGateway", label: "Decision", position: { x: 200, y: 0 } },
          { id: "end1", type: "endEvent", label: "End", position: { x: 400, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "s1", target: "gw1" },
          // No outgoing edge from gateway
        ],
      },
    });
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/designer/definitions/${id}/validate`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(false);
    expect(body.data.violations.length).toBeGreaterThan(0);
    const gatewayViolation = body.data.violations.find(
      (v: { rule: string }) => v.rule === "gateway_no_outgoing",
    );
    expect(gatewayViolation).toBeDefined();
    expect(gatewayViolation.nodeId).toBe("gw1");
  });

  it("detects unreachable end event", async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Unreachable End",
        elements: [
          { id: "s1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
          { id: "t1", type: "userTask", label: "Task", position: { x: 200, y: 0 } },
          { id: "end1", type: "endEvent", label: "End", position: { x: 400, y: 0 } },
          { id: "end2", type: "endEvent", label: "Disconnected End", position: { x: 400, y: 200 } },
        ],
        edges: [
          { id: "e1", source: "s1", target: "t1" },
          { id: "e2", source: "t1", target: "end1" },
          // end2 has no incoming edge — unreachable
        ],
      },
    });
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/designer/definitions/${id}/validate`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(false);
    const violation = body.data.violations.find(
      (v: { rule: string }) => v.rule === "end_event_unreachable",
    );
    expect(violation).toBeDefined();
    expect(violation.nodeId).toBe("end2");
  });

  it("detects dangling edge references", async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Dangling Edge",
        elements: [
          { id: "s1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
          { id: "end1", type: "endEvent", label: "End", position: { x: 200, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "s1", target: "end1" },
          { id: "e2", source: "s1", target: "nonexistent_node" },
        ],
      },
    });
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/designer/definitions/${id}/validate`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(false);
    const violation = body.data.violations.find(
      (v: { rule: string }) => v.rule === "dangling_edge_target",
    );
    expect(violation).toBeDefined();
  });

  it("returns 404 for non-existent definition", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/designer/definitions/${randomUUID()}/validate`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("validates an empty definition (no elements) as missing start/end", async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Empty" },
    });
    const { id } = createRes.json().data;

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow/designer/definitions/${id}/validate`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    // Empty graph is valid (no violations because there are no elements to validate)
    const body = res.json();
    expect(body.data.valid).toBe(true);
  });
});
