/**
 * vendor-service — registrations consumer unit tests (mocked db/repo/outbox).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};
const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const insertRegistrationMock = vi.fn(async () => undefined);
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

vi.mock("../src/modules/registrations/repo.js", () => ({
  insertRegistration: (...args: unknown[]) => insertRegistrationMock(...args),
  updateStatus: (...args: unknown[]) => updateStatusMock(...args),
}));

const TENANT = "v1000001-1111-4000-8000-000000000001";
const ACTOR = "v1000002-1111-4000-8000-000000000002";

const baseMsg = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-vendor-reg",
  schemaVersion: "1.0",
};

function captureHandlers(registerFn: (q: { subscribe: (topic: string, handler: Function) => void }) => void) {
  const handlers: Record<string, Function> = {};
  registerFn({ subscribe: (topic, handler) => { handlers[topic] = handler; } });
  return handlers;
}

describe("vendor registrations consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    updateStatusMock.mockResolvedValue(true);
  });

  it("createRegistration — inserts row and enqueues created + audit events", async () => {
    const { registerRegistrationConsumers } = await import("../src/modules/registrations/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerRegistrationConsumers);

    await handlers[COMMANDS.createRegistration]({
      ...baseMsg,
      messageId: "msg-vendor-create-1",
      type: COMMANDS.createRegistration,
      payload: {
        id: "reg-1",
        tenantId: TENANT,
        vendorName: "Street Vendor",
        vendorAadhaar: "123456789012",
        vendorPhone: "9876543210",
        category: "food",
      },
    });

    expect(insertRegistrationMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ topic: EVENTS.registrationCreated }),
    );
  });

  it("submitRegistration — skips event when updateStatus fails", async () => {
    updateStatusMock.mockResolvedValue(false);
    const { registerRegistrationConsumers } = await import("../src/modules/registrations/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerRegistrationConsumers);

    await handlers[COMMANDS.submitRegistration]({
      ...baseMsg,
      messageId: "msg-vendor-submit-1",
      type: COMMANDS.submitRegistration,
      payload: { id: "reg-missing", tenantId: TENANT },
    });

    expect(updateStatusMock).toHaveBeenCalledWith(mockTx, "reg-missing", TENANT, "submitted", ACTOR);
    const submitted = enqueueMock.mock.calls.filter(
      (c) => (c[1] as { topic?: string })?.topic === EVENTS.registrationSubmitted,
    );
    expect(submitted).toHaveLength(0);
  });

  it("createRegistration — duplicate messageId is a no-op", async () => {
    markProcessedMock.mockResolvedValue(false);
    const { registerRegistrationConsumers } = await import("../src/modules/registrations/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerRegistrationConsumers);

    await handlers[COMMANDS.createRegistration]({
      ...baseMsg,
      messageId: "msg-vendor-dup",
      type: COMMANDS.createRegistration,
      payload: {
        id: "reg-dup",
        tenantId: TENANT,
        vendorName: "Dup",
        vendorAadhaar: "999999999999",
        vendorPhone: "9000000000",
        category: "general",
      },
    });

    expect(insertRegistrationMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
