/**
 * Feature: visitor-management, Task 16.1 — modules/check-in/consumer.ts
 * evacuation-roster wiring.
 *
 * Unit tests (mocked DB/outbox/roster) covering:
 *   - checkInRecord adds the checked-in visitor to the evacuation roster
 *   - checkOutRecord removes the visitor from the evacuation roster
 *   - a roster failure (e.g. Redis down) is swallowed with a WARN log and
 *     does NOT fail/retry an already-committed check-in/check-out (graceful
 *     degradation per steering "Error Handling & Resilience")
 *   - idempotent replay (markProcessed returns false) never touches the
 *     roster a second time
 *
 * Requirements: 17.1, 17.2
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const addToRosterMock = vi.fn(async () => undefined);
const removeFromRosterMock = vi.fn(async () => undefined);

// In-memory fake tables so the consumer's select/update/insert chains work
// without a real Postgres connection.
let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;

function makeChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

const fakeTx = {
  select: vi.fn((...args: unknown[]) => {
    // Determine which table is being selected by peeking at call order:
    // consumer.ts selects digitalPasses first, then visitRequests.
    void args;
    if (!fakeTx.__selectCallCount) fakeTx.__selectCallCount = 0;
    fakeTx.__selectCallCount++;
    if (fakeTx.__selectCallCount % 2 === 1) {
      return makeChain(passRow ? [passRow] : []);
    }
    return makeChain(visitRow ? [visitRow] : []);
  }) as unknown as (() => ReturnType<typeof makeChain>) & { __selectCallCount?: number },
  insert: vi.fn(() => ({ values: async () => undefined })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: (...args: unknown[]) => addToRosterMock(...args),
  removeFromRoster: (...args: unknown[]) => removeFromRosterMock(...args),
}));

// Auto-print badge toggle read (Fix 2): mock the policy getter so it never
// touches the fake tx (which would perturb the select-call-order simulation
// this suite relies on). Default OFF here — auto-print behavior has its own
// dedicated suite (check-in-vip-badge.test.ts).
vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: async () => false,
}));

const { registerCheckInConsumers } = await import("../src/modules/check-in/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GATE_ID = "55555555-5555-5555-5555-555555555555";
const VISIT_REQUEST_ID = "66666666-6666-6666-6666-666666666666";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerCheckInConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload,
  });
  // MemoryQueue delivers via setTimeout(0); flush the microtask/macrotask queue.
  await new Promise((r) => setTimeout(r, 10));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  addToRosterMock.mockReset().mockResolvedValue(undefined);
  removeFromRosterMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  (fakeTx as unknown as { __selectCallCount?: number }).__selectCallCount = 0;

  passRow = {
    id: PASS_ID,
    tenantId: TENANT,
    visitRequestId: VISIT_REQUEST_ID,
    locationId: LOCATION_ID,
    status: "active",
    passType: "single",
  };
  visitRow = {
    id: VISIT_REQUEST_ID,
    tenantId: TENANT,
    visitorName: "Jane Visitor",
    visitorPhone: "9999999999",
  };
});

describe("checkInRecord -> evacuation roster", () => {
  it("adds the visitor to the roster after the check-in commits", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, {
      passId: PASS_ID,
      gateId: GATE_ID,
    });

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(addToRosterMock).toHaveBeenCalledTimes(1);
    expect(addToRosterMock).toHaveBeenCalledWith(
      TENANT,
      LOCATION_ID,
      expect.objectContaining({
        passId: PASS_ID,
        visitorName: "Jane Visitor",
        contactNumber: "9999999999",
        lastKnownGate: GATE_ID,
        evacuated: false,
      }),
    );
  });

  it("does not touch the roster on an idempotent replay (markProcessed returns false)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(addToRosterMock).not.toHaveBeenCalled();
  });

  it("swallows a roster failure (Redis down) without throwing — check-in already committed", async () => {
    addToRosterMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const queue = freshQueue();

    await expect(publishAndFlush(queue, COMMANDS.checkInRecord, { passId: PASS_ID, gateId: GATE_ID })).resolves.not.toThrow();

    // The DB-side effects (markProcessed) still happened even though the
    // roster mirror failed — the check-in itself is not rolled back/retried.
    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(queue.dlq).toHaveLength(0);
  });
});

describe("checkOutRecord -> evacuation roster", () => {
  it("removes the visitor from the roster after the check-out commits", async () => {
    passRow = { ...passRow, status: "checked_in" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.checkOutRecord, { passId: PASS_ID, gateId: GATE_ID });

    expect(removeFromRosterMock).toHaveBeenCalledTimes(1);
    expect(removeFromRosterMock).toHaveBeenCalledWith(TENANT, LOCATION_ID, PASS_ID);
  });

  it("swallows a roster failure (Redis down) without throwing — check-out already committed", async () => {
    passRow = { ...passRow, status: "checked_in" };
    removeFromRosterMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const queue = freshQueue();

    await expect(
      publishAndFlush(queue, COMMANDS.checkOutRecord, { passId: PASS_ID, gateId: GATE_ID }),
    ).resolves.not.toThrow();

    expect(queue.dlq).toHaveLength(0);
  });
});
