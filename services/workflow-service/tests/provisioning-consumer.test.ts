/**
 * Coverage tests for provisioning/consumer.ts (0% → target: 100%).
 * Tests the tenant-provisioning flow: tenant.created → seed standard definitions.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { STANDARD_DEFINITIONS } from "../src/modules/provisioning/catalog.js";
import { TestQueue, cleanup } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

let q: TestQueue;
afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

describe("provisioning/consumer — tenantCreated", () => {
  it("seeds all standard definitions for a new tenant", async () => {
    q = new TestQueue();
    registerProvisioningConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();

    await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId });

    // Verify all standard definitions were seeded
    const defs = await db.execute(
      sql`SELECT code, status FROM workflow.definitions WHERE tenant_id = ${tenantId} ORDER BY code`,
    ) as unknown as Array<{ code: string; status: string }>;

    expect(defs.length).toBe(STANDARD_DEFINITIONS.length);
    for (const sd of STANDARD_DEFINITIONS) {
      const found = defs.find((d) => d.code === sd.code);
      expect(found).toBeDefined();
      expect(found!.status).toBe("active");
    }
  });

  it("seeds nodes and edges for each definition", async () => {
    q = new TestQueue();
    registerProvisioningConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();

    await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId });

    // Check file_noting definition has 4 nodes and 3 edges (linear)
    const defRows = await db.execute(
      sql`SELECT id FROM workflow.definitions WHERE tenant_id = ${tenantId} AND code = 'file_noting'`,
    ) as unknown as Array<{ id: string }>;
    expect(defRows.length).toBe(1);
    const defId = defRows[0]!.id;

    const nodes = await db.execute(
      sql`SELECT node_key FROM workflow.definition_nodes WHERE definition_id = ${defId} ORDER BY sort_order`,
    ) as unknown as Array<{ node_key: string }>;
    expect(nodes.length).toBe(4);
    expect(nodes.map((n) => n.node_key)).toEqual(["draft", "section_review", "us_approve", "ds_approve"]);

    const edges = await db.execute(
      sql`SELECT from_node, to_node FROM workflow.definition_edges WHERE definition_id = ${defId} ORDER BY sort_order`,
    ) as unknown as Array<{ from_node: string; to_node: string }>;
    expect(edges.length).toBe(3);
    expect(edges[0]).toEqual({ from_node: "draft", to_node: "section_review" });
    expect(edges[1]).toEqual({ from_node: "section_review", to_node: "us_approve" });
    expect(edges[2]).toEqual({ from_node: "us_approve", to_node: "ds_approve" });
  });

  it("is idempotent — re-delivering does not duplicate definitions", async () => {
    q = new TestQueue();
    registerProvisioningConsumers(q);

    const tenantId = newTenant();
    const actorId = randomUUID();

    // Deliver twice with different message IDs
    await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId, messageId: randomUUID() });
    await q.deliver(CONSUMED_EVENTS.tenantCreated, { tenantId }, { tenantId, actorId, messageId: randomUUID() });

    const defs = await db.execute(
      sql`SELECT code FROM workflow.definitions WHERE tenant_id = ${tenantId}`,
    ) as unknown as Array<{ code: string }>;
    // Should still only have 5 (one per standard definition)
    expect(defs.length).toBe(STANDARD_DEFINITIONS.length);
  });

  it("skips if tenantId is missing from payload", async () => {
    q = new TestQueue();
    registerProvisioningConsumers(q);

    // Deliver with no tenantId in the payload — should not throw
    await q.deliver(CONSUMED_EVENTS.tenantCreated, {}, { tenantId: "", actorId: randomUUID() });
    // No error, nothing seeded
  });
});
