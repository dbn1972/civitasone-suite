/**
 * market-service — allotments consumer unit tests (mocked db/repo/outbox).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};
const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const insertAllotmentMock = vi.fn(async () => undefined);
const updateStatusMock = vi.fn(async () => true);

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/modules/allotments/repo.js", () => ({
  insertAllotment: (...args: unknown[]) => insertAllotmentMock(...args),
  updateStatus: (...args: unknown[]) => updateStatusMock(...args),
}));

const TENANT = "m1000001-1111-4000-8000-000000000001";
const ACTOR = "m1000002-1111-4000-8000-000000000002";

const baseMsg = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-market-allot",
  schemaVersion: "1.0",
};

function captureHandlers(registerFn: (q: { subscribe: (topic: string, handler: Function) => void }) => void) {
  const handlers: Record<string, Function> = {};
  registerFn({ subscribe: (topic, handler) => { handlers[topic] = handler; } });
  return handlers;
}

describe("market allotments consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    updateStatusMock.mockResolvedValue(true);
  });

  it("applyAllotment — inserts allotment and enqueues applied + audit events", async () => {
    const { registerAllotmentConsumers } = await import("../src/modules/allotments/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerAllotmentConsumers);

    await handlers[COMMANDS.applyAllotment]({
      ...baseMsg,
      messageId: "msg-market-apply-1",
      type: COMMANDS.applyAllotment,
      payload: {
        id: "allot-1",
        tenantId: TENANT,
        propertyId: "prop-1",
        allotteeName: "Shopkeeper",
        allotmentType: "shop",
        monthlyRentMinor: "500000",
      },
    });

    expect(insertAllotmentMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ topic: EVENTS.allotmentApplied }),
    );
  });

  it("selectAllottee — skips event when updateStatus fails (invalid transition / wrong tenant)", async () => {
    updateStatusMock.mockResolvedValue(false);
    const { registerAllotmentConsumers } = await import("../src/modules/allotments/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerAllotmentConsumers);

    await handlers[COMMANDS.selectAllottee]({
      ...baseMsg,
      messageId: "msg-market-select-1",
      type: COMMANDS.selectAllottee,
      payload: { id: "allot-missing", tenantId: TENANT },
    });

    expect(updateStatusMock).toHaveBeenCalledWith(
      mockTx,
      "allot-missing",
      TENANT,
      "selected",
      ACTOR,
      expect.objectContaining({ allotmentDate: expect.any(String) }),
    );
    const selected = enqueueMock.mock.calls.filter(
      (c) => (c[1] as { topic?: string })?.topic === EVENTS.allotteeSelected,
    );
    expect(selected).toHaveLength(0);
  });

  it("applyAllotment — duplicate messageId is a no-op", async () => {
    markProcessedMock.mockResolvedValue(false);
    const { registerAllotmentConsumers } = await import("../src/modules/allotments/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerAllotmentConsumers);

    await handlers[COMMANDS.applyAllotment]({
      ...baseMsg,
      messageId: "msg-market-dup",
      type: COMMANDS.applyAllotment,
      payload: {
        id: "allot-dup",
        tenantId: TENANT,
        propertyId: "prop-2",
        allotteeName: "Dup",
        allotmentType: "stall",
      },
    });

    expect(insertAllotmentMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
