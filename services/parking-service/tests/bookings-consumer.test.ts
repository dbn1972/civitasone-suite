/**
 * parking-service — bookings consumer unit tests (mocked db/repo/outbox).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {};
const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const insertBookingMock = vi.fn(async () => undefined);
const updateStatusMock = vi.fn(async () => true);
const findByIdMock = vi.fn(async () => null);

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/modules/bookings/repo.js", () => ({
  insertBooking: (...args: unknown[]) => insertBookingMock(...args),
  updateStatus: (...args: unknown[]) => updateStatusMock(...args),
  findById: (...args: unknown[]) => findByIdMock(...args),
}));

const TENANT = "p1000001-1111-4000-8000-000000000001";
const ACTOR = "p1000002-1111-4000-8000-000000000002";

const baseMsg = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-parking-booking",
  schemaVersion: "1.0",
};

function captureHandlers(registerFn: (q: { subscribe: (topic: string, handler: Function) => void }) => void) {
  const handlers: Record<string, Function> = {};
  registerFn({ subscribe: (topic, handler) => { handlers[topic] = handler; } });
  return handlers;
}

describe("parking bookings consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    updateStatusMock.mockResolvedValue(true);
    findByIdMock.mockResolvedValue(null);
  });

  it("createBooking — inserts booking and enqueues created + audit events", async () => {
    const { registerBookingConsumers } = await import("../src/modules/bookings/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerBookingConsumers);

    await handlers[COMMANDS.createBooking]({
      ...baseMsg,
      messageId: "msg-park-create-1",
      type: COMMANDS.createBooking,
      payload: {
        id: "book-1",
        tenantId: TENANT,
        facilityId: "fac-1",
        vehicleNumber: "KA01AB1234",
        vehicleType: "car",
      },
    });

    expect(insertBookingMock).toHaveBeenCalledOnce();
    expect(enqueueMock).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ topic: EVENTS.bookingCreated }),
    );
  });

  it("recordEntry — skips event when updateStatus fails (wrong tenant / missing booking)", async () => {
    updateStatusMock.mockResolvedValue(false);
    const { registerBookingConsumers } = await import("../src/modules/bookings/consumer.js");
    const { COMMANDS, EVENTS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerBookingConsumers);

    await handlers[COMMANDS.recordEntry]({
      ...baseMsg,
      messageId: "msg-park-entry-1",
      type: COMMANDS.recordEntry,
      payload: { id: "book-missing", tenantId: TENANT, spaceNumber: "A-12" },
    });

    expect(updateStatusMock).toHaveBeenCalled();
    const entryEvents = enqueueMock.mock.calls.filter(
      (c) => (c[1] as { topic?: string })?.topic === EVENTS.entryRecorded,
    );
    expect(entryEvents).toHaveLength(0);
  });

  it("createBooking — duplicate messageId is a no-op", async () => {
    markProcessedMock.mockResolvedValue(false);
    const { registerBookingConsumers } = await import("../src/modules/bookings/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");
    const handlers = captureHandlers(registerBookingConsumers);

    await handlers[COMMANDS.createBooking]({
      ...baseMsg,
      messageId: "msg-park-dup",
      type: COMMANDS.createBooking,
      payload: {
        id: "book-dup",
        tenantId: TENANT,
        facilityId: "fac-1",
        vehicleNumber: "KA01CD5678",
        vehicleType: "bike",
      },
    });

    expect(insertBookingMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
