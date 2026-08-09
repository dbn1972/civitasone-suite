/**
 * fire-service — applications consumer unit tests (mocked db/repo/outbox).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};
const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const insertMock = vi.fn(async () => undefined);
const updateStatusMock = vi.fn(async () => ({ id: "fire-app-1" }));

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
  insert: (...args: unknown[]) => insertMock(...args),
  updateStatus: (...args: unknown[]) => updateStatusMock(...args),
}));

const TENANT = "f1000001-1111-4000-8000-000000000001";
const ACTOR = "f1000002-1111-4000-8000-000000000002";

const baseMsg = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-fire-app",
  schemaVersion: "1.0",
};

function captureHandlers(registerFn: (q: { subscribe: (topic: string, handler: Function) => void }) => void) {
  const handlers: Record<string, Function> = {};
  registerFn({ subscribe: (topic, handler) => { handlers[topic] = handler; } });
  return handlers;
}

describe("fire applications consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    updateStatusMock.mockResolvedValue({ id: "fire-app-1" });
  });

  it("createApplication — inserts row and enqueues created + audit events", async () => {
    const { registerApplicationConsumers } = await import("../src/modules/applications/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerApplicationConsumers);

    await handlers[COMMANDS.createApplication]({
      ...baseMsg,
      messageId: "msg-fire-create-1",
      type: COMMANDS.createApplication,
      payload: {
        id: "fire-app-1",
        buildingName: "Tower A",
        buildingAddress: { line1: "Sector 12" },
        occupancyType: "commercial",
      },
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ topic: EVENTS.applicationCreated }),
    );
  });

  it("submitApplication — skips event when updateStatus returns null (wrong tenant)", async () => {
    updateStatusMock.mockResolvedValue(null);
    const { registerApplicationConsumers } = await import("../src/modules/applications/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerApplicationConsumers);

    await handlers[COMMANDS.submitApplication]({
      ...baseMsg,
      messageId: "msg-fire-submit-1",
      type: COMMANDS.submitApplication,
      payload: { applicationId: "fire-missing" },
    });

    expect(updateStatusMock).toHaveBeenCalledWith(mockTx, TENANT, "fire-missing", "submitted", ACTOR);
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
      messageId: "msg-fire-dup",
      type: COMMANDS.createApplication,
      payload: {
        id: "fire-dup",
        buildingName: "Dup",
        buildingAddress: {},
        occupancyType: "residential",
      },
    });

    expect(insertMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
