/**
 * Feature-store consumer wiring — T2-01.
 * Ensures domain entity events trigger feature vector recomputation and that
 * the worker registers registerFeatureStoreConsumers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Queue } from "@civitasone/queue";

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockComputeAndCache = vi.fn().mockResolvedValue({
  tenantId: "t1",
  domain: "leads",
  entityId: "lead-1",
  features: { daysInStage: 0 },
  computedAt: new Date(),
});
const mockRecordConsumerMessage = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
  enqueue: vi.fn(),
  startRelay: vi.fn(),
}));

vi.mock("../src/modules/feature-store/domain.js", () => ({
  computeAndCache: (...args: unknown[]) => mockComputeAndCache(...args),
}));

vi.mock("../src/modules/observability/metrics.js", () => ({
  recordConsumerMessage: (...args: unknown[]) => mockRecordConsumerMessage(...args),
}));

import { registerFeatureStoreConsumers } from "../src/modules/feature-store/consumer.js";

describe("T2-01 feature-store consumer registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
  });

  it("worker.ts registers registerFeatureStoreConsumers(queue)", () => {
    const workerSrc = readFileSync(
      resolve(__dirname, "../src/worker.ts"),
      "utf8",
    );
    expect(workerSrc).toMatch(/import\s+\{\s*registerFeatureStoreConsumers\s*\}/);
    expect(workerSrc).toContain("registerFeatureStoreConsumers(queue)");
  });

  it("subscribes to crm.lead.* and inventory.receipt.* topics", () => {
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;

    registerFeatureStoreConsumers(mockQueue);

    const topics = mockSubscribe.mock.calls.map((c) => c[0] as string);
    expect(topics).toContain("crm.lead.created");
    expect(topics).toContain("crm.lead.updated");
    expect(topics).toContain("inventory.receipt.posted");
    expect(topics).toContain("inventory.issue.posted");
    expect(topics).toContain("helpdesk.ticket.created");
    expect(topics).toContain("helpdesk.ticket.updated");
    expect(topics).toContain("billing.subscription.updated");
    expect(topics).toContain("project.task.updated");
    expect(topics).toContain("finance.transaction.posted");
  });

  it("crm.lead.created event recomputes lead feature vector", async () => {
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;
    registerFeatureStoreConsumers(mockQueue);

    const leadCreated = mockSubscribe.mock.calls.find((c) => c[0] === "crm.lead.created");
    expect(leadCreated).toBeDefined();
    const handler = leadCreated![1] as (msg: unknown) => Promise<void>;

    await handler({
      messageId: "msg-lead-created-1",
      type: "crm.lead.created",
      tenantId: "tenant-aaa",
      payload: { tenantId: "tenant-aaa", leadId: "lead-xyz", source: "web" },
    });

    expect(mockMarkProcessed).toHaveBeenCalledWith({}, "msg-lead-created-1");
    expect(mockComputeAndCache).toHaveBeenCalledWith("tenant-aaa", "leads", "lead-xyz");
  });

  it("inventory.receipt.posted event recomputes inventory feature vector", async () => {
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;
    registerFeatureStoreConsumers(mockQueue);

    const receipt = mockSubscribe.mock.calls.find((c) => c[0] === "inventory.receipt.posted");
    expect(receipt).toBeDefined();
    const handler = receipt![1] as (msg: unknown) => Promise<void>;

    await handler({
      messageId: "msg-receipt-1",
      type: "inventory.receipt.posted",
      tenantId: "tenant-bbb",
      payload: {
        tenantId: "tenant-bbb",
        receiptId: "rcpt-1",
        itemId: "item-42",
        warehouseId: "wh-1",
        qty: 10,
      },
    });

    expect(mockMarkProcessed).toHaveBeenCalledWith({}, "msg-receipt-1");
    expect(mockComputeAndCache).toHaveBeenCalledWith("tenant-bbb", "inventory", "item-42");
  });

  it("skips recomputation when message already processed", async () => {
    mockMarkProcessed.mockResolvedValueOnce(false);
    const mockSubscribe = vi.fn();
    const mockQueue = { subscribe: mockSubscribe } as unknown as Queue;
    registerFeatureStoreConsumers(mockQueue);

    const leadCreated = mockSubscribe.mock.calls.find((c) => c[0] === "crm.lead.created");
    const handler = leadCreated![1] as (msg: unknown) => Promise<void>;

    await handler({
      messageId: "msg-dup",
      type: "crm.lead.created",
      tenantId: "tenant-aaa",
      payload: { tenantId: "tenant-aaa", leadId: "lead-xyz" },
    });

    expect(mockComputeAndCache).not.toHaveBeenCalled();
  });
});
