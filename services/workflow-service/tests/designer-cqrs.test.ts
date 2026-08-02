/**
 * Designer CQRS coverage: commands.ts synchronous pre-checks (404/409/400 and
 * the 202 accepted envelope) plus consumer.ts's authoritative row-level apply.
 * Mirrors instances-commands.test.ts / tasks-commands.test.ts: registers the
 * consumer on a TestQueue and uses q.deliver() to simulate the consumer
 * applying a command payload deterministically (setup AND consumer-logic
 * assertions), while calling the real command functions directly to exercise
 * the pre-check/validation branches.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { sqlClient } from "../src/shared/db.js";
import { registerDesignerConsumers } from "../src/modules/designer/consumer.js";
import * as commands from "../src/modules/designer/commands.js";
import { MAX_ELEMENTS } from "../src/modules/designer/commands.js";
import { COMMANDS } from "../src/topics.js";
import { BpmnParseError } from "../src/modules/designer/bpmn-io.js";
import { TestQueue, sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;

afterEach(async () => {
  if (tenants.length) {
    for (const t of tenants) {
      await sqlAsTenant(t, sql`DELETE FROM workflow.designer_definitions WHERE tenant_id = ${t}`).catch(() => undefined);
    }
    await cleanup(...tenants);
    tenants.length = 0;
  }
});
afterAll(async () => { await sqlClient.end(); });

function makeCtx(tenantId: string, actorId = randomUUID(), roles = ["workflow_admin"]): RequestContext {
  return { tenantId, actorId, roles, correlationId: randomUUID(), sessionId: "s1" } as RequestContext;
}

const NODES = [
  { id: "start1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
  { id: "task1", type: "userTask", label: "Review", position: { x: 200, y: 0 } },
  { id: "end1", type: "endEvent", label: "End", position: { x: 400, y: 0 } },
];
const EDGES = [
  { id: "e1", source: "start1", target: "task1" },
  { id: "e2", source: "task1", target: "end1" },
];

/** Seed a definition row via the (consumer-tested) create path, returns its id. */
async function seedDefinition(tenantId: string, actorId: string, opts: { name?: string } = {}): Promise<string> {
  const id = randomUUID();
  await q.deliver(COMMANDS.createDesignerDefinition, {
    id, tenantId, name: opts.name ?? "Seeded Definition", description: null,
    elements: NODES, edges: EDGES,
  }, { tenantId, actorId, messageId: id });
  return id;
}

const VALID_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://example.com" id="Definitions_1">
  <process id="Process_1" name="Imported Process" isExecutable="true">
    <startEvent id="Start_1" name="Begin" />
    <userTask id="Task_1" name="Do It" />
    <endEvent id="End_1" name="Done" />
    <sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </process>
</definitions>`;

// ── consumer.ts — authoritative row-level apply ──────────────────────────

describe("designer consumer — create", () => {
  it("inserts a draft definition at version 1", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId, { name: "My Process" });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("My Process");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].version).toBe(1);
  });

  it("is idempotent under duplicate delivery (same messageId)", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = randomUUID();
    const messageId = randomUUID();
    const payload = { id, tenantId, name: "Once", description: null, elements: NODES, edges: EDGES };

    await q.deliver(COMMANDS.createDesignerDefinition, payload, { tenantId, actorId, messageId });
    await q.deliver(COMMANDS.createDesignerDefinition, payload, { tenantId, actorId, messageId });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows).toHaveLength(1);
  });
});

describe("designer consumer — update", () => {
  it("applies an update and bumps the version when expectedVersion matches", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId);

    await q.deliver(COMMANDS.updateDesignerDefinition, {
      id, tenantId, expectedVersion: 1, name: "Renamed",
    }, { tenantId, actorId, messageId: randomUUID() });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows[0].name).toBe("Renamed");
    expect(rows[0].version).toBe(2);
  });

  it("no-ops when expectedVersion is stale (authoritative re-check)", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId, { name: "Original" });

    await q.deliver(COMMANDS.updateDesignerDefinition, {
      id, tenantId, expectedVersion: 99, name: "Should Not Apply",
    }, { tenantId, actorId, messageId: randomUUID() });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows[0].name).toBe("Original");
    expect(rows[0].version).toBe(1);
  });

  it("no-ops on a deleted definition", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId);
    await q.deliver(COMMANDS.deleteDesignerDefinition, { id, tenantId }, { tenantId, actorId, messageId: randomUUID() });

    await q.deliver(COMMANDS.updateDesignerDefinition, {
      id, tenantId, expectedVersion: 1, name: "Resurrect Attempt",
    }, { tenantId, actorId, messageId: randomUUID() });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows[0].status).toBe("deleted");
    expect(rows[0].name).not.toBe("Resurrect Attempt");
  });
});

describe("designer consumer — delete", () => {
  it("soft-deletes an existing definition", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId);

    await q.deliver(COMMANDS.deleteDesignerDefinition, { id, tenantId }, { tenantId, actorId, messageId: randomUUID() });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows[0].status).toBe("deleted");
  });

  it("is idempotent when delivered twice", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId);

    await q.deliver(COMMANDS.deleteDesignerDefinition, { id, tenantId }, { tenantId, actorId, messageId: randomUUID() });
    await q.deliver(COMMANDS.deleteDesignerDefinition, { id, tenantId }, { tenantId, actorId, messageId: randomUUID() });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows[0].status).toBe("deleted");
  });
});

describe("designer consumer — import", () => {
  it("replaces elements/edges and bumps version", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const id = await seedDefinition(tenantId, actorId);

    const newElements = [{ id: "s1", type: "startEvent", label: "Begin", position: { x: 0, y: 0 } }];
    const newEdges: unknown[] = [];
    await q.deliver(COMMANDS.importDesignerDefinition, {
      id, tenantId, elements: newElements, edges: newEdges, processName: "Imported Process",
    }, { tenantId, actorId, messageId: randomUUID() });

    const rows = await sqlAsTenant(tenantId, sql`SELECT * FROM workflow.designer_definitions WHERE id = ${id}`);
    expect(rows[0].elements).toHaveLength(1);
    expect(rows[0].version).toBe(2);
  });
});

// ── commands.ts — synchronous pre-checks + accepted envelope ─────────────

describe("designer commands — createDefinition", () => {
  it("returns an accepted envelope for a valid payload", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);

    const result = await asTenant(tenantId, () => commands.createDefinition(ctx, {
      name: "New Definition", elements: NODES, edges: EDGES,
    }));

    expect(result.status).toBe("accepted");
    expect(result.correlationId).toBe(ctx.correlationId);
    expect(result.id).toBeDefined();
  });

  it("rejects when total elements exceed the limit", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);
    const elements = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({
      id: `n_${i}`, type: "userTask", label: `T${i}`, position: { x: i, y: 0 },
    }));

    await expect(asTenant(tenantId, () => commands.createDefinition(ctx, { name: "Too Big", elements, edges: [] })))
      .rejects.toMatchObject({ status: 400, code: "ELEMENT_LIMIT_EXCEEDED" });
  });
});

describe("designer commands — updateDefinition", () => {
  it("returns 404 for a non-existent definition", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);

    await expect(asTenant(tenantId, () => commands.updateDefinition(ctx, randomUUID(), { version: 1 })))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("returns 409 on version conflict", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const ctx = makeCtx(tenantId, actorId);
    const id = await seedDefinition(tenantId, actorId);

    await expect(asTenant(tenantId, () => commands.updateDefinition(ctx, id, { version: 99, name: "x" })))
      .rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
  });

  it("returns 400 when the updated element count exceeds the limit", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const ctx = makeCtx(tenantId, actorId);
    const id = await seedDefinition(tenantId, actorId);
    const elements = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({
      id: `n_${i}`, type: "userTask", label: `T${i}`, position: { x: i, y: 0 },
    }));

    await expect(asTenant(tenantId, () => commands.updateDefinition(ctx, id, { version: 1, elements, edges: [] })))
      .rejects.toMatchObject({ status: 400, code: "ELEMENT_LIMIT_EXCEEDED" });
  });

  it("returns an accepted envelope for a valid update", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const ctx = makeCtx(tenantId, actorId);
    const id = await seedDefinition(tenantId, actorId);

    const result = await asTenant(tenantId, () => commands.updateDefinition(ctx, id, { version: 1, name: "Updated" }));
    expect(result.status).toBe("accepted");
    expect(result.id).toBe(id);
  });
});

describe("designer commands — deleteDefinition", () => {
  it("returns 404 for a non-existent definition", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);

    await expect(asTenant(tenantId, () => commands.deleteDefinition(ctx, randomUUID())))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("returns an accepted envelope for an existing definition", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const ctx = makeCtx(tenantId, actorId);
    const id = await seedDefinition(tenantId, actorId);

    const result = await asTenant(tenantId, () => commands.deleteDefinition(ctx, id));
    expect(result.status).toBe("accepted");
  });
});

describe("designer commands — importDefinition", () => {
  it("returns 404 for a non-existent definition", async () => {
    const tenantId = newTenant();
    const ctx = makeCtx(tenantId);

    await expect(asTenant(tenantId, () => commands.importDefinition(ctx, randomUUID(), VALID_BPMN)))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("rejects malformed XML before publishing (400 via BpmnParseError)", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const ctx = makeCtx(tenantId, actorId);
    const id = await seedDefinition(tenantId, actorId);

    await expect(asTenant(tenantId, () => commands.importDefinition(ctx, id, "not xml at all")))
      .rejects.toBeInstanceOf(BpmnParseError);
  });

  it("returns an accepted envelope for valid BPMN XML", async () => {
    q = new TestQueue();
    registerDesignerConsumers(q);
    const tenantId = newTenant();
    const actorId = randomUUID();
    const ctx = makeCtx(tenantId, actorId);
    const id = await seedDefinition(tenantId, actorId);

    const result = await asTenant(tenantId, () => commands.importDefinition(ctx, id, VALID_BPMN));
    expect(result.status).toBe("accepted");
    expect(result.id).toBe(id);
  });
});
