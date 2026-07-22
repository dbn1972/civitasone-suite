/**
 * Tests for modules/turnstile-control/consumer.ts
 *
 * Covers all handlers: passageRecord, emergencyUnlock, emergencyRestore,
 * offlineSync, evacuationDeclared (consumed event).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const publishMock = vi.fn(async () => undefined);
const enqueueCommandMock = vi.fn(async () => undefined);

let passageRows: Record<string, unknown>[] = [];
let deviceRows: Record<string, unknown>[] = [];

function makeSelectChain(rows: Record<string, unknown>[]) {
  const whereResult = Object.assign(
    Promise.resolve(rows),
    { limit: async () => rows },
  );
  return {
    from: () => ({
      where: () => whereResult,
    }),
  };
}

function makeSelectAllChain(rows: Record<string, unknown>[]) {
  const whereResult = Object.assign(
    Promise.resolve(rows),
    { limit: async () => rows },
  );
  return {
    from: () => ({
      where: () => whereResult,
    }),
  };
}

const fakeTx = {
  select: vi.fn(() => makeSelectChain(passageRows)),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publishMock(...args) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...args: unknown[]) => args.join(":") },
}));

vi.mock("../src/modules/turnstile-control/command-queue.js", () => ({
  enqueueCommand: (...args: unknown[]) => enqueueCommandMock(...args),
}));

vi.mock("../src/modules/turnstile-control/domain.js", () => ({
  resolveOfflineConflict: (eventTimestamp: Date, passRevokedAt: Date | null) => {
    if (passRevokedAt && eventTimestamp > passRevokedAt) return "retroactively_invalid";
    return "valid";
  },
  isSyncWindowValid: (eventTimestamp: Date, now: Date) => {
    const ageMs = now.getTime() - eventTimestamp.getTime();
    return ageMs <= 24 * 60 * 60 * 1000;
  },
  isTailgating: (passageCount: number, tolerance: number) => passageCount > tolerance,
  isPassageAllowed: (ctx: { passId: string; requestedDirection: string; lastKnownDirection: string | null }, enabled: boolean) => {
    if (!enabled) return true;
    if (!ctx.lastKnownDirection) return true;
    return ctx.requestedDirection !== ctx.lastKnownDirection;
  },
  EMERGENCY_COMMAND_TYPE: "emergency_open",
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyNumber: async () => 1,
  getPolicyBoolean: async () => true,
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn(() => null),
}));

const { registerTurnstileControlConsumers } = await import("../src/modules/turnstile-control/consumer.js");
const { COMMANDS, CONSUMED_EVENTS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const GATE_ID = "44444444-4444-4444-4444-444444444444";
const LOCATION_ID = "55555555-5555-5555-5555-555555555555";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerTurnstileControlConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload,
  });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  publishMock.mockReset().mockResolvedValue(undefined);
  enqueueCommandMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  passageRows = [];
  deviceRows = [{ id: DEVICE_ID }];
});

describe("passageRecord", () => {
  const passagePayload = {
    id: "passage-1",
    tenantId: TENANT,
    passId: PASS_ID,
    gateId: GATE_ID,
    direction: "in" as const,
    passageCount: 1,
    eventTimestamp: "2025-06-15T10:00:00Z",
    offlineRecorded: false,
  };

  it("records a passage and emits passageConfirmed + checkIn command", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passageRecord, passagePayload);

    expect(markProcessedMock).toHaveBeenCalled();
    expect(fakeTx.insert).toHaveBeenCalled(); // passage event insert
    // enqueue includes passageConfirmed + checkInRecord (direction=in)
    expect(enqueueMock).toHaveBeenCalled();
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.passage.confirmed");
    expect(topics).toContain("visitor.check_in.record");
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passageRecord, passagePayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("does not emit checkIn command for outbound direction", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passageRecord, { ...passagePayload, direction: "out" });

    // Should NOT include checkInRecord for 'out'
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.passage.confirmed");
    expect(topics).not.toContain("visitor.check_in.record");
  });

  it("detects tailgating when passage count exceeds tolerance", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passageRecord, { ...passagePayload, passageCount: 3 });

    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.tailgating.detected");
  });

  it("does not flag tailgating within tolerance", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passageRecord, { ...passagePayload, passageCount: 1 });

    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).not.toContain("visitor.tailgating.detected");
  });
});

describe("emergencyUnlock", () => {
  const unlockPayload = {
    id: "emergency-1",
    tenantId: TENANT,
    locationId: LOCATION_ID,
    reason: "Fire alarm",
  };

  it("triggers emergency unlock and enqueues commands to devices", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.emergencyUnlock, unlockPayload);

    // markProcessed is called (could be multiple db.transaction calls)
    expect(markProcessedMock).toHaveBeenCalled();
    // Should emit emergencyUnlockTriggered event
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.emergency.unlock.triggered");
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.emergencyUnlock, unlockPayload);

    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).not.toContain("visitor.emergency.unlock.triggered");
  });
});

describe("emergencyRestore", () => {
  const restorePayload = {
    id: "restore-1",
    tenantId: TENANT,
    locationId: LOCATION_ID,
  };

  it("restores normal operation and emits event", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.emergencyRestore, restorePayload);

    expect(markProcessedMock).toHaveBeenCalled();
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.emergency.restored");
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.emergencyRestore, restorePayload);

    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).not.toContain("visitor.emergency.restored");
  });
});

describe("offlineSync", () => {
  const syncPayload = {
    id: "sync-1",
    tenantId: TENANT,
    deviceId: DEVICE_ID,
    events: [
      {
        passId: PASS_ID,
        gateId: GATE_ID,
        direction: "in" as const,
        passageCount: 1,
        eventTimestamp: new Date(Date.now() - 60_000).toISOString(), // 1 min ago (valid)
        offlineRecorded: true,
      },
      {
        passId: "pass-2",
        gateId: GATE_ID,
        direction: "out" as const,
        passageCount: 1,
        eventTimestamp: new Date(Date.now() - 120_000).toISOString(), // 2 min ago (valid)
        offlineRecorded: true,
      },
    ],
  };

  it("syncs offline events and emits deviceSyncCompleted", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.offlineSync, syncPayload);

    expect(markProcessedMock).toHaveBeenCalled();
    // Should insert passage events and emit deviceSyncCompleted
    expect(fakeTx.insert).toHaveBeenCalled();
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.device.sync.completed");
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.offlineSync, syncPayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).not.toContain("visitor.device.sync.completed");
  });

  it("rejects events older than 24 hours", async () => {
    const oldPayload = {
      ...syncPayload,
      events: [
        {
          passId: PASS_ID,
          gateId: GATE_ID,
          direction: "in" as const,
          passageCount: 1,
          eventTimestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
          offlineRecorded: true,
        },
      ],
    };

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.offlineSync, oldPayload);

    // Should emit deviceSyncCompleted (with rejected count)
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.device.sync.completed");
  });

  it("skips duplicate events (idempotency)", async () => {
    // When select returns existing rows, the event is skipped
    fakeTx.select.mockImplementation(() => makeSelectChain([{ id: "existing" }]));

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.offlineSync, syncPayload);

    // Still emits sync completed
    const topics = enqueueMock.mock.calls.map(c => (c[1] as Record<string, unknown>).topic);
    expect(topics).toContain("visitor.device.sync.completed");
  });
});

describe("evacuationDeclared (consumed event)", () => {
  const evacuationPayload = {
    locationId: LOCATION_ID,
    evacuationId: "evac-1",
    reason: "earthquake",
  };

  it("triggers emergencyUnlock command when evacuation declared", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, CONSUMED_EVENTS.evacuationDeclared, evacuationPayload);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(
      COMMANDS.emergencyUnlock,
      expect.objectContaining({
        type: COMMANDS.emergencyUnlock,
        payload: expect.objectContaining({
          locationId: LOCATION_ID,
        }),
      }),
    );
  });

  it("uses provided reason in emergency unlock command", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, CONSUMED_EVENTS.evacuationDeclared, evacuationPayload);

    expect(publishMock).toHaveBeenCalledWith(
      COMMANDS.emergencyUnlock,
      expect.objectContaining({
        payload: expect.objectContaining({ reason: "earthquake" }),
      }),
    );
  });

  it("defaults reason to evacuation_declared when none provided", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, CONSUMED_EVENTS.evacuationDeclared, {
      locationId: LOCATION_ID,
      evacuationId: "evac-2",
    });

    expect(publishMock).toHaveBeenCalledWith(
      COMMANDS.emergencyUnlock,
      expect.objectContaining({
        payload: expect.objectContaining({ reason: "evacuation_declared" }),
      }),
    );
  });
});
