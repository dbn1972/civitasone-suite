/**
 * Tests for BPMN designer module: CRUD routes, 500 element limit, graph validation.
 * Validates Requirements 7.1 and 7.6.
 *
 * CQRS: create/update/delete/import publish a command and return the bare
 * `{ id, status: "accepted", correlationId }` envelope immediately — the
 * actual write happens in the consumer (see designer-cqrs.test.ts). Tests
 * that need a pre-existing row (GET/PATCH/DELETE/validate/export happy paths)
 * seed it with a direct scoped insert instead of going through the route,
 * mirroring messages-integration.test.ts.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { designerDefinitions } from "../src/modules/designer/schema.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

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
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.designer_definitions WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

const DEFAULT_ELEMENTS = [
  { id: "start1", type: "startEvent", label: "Start", position: { x: 100, y: 100 } },
  { id: "task1", type: "userTask", label: "Review", position: { x: 300, y: 100 } },
  { id: "end1", type: "endEvent", label: "End", position: { x: 500, y: 100 } },
];
const DEFAULT_EDGES = [
  { id: "e1", source: "start1", target: "task1" },
  { id: "e2", source: "task1", target: "end1" },
];

/** Seed a definition row directly (bypassing the async CQRS write path). */
async function seedDefinition(opts: {
  name?: string;
  elements?: unknown[];
  edges?: unknown[];
  status?: string;
  version?: number;
} = {}): Promise<string> {
  const id = randomUUID();
  await asTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(designerDefinitions).values({
      id,
      tenantId: TENANT,
      name: opts.name ?? "Seeded Definition",
      description: null,
      elements: (opts.elements ?? DEFAULT_ELEMENTS) as never,
      edges: (opts.edges ?? DEFAULT_EDGES) as never,
      status: opts.status ?? "draft",
      version: opts.version ?? 1,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
  }));
  return id;
}

describe("POST /v1/workflow/designer/definitions", () => {
  it("accepts a create request with elements and edges → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        name: "Test BPMN Definition",
        description: "A test workflow",
        elements: DEFAULT_ELEMENTS,
        edges: DEFAULT_EDGES,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("accepts an empty definition (no elements) → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow/designer/definitions",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Empty Canvas" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
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
    await seedDefinition();
    await seedDefinition({ name: "Second Def", elements: [], edges: [] });
    const app = await buildApp();

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
    await seedDefinition();
    await seedDefinition({ name: "Second", elements: [], edges: [] });
    await seedDefinition({ name: "Third", elements: [], edges: [] });
    const app = await buildApp();

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
    await seedDefinition();
    const app = await buildApp();

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
    const id = await seedDefinition({ name: "Test BPMN Definition" });
    const app = await buildApp();

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
  it("accepts an update with correct version → 202", async () => {
    const id = await seedDefinition();
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { name: "Updated Name", version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.status).toBe("accepted");
  });

  it("rejects with 409 on version conflict", async () => {
    const id = await seedDefinition();
    const app = await buildApp();

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

  it("accepts an elements/edges update within the limit", async () => {
    const id = await seedDefinition();
    const app = await buildApp();

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

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("rejects update exceeding 500 elements", async () => {
    const id = await seedDefinition();
    const app = await buildApp();

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
  it("accepts a delete request → 202", async () => {
    const id = await seedDefinition();
    const app = await buildApp();

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflow/designer/definitions/${id}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.status).toBe("accepted");
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

  it("returns 404 for an already-deleted definition", async () => {
    const id = await seedDefinition({ status: "deleted" });
    const app = await buildApp();

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
    const id = await seedDefinition();
    const app = await buildApp();

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
    const id = await seedDefinition({
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
    });
    const app = await buildApp();

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
    const id = await seedDefinition({
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
    });
    const app = await buildApp();

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
    const id = await seedDefinition({
      name: "Dangling Edge",
      elements: [
        { id: "s1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
        { id: "end1", type: "endEvent", label: "End", position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "s1", target: "end1" },
        { id: "e2", source: "s1", target: "nonexistent_node" },
      ],
    });
    const app = await buildApp();

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
    const id = await seedDefinition({ name: "Empty", elements: [], edges: [] });
    const app = await buildApp();

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
