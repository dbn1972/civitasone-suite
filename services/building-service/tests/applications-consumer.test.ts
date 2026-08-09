/**
 * building-service — applications consumer unit tests (mocked db/repo/outbox).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};
const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const insertApplicationMock = vi.fn(async () => undefined);
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

vi.mock("../src/modules/applications/repo.js", () => ({
  insertApplication: (...args: unknown[]) => insertApplicationMock(...args),
  updateStatus: (...args: unknown[]) => updateStatusMock(...args),
  updateFeePayment: vi.fn(async () => true),
}));

const TENANT = "b1000001-1111-4000-8000-000000000001";
const ACTOR = "b1000002-1111-4000-8000-000000000002";

const baseMsg = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-building-app",
  schemaVersion: "1.0",
};

function captureHandlers(registerFn: (q: { subscribe: (topic: string, handler: Function) => void }) => void) {
  const handlers: Record<string, Function> = {};
  registerFn({ subscribe: (topic, handler) => { handlers[topic] = handler; } });
  return handlers;
}

describe("building applications consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    updateStatusMock.mockResolvedValue(true);
  });

  it("createApplication — inserts row and enqueues created + audit events", async () => {
    const { registerApplicationConsumers } = await import("../src/modules/applications/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerApplicationConsumers);

    await handlers[COMMANDS.createApplication]({
      ...baseMsg,
      messageId: "msg-building-create-1",
      type: COMMANDS.createApplication,
      payload: {
        id: "bld-app-1",
        tenantId: TENANT,
        siteAddress: { line1: "Plot 5" },
        plotArea: 500,
        builtUpArea: 400,
      },
    });

    expect(insertApplicationMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ topic: EVENTS.applicationCreated }),
    );
  });

  it("submitApplication — skips event when updateStatus fails", async () => {
    updateStatusMock.mockResolvedValue(false);
    const { registerApplicationConsumers } = await import("../src/modules/applications/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerApplicationConsumers);

    await handlers[COMMANDS.submitApplication]({
      ...baseMsg,
      messageId: "msg-building-submit-1",
      type: COMMANDS.submitApplication,
      payload: { id: "bld-missing", tenantId: TENANT },
    });

    expect(updateStatusMock).toHaveBeenCalledWith(mockTx, "bld-missing", TENANT, "submitted", ACTOR);
    const submitted = enqueueMock.mock.calls.filter(
      (c) => (c[1] as { topic?: string })?.topic === EVENTS.applicationSubmitted,
    );
    expect(submitted).toHaveLength(0);
  });

  it("createApplication — duplicate messageId is a no-op", async () => {
    markProcessedMock.mockResolvedValue(false);
    const { registerApplicationConsumers } = await import("../src/modules/applications/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerApplicationConsumers);

    await handlers[COMMANDS.createApplication]({
      ...baseMsg,
      messageId: "msg-building-dup",
      type: COMMANDS.createApplication,
      payload: { id: "bld-dup", tenantId: TENANT, siteAddress: {} },
    });

    expect(insertApplicationMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
