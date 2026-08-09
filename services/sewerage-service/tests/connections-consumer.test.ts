/**
 * sewerage-service — connections consumer unit tests (mocked db/repo/outbox).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};
const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const insertAppMock = vi.fn(async () => undefined);
const updateAppMock = vi.fn(async () => true);

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/modules/connections/repo.js", () => ({
  insertApp: (...args: unknown[]) => insertAppMock(...args),
  updateApp: (...args: unknown[]) => updateAppMock(...args),
  insertConnection: vi.fn(async () => undefined),
}));

const TENANT = "s1000001-1111-4000-8000-000000000001";
const ACTOR = "s1000002-1111-4000-8000-000000000002";

const baseMsg = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-sewerage-conn",
  schemaVersion: "1.0",
};

function captureHandlers(registerFn: (q: { subscribe: (topic: string, handler: Function) => void }) => void) {
  const handlers: Record<string, Function> = {};
  registerFn({ subscribe: (topic, handler) => { handlers[topic] = handler; } });
  return handlers;
}

describe("sewerage connections consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    updateAppMock.mockResolvedValue(true);
  });

  it("connectionApply — inserts application and enqueues applied + audit events", async () => {
    const { registerConnectionConsumers } = await import("../src/modules/connections/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerConnectionConsumers);

    await handlers[COMMANDS.connectionApply]({
      ...baseMsg,
      messageId: "msg-sew-apply-1",
      type: COMMANDS.connectionApply,
      payload: {
        id: "sew-app-1",
        applicationNumber: "SEW/2026/0001",
        propertyRef: "prop-1",
        connectionClass: "domestic",
        siteDetails: { ward: "W2" },
      },
    });

    expect(insertAppMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ topic: EVENTS.connectionApplied }),
    );
  });

  it("connectionUpdateStatus — skips event when updateApp fails (version/tenant mismatch)", async () => {
    updateAppMock.mockResolvedValue(false);
    const { registerConnectionConsumers } = await import("../src/modules/connections/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerConnectionConsumers);

    await handlers[COMMANDS.connectionUpdateStatus]({
      ...baseMsg,
      messageId: "msg-sew-status-1",
      type: COMMANDS.connectionUpdateStatus,
      payload: { id: "sew-app-missing", status: "approved", version: 99 },
    });

    expect(updateAppMock).toHaveBeenCalledWith(
      mockTx,
      "sew-app-missing",
      TENANT,
      expect.objectContaining({ status: "approved" }),
      99,
    );
    const statusEvents = enqueueMock.mock.calls.filter(
      (c) => (c[1] as { topic?: string })?.topic === EVENTS.connectionStatusUpdated,
    );
    expect(statusEvents).toHaveLength(0);
  });

  it("connectionApply — duplicate messageId is a no-op", async () => {
    markProcessedMock.mockResolvedValue(false);
    const { registerConnectionConsumers } = await import("../src/modules/connections/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerConnectionConsumers);

    await handlers[COMMANDS.connectionApply]({
      ...baseMsg,
      messageId: "msg-sew-dup",
      type: COMMANDS.connectionApply,
      payload: {
        id: "sew-dup",
        applicationNumber: "SEW/2026/0002",
        propertyRef: "prop-2",
        connectionClass: "domestic",
        siteDetails: {},
      },
    });

    expect(insertAppMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
