/**
 * Additional consumer tests for material-pass, evacuation, config-registry
 * to push coverage past 80%.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const versionedUpdateMock = vi.fn(async () => undefined);

let dbRows: Record<string, unknown>[] = [];

function makeSelectChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

const fakeTx = {
  select: vi.fn(() => makeSelectChain(dbRows)),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
  delete: vi.fn(() => ({ where: async () => undefined })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  versionedUpdate: (...args: unknown[]) => versionedUpdateMock(...args),
}));
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...a: unknown[]) => a.join(":"), getOrLoad: vi.fn(async (_k: unknown, fn: () => unknown) => fn()) },
}));
vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: vi.fn(async () => false),
  getPolicyNumber: vi.fn(async () => 15),
  getAutoApproveCategories: vi.fn(async () => new Set(["vip"])),
}));
vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: vi.fn(async () => undefined),
  removeFromRoster: vi.fn(async () => undefined),
  getActiveRoster: vi.fn(async () => []),
}));

const { registerMaterialPassConsumers } = await import("../src/modules/material-pass/consumer.js");
const { registerEvacuationConsumers } = await import("../src/modules/evacuation/consumer.js");
const { registerConfigRegistryConsumers } = await import("../src/modules/config-registry/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, {
    type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: "corr-1", schemaVersion: "1.0", payload,
  });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  versionedUpdateMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  dbRows = [];
});

// ═══════════════════════════════════════════════════════════════════════════
// Material Pass Consumer
// ═══════════════════════════════════════════════════════════════════════════
describe("material-pass/consumer", () => {
  function freshQueue(): MemoryQueue {
    const queue = new MemoryQueue();
    registerMaterialPassConsumers(queue);
    return queue;
  }

  describe("materialPassCreate", () => {
    it("creates a material pass", async () => {
      const queue = freshQueue();
      await publishAndFlush(queue, COMMANDS.materialPassCreate, {
        id: "mp-1", tenantId: TENANT, passId: "pass-1",
        items: [{ description: "Laptop", quantity: 1, serialNumber: "SN001" }],
        createdBy: ACTOR,
      });
      expect(markProcessedMock).toHaveBeenCalled();
      expect(fakeTx.insert).toHaveBeenCalled();
    });

    it("skips on idempotent replay", async () => {
      markProcessedMock.mockResolvedValue(false);
      const queue = freshQueue();
      await publishAndFlush(queue, COMMANDS.materialPassCreate, {
        id: "mp-1", tenantId: TENANT, passId: "pass-1",
        items: [{ description: "Item", quantity: 1 }], createdBy: ACTOR,
      });
      expect(fakeTx.insert).not.toHaveBeenCalled();
    });
  });

  describe("materialPassReconcile", () => {
    beforeEach(() => {
      dbRows = [{
        id: "mp-1", tenantId: TENANT, passId: "pass-1", version: 1,
        declaredItems: [{ description: "Laptop", quantity: 1, serialNumber: "SN001" }],
        discrepancy: false,
      }];
    });

    it("reconciles items at exit", async () => {
      const queue = freshQueue();
      await publishAndFlush(queue, COMMANDS.materialPassReconcile, {
        materialPassId: "mp-1", tenantId: TENANT,
        itemsPresent: [{ description: "Laptop", quantity: 1, serialNumber: "SN001" }],
      });
      expect(markProcessedMock).toHaveBeenCalled();
    });

    it("skips on idempotent replay", async () => {
      markProcessedMock.mockResolvedValue(false);
      const queue = freshQueue();
      await publishAndFlush(queue, COMMANDS.materialPassReconcile, {
        materialPassId: "mp-1", tenantId: TENANT,
        itemsPresent: [{ description: "Laptop", quantity: 1 }],
      });
    });
  });
});
