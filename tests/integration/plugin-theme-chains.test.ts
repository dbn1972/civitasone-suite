/**
 * V-missing — Plugin/theme lifecycle chain test.
 *
 * Verifies the install.stage.create command → consumer flow:
 * 1. `install.stage.create` command → consumer creates the stage record + audit event
 * 2. The message is idempotent (redelivery doesn't duplicate)
 *
 * Uses the harness pattern: mock install-service's DB and outbox, wire the real
 * stage consumer onto the shared queue, and assert on captured inserts and events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChainHarness, setCurrentHarness } from "./harness.js";

// Replace install-service's DB layer with the in-memory transactional fake.
vi.mock("../../services/install-service/src/shared/db.js", async () => {
  const h = await import("./harness.js");
  return { db: h.mockDb, sqlClient: {} };
});

// Replace install-service's transactional outbox/inbox.
vi.mock("../../services/install-service/src/shared/outbox.js", async () => {
  const h = await import("./harness.js");
  return {
    enqueue: h.mockEnqueue,
    markProcessed: h.mockMarkProcessed,
    outboxMessages: {},
    processed: {},
    outboxSchema: {},
    relayOnce: async () => 0,
    startRelay: () => ({}) as unknown,
  };
});

// Replace install-service's cache (used by consumer for cache.put / invalidateResource)
vi.mock("../../services/install-service/src/shared/infra.js", async () => {
  const { Cache, MemoryCache } = await import("../../packages/cache/src/index.js");
  return {
    cache: new Cache({ service: "install", store: new MemoryCache(), defaultTtlSeconds: 60 }),
  };
});

// Imported AFTER the mocks are declared (vi.mock is hoisted above imports).
const { registerStageConsumers } = await import(
  "../../services/install-service/src/modules/stages/consumer.js"
);

const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "22222222-bbbb-4000-8000-000000000001";

function stageEnvelope(
  messageId: string,
  stagePayload: { id: string; tenantId: string; name: string; stepNumber: number; status: string; description?: string },
) {
  return {
    messageId,
    type: "install.stage.create",
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload: stagePayload,
  };
}

let harness: ChainHarness;

beforeEach(async () => {
  harness = new ChainHarness();
  setCurrentHarness(harness);
  registerStageConsumers(harness.queue);
  await harness.queue.start();
});

afterEach(async () => {
  await harness.queue.stop();
  setCurrentHarness(null);
});

describe("install.stage.create command → stage record + audit", () => {
  it("creates a stage record and emits stageCreated + audit events", async () => {
    const stageCreated = harness.nextEvent("install.stage.created");
    const auditEvent = harness.nextEvent("audit.event.record");

    await harness.queue.publish(
      "install.stage.create",
      stageEnvelope("eeeeeeee-0001-4000-8000-000000000001", {
        id: "55555555-0001-4000-8000-000000000001",
        tenantId: TENANT,
        name: "deployment-mode",
        stepNumber: 1,
        status: "active",
        description: "Choose deployment mode",
      }),
    );

    // Verify stageCreated event was emitted
    const createdMsg = await stageCreated;
    expect(createdMsg.type).toBe("install.stage.created");
    const createdPayload = createdMsg.payload as { stageId: string; name: string };
    expect(createdPayload.stageId).toBe("55555555-0001-4000-8000-000000000001");
    expect(createdPayload.name).toBe("deployment-mode");

    // Verify audit event was emitted
    const auditMsg = await auditEvent;
    expect(auditMsg.type).toBe("audit.event.record");
    const auditPayload = auditMsg.payload as { service: string; action: string; resourceType: string; resourceId: string };
    expect(auditPayload.service).toBe("install");
    expect(auditPayload.action).toBe("create");
    expect(auditPayload.resourceType).toBe("stage");
    expect(auditPayload.resourceId).toBe("55555555-0001-4000-8000-000000000001");

    // Verify the insert was captured
    const stageInsert = harness.inserts.find(
      (i) => i.row.id === "55555555-0001-4000-8000-000000000001",
    );
    expect(stageInsert).toBeDefined();
    expect(stageInsert!.row.name).toBe("deployment-mode");
    expect(stageInsert!.row.stepNumber).toBe(1);
    expect(stageInsert!.row.status).toBe("active");
    expect(stageInsert!.row.version).toBe(1);
  });
});

describe("Idempotency: redelivery does not duplicate stage records", () => {
  it("a redelivered install.stage.create message is processed only once", async () => {
    const events: string[] = [];
    harness.queue.subscribe("install.stage.created", async () => {
      events.push("created");
    });

    const msg = stageEnvelope("eeeeeeee-0002-4000-8000-000000000001", {
      id: "55555555-0002-4000-8000-000000000001",
      tenantId: TENANT,
      name: "tenant-config",
      stepNumber: 2,
      status: "pending",
    });

    // Deliver twice (simulating redelivery)
    await harness.queue.publish("install.stage.create", msg);
    await harness.queue.publish("install.stage.create", msg);
    await new Promise((r) => setTimeout(r, 300));

    // Only one stageCreated event (markProcessed gates the second)
    expect(events).toHaveLength(1);

    // Only one insert for this stage ID
    const stageInserts = harness.inserts.filter(
      (i) => i.row.id === "55555555-0002-4000-8000-000000000001",
    );
    expect(stageInserts).toHaveLength(1);
  });

  it("different stage IDs are both processed (not spuriously deduped)", async () => {
    const events: string[] = [];
    harness.queue.subscribe("install.stage.created", async () => {
      events.push("created");
    });

    const msg1 = stageEnvelope("eeeeeeee-0003-4000-8000-000000000001", {
      id: "55555555-0003-4000-8000-000000000001",
      tenantId: TENANT,
      name: "module-selection",
      stepNumber: 3,
      status: "pending",
    });

    const msg2 = stageEnvelope("eeeeeeee-0004-4000-8000-000000000001", {
      id: "55555555-0004-4000-8000-000000000001",
      tenantId: TENANT,
      name: "data-migration",
      stepNumber: 4,
      status: "pending",
    });

    await harness.queue.publish("install.stage.create", msg1);
    await harness.queue.publish("install.stage.create", msg2);
    await new Promise((r) => setTimeout(r, 300));

    // Both processed (different messageIds)
    expect(events).toHaveLength(2);
    expect(harness.inserts.filter((i) => i.row.name === "module-selection")).toHaveLength(1);
    expect(harness.inserts.filter((i) => i.row.name === "data-migration")).toHaveLength(1);
  });
});
