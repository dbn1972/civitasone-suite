/**
 * D1 (FE↔BE high ROI) regression coverage:
 *   - GET /v1/workflow/instances/:id — full single-instance detail.
 *   - GET /v1/workflow/tasks?instanceId= — server-side instance-scoped filter.
 *
 * Both previously had no dedicated backend support: the frontend resolved a
 * single instance/its tasks by fetching the ENTIRE tenant list and filtering
 * client-side (apps/web workflowData.ts getInstanceById / getTasksForInstance).
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { instances } from "../src/modules/instances/schema.js";
import { tasks } from "../src/modules/tasks/schema.js";
import { definitions } from "../src/modules/definitions/schema.js";
import { asTenant, sqlAsTenant, cleanup } from "./helpers/engine-harness.js";
import { sql } from "drizzle-orm";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function makeToken(tenantId: string, roles: string[] = ["workflow_admin"], sub = "user-001") {
  return signToken({ sub, tid: tenantId, roles, sid: "sess-d1" }, SECRET);
}

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => {
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

async function seedInstance(tenantId: string, actorId: string, opts: {
  name?: string; status?: string; definitionId?: string; definitionVersion?: number;
  refType?: string; refId?: string;
} = {}): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(instances).values({
      id,
      tenantId,
      name: opts.name ?? "Detail Test Instance",
      status: opts.status ?? "active",
      definitionId: opts.definitionId ?? null,
      definitionVersion: opts.definitionVersion ?? null,
      refType: opts.refType ?? null,
      refId: opts.refId ?? null,
      createdBy: actorId,
      updatedBy: actorId,
      version: 1,
    });
  }));
  return id;
}

async function seedTask(tenantId: string, instanceId: string, actorId: string, opts: { name?: string; status?: string } = {}): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(tasks).values({
      id,
      tenantId,
      instanceId,
      name: opts.name ?? "Detail Test Task",
      status: opts.status ?? "pending",
      createdBy: actorId,
      updatedBy: actorId,
      version: 1,
    });
  }));
  return id;
}

async function seedDefinitionRow(tenantId: string, actorId: string, code: string, name: string): Promise<string> {
  const id = randomUUID();
  await asTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(definitions).values({
      id, tenantId, code, name, version: 1, status: "active", isTemplate: false,
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return id;
}

describe("GET /v1/workflow/instances/:id", () => {
  it("returns full detail for an existing instance, including joined definition code/name", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const defId = await seedDefinitionRow(tenantId, actorId, `code_${randomUUID().slice(0, 6)}`, "My Definition");
    const id = await seedInstance(tenantId, actorId, {
      name: "Purchase Approval #1", definitionId: defId, definitionVersion: 1,
      refType: "procurement_po", refId: randomUUID(),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${id}`,
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(id);
    expect(body.data.name).toBe("Purchase Approval #1");
    expect(body.data.status).toBe("active");
    expect(body.data.definitionId).toBe(defId);
    expect(body.data.definitionName).toBe("My Definition");
    expect(body.data.refType).toBe("procurement_po");
    expect(body.data.version).toBe(1);
    expect(body.data.createdBy).toBe(actorId);
  });

  it("returns 404 for an unknown instance id", async () => {
    const tenantId = newTenant();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${randomUUID()}`,
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("enforces tenant isolation — another tenant's instance is not visible", async () => {
    const tenantId = newTenant();
    const otherTenant = newTenant();
    const actorId = randomUUID();
    const id = await seedInstance(tenantId, actorId);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/instances/${id}`,
      headers: { authorization: `Bearer ${makeToken(otherTenant, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a malformed uuid", async () => {
    const tenantId = newTenant();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances/not-a-uuid",
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/workflow/instances/${randomUUID()}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("still resolves /search as the search route, not an :id lookup", async () => {
    const tenantId = newTenant();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/instances/search",
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    // /search is a valid list-shaped route (200 with a data array), not a 400
    // uuid-parse failure — proving the static route still wins over :id.
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

describe("GET /v1/workflow/tasks?instanceId=", () => {
  it("returns only tasks for the given instance", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const instanceA = await seedInstance(tenantId, actorId, { name: "Instance A" });
    const instanceB = await seedInstance(tenantId, actorId, { name: "Instance B" });
    await seedTask(tenantId, instanceA, actorId, { name: "Task A1" });
    await seedTask(tenantId, instanceA, actorId, { name: "Task A2" });
    await seedTask(tenantId, instanceB, actorId, { name: "Task B1" });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks?instanceId=${instanceA}`,
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.every((t: { instanceId: string }) => t.instanceId === instanceA)).toBe(true);
  });

  it("returns an empty list for an instance with no tasks", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const instanceId = await seedInstance(tenantId, actorId);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow/tasks?instanceId=${instanceId}`,
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("rejects a malformed instanceId with 400", async () => {
    const tenantId = newTenant();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/tasks?instanceId=not-a-uuid",
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("without instanceId still returns the full tenant task list", async () => {
    const tenantId = newTenant();
    const actorId = randomUUID();
    const instanceA = await seedInstance(tenantId, actorId);
    await seedTask(tenantId, instanceA, actorId, { name: "Unfiltered Task" });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/workflow/tasks",
      headers: { authorization: `Bearer ${makeToken(tenantId, ["workflow_user"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((t: { name: string }) => t.name === "Unfiltered Task")).toBe(true);
  });
});
