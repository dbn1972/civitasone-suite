/**
 * Dashboards consumer — tests the full write-path via in-memory queue.
 * Mocks db.transaction to avoid the tenant GUC dependency.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const mockTx = {
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue([]),
      onConflictDoUpdate: vi.fn().mockResolvedValue([]),
      returning: vi.fn().mockResolvedValue([{ id: "mock" }]),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "mock" }]),
      }),
    }),
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  }),
  delete: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "mock" }]),
    }),
  }),
};

const markProcessedMock = vi.fn().mockResolvedValue(true);
const enqueueMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: any) => fn(mockTx)) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async (fn: any) => fn(mockTx)),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => markProcessedMock(...args),
  enqueue: (...args: any[]) => enqueueMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidateResource: vi.fn().mockResolvedValue(undefined),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

// Import after mocks are set up
const { MemoryQueue } = await import("@civitasone/queue");
const { COMMANDS } = await import("../src/topics.js");
const { registerDashboardsConsumers } = await import("../src/modules/dashboards/consumer.js");

const TENANT = randomUUID();
const ACTOR = randomUUID();

let queue: InstanceType<typeof MemoryQueue>;

beforeAll(async () => {
  queue = new MemoryQueue();
  registerDashboardsConsumers(queue);
  await queue.start();
});

beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  // restore the default chainable delete() stub — some tests override its
  // resolved value to simulate "already gone".
  mockTx.delete.mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "mock" }]),
    }),
  });
});

describe("DashboardsConsumer — createDashboard", () => {
  it("processes createDashboard command and calls markProcessed + enqueue", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.createDashboard, {
      messageId: id,
      type: COMMANDS.createDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id,
        name: "Test Dashboard",
        description: "A test",
        status: "active",
        ownerId: ACTOR,
        visibility: "private",
        layout: {},
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
    // Should emit domain event + audit event (2 enqueue calls)
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("skips processing when markProcessed returns false (duplicate)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const id = randomUUID();
    await queue.publish(COMMANDS.createDashboard, {
      messageId: id,
      type: COMMANDS.createDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id, name: "Dup", description: null, status: "active", ownerId: ACTOR, visibility: "private", layout: {} },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("DashboardsConsumer — updateDashboard", () => {
  it("processes updateDashboard command", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.updateDashboard, {
      messageId: randomUUID(),
      type: COMMANDS.updateDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { dashboardId: id, expectedVersion: 1, patch: { name: "Updated" } },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
  });
});

describe("DashboardsConsumer — addWidget", () => {
  it("processes addWidget command", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.addWidget, {
      messageId: randomUUID(),
      type: COMMANDS.addWidget,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { widgetId: id, dashboardId: randomUUID(), title: "Chart", vizType: "bar", spec: {}, position: 0 },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
  });
});

describe("DashboardsConsumer — shareDashboard", () => {
  it("processes shareDashboard command", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.shareDashboard, {
      messageId: randomUUID(),
      type: COMMANDS.shareDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { shareId: id, dashboardId: randomUUID(), principalId: randomUUID(), access: "view" },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
  });
});

describe("DashboardsConsumer — deleteDashboard", () => {
  it("was previously unhandled: COMMANDS.deleteDashboard now has a registered consumer that actually deletes the row", async () => {
    const dashboardId = randomUUID();
    await queue.publish(COMMANDS.deleteDashboard, {
      messageId: randomUUID(),
      type: COMMANDS.deleteDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { dashboardId },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
    expect(mockTx.delete).toHaveBeenCalled();
    // Emits dashboardDeleted domain event + audit event (2 enqueue calls) —
    // mirrors createDashboard's assertion above.
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("records a failure audit (not a thrown error) when the dashboard no longer exists", async () => {
    mockTx.delete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]), // nothing matched id+tenant
      }),
    });
    const dashboardId = randomUUID();
    await queue.publish(COMMANDS.deleteDashboard, {
      messageId: randomUUID(),
      type: COMMANDS.deleteDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { dashboardId },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(markProcessedMock).toHaveBeenCalled();
    // Only the failure-audit enqueue — no dashboardDeleted domain event.
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("skips processing when markProcessed returns false (duplicate delivery)", async () => {
    markProcessedMock.mockResolvedValue(false);
    await queue.publish(COMMANDS.deleteDashboard, {
      messageId: randomUUID(),
      type: COMMANDS.deleteDashboard,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { dashboardId: randomUUID() },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockTx.delete).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
