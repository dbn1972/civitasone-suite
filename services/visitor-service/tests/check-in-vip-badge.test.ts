/**
 * Fix 1 (VIP-arrival alert) + Fix 2 (check-in → badge auto-handoff) — unit tests
 * for modules/check-in/consumer.ts.
 *
 * Covers:
 *   - a VIP check-in enqueues the three VIP-arrival NOTIFICATION_SEND messages
 *     (host + protocol officer + reception), transactionally via the outbox;
 *   - a non-VIP check-in enqueues NONE of them;
 *   - a check-in enqueues a printJobCreate command when the tenant's
 *     `check_in.auto_print_badge` toggle is ON;
 *   - it enqueues NO printJobCreate when the tenant disables the toggle.
 *
 * Requirements: 21.3, 5.x (badge auto-handoff). All enqueues are asserted on the
 * transactional outbox (enqueue), never a raw queue.publish.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { NOTIFICATION_SEND } from "@civitasone/events";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const addToRosterMock = vi.fn(async () => undefined);
const removeFromRosterMock = vi.fn(async () => undefined);
const getVisitorCountMock = vi.fn(async () => 0);
const isWatchlistedMock = vi.fn(async () => false);
let autoPrintEnabled = false;

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;

// Ordered select responses: 1=digitalPasses, 2=visitRequests, 3=locations.
function makeChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => {
    if (!fakeTx.__n) fakeTx.__n = 0;
    fakeTx.__n++;
    if (fakeTx.__n === 1) return makeChain(passRow ? [passRow] : []);
    if (fakeTx.__n === 2) return makeChain(visitRow ? [visitRow] : []);
    return makeChain([{ capacityThreshold: null }]);
  }) as unknown as (() => ReturnType<typeof makeChain>) & { __n?: number },
  insert: vi.fn(() => ({ values: async () => undefined })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx) },
  scopedRead: async () => [],
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => markProcessedMock(...a),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));

vi.mock("../src/modules/evacuation/roster.js", () => ({
  addToRoster: (...a: unknown[]) => addToRosterMock(...a),
  removeFromRoster: (...a: unknown[]) => removeFromRosterMock(...a),
  getVisitorCount: (...a: unknown[]) => getVisitorCountMock(...a),
}));

vi.mock("../src/modules/blacklist/screening-store.js", () => ({
  isWatchlisted: (...a: unknown[]) => isWatchlistedMock(...a),
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyBoolean: async () => autoPrintEnabled,
}));

const { registerCheckInConsumers } = await import("../src/modules/check-in/consumer.js");
const { COMMANDS } = await import("../src/topics.js");
const { VIP_ARRIVED_EVENT } = await import("../src/modules/vip/routes.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GATE_ID = "55555555-5555-5555-5555-555555555555";
const VISIT_REQUEST_ID = "66666666-6666-6666-6666-666666666666";
const HOST_ID = "77777777-7777-7777-7777-777777777777";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerCheckInConsumers(queue);
  return queue;
}

async function checkIn(queue: MemoryQueue): Promise<void> {
  await queue.publish(COMMANDS.checkInRecord, {
    type: COMMANDS.checkInRecord,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload: { passId: PASS_ID, gateId: GATE_ID },
  });
  await new Promise((r) => setTimeout(r, 10));
}

/** All outbox enqueues whose payload carries the given NOTIFICATION_SEND eventType. */
function notificationsFor(eventType: string): any[] {
  return enqueueMock.mock.calls
    .map((c) => c[1] as any)
    .filter((e) => e && e.topic === NOTIFICATION_SEND && e.payload?.eventType === eventType);
}

function printJobEnqueues(): any[] {
  return enqueueMock.mock.calls
    .map((c) => c[1] as any)
    .filter((e) => e && e.topic === COMMANDS.printJobCreate);
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  addToRosterMock.mockReset().mockResolvedValue(undefined);
  removeFromRosterMock.mockReset().mockResolvedValue(undefined);
  getVisitorCountMock.mockReset().mockResolvedValue(0);
  isWatchlistedMock.mockReset().mockResolvedValue(false);
  fakeTx.select.mockClear();
  (fakeTx as unknown as { __n?: number }).__n = 0;
  autoPrintEnabled = false;
  passRow = {
    id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_REQUEST_ID,
    locationId: LOCATION_ID, status: "active", passType: "single",
  };
  visitRow = {
    id: VISIT_REQUEST_ID, tenantId: TENANT, visitorName: "Ravi VIP",
    visitorPhone: "9999999999", hostEmployeeId: HOST_ID,
    visitorCategory: "standard", identityDocRef: null,
  };
});

describe("Fix 1 — VIP arrival alert", () => {
  it("a VIP check-in enqueues host + protocol-officer + reception notifications", async () => {
    visitRow = { ...visitRow, visitorCategory: "vip" };
    const queue = freshQueue();
    await checkIn(queue);

    const vipNotifs = notificationsFor(VIP_ARRIVED_EVENT);
    expect(vipNotifs).toHaveLength(3);
    const recipients = vipNotifs.map((n) => n.payload.recipient);
    expect(recipients).toContain(HOST_ID);            // host
    expect(recipients).toContain("protocol_officer"); // protocol officer
    expect(recipients).toContain("reception_desk");   // reception
    // Every VIP notification carries the visitor name + gate as template vars.
    for (const n of vipNotifs) {
      expect(n.payload.variables.visitorName).toBe("Ravi VIP");
      expect(n.payload.variables.gateId).toBe(GATE_ID);
      expect(n.tenantId).toBe(TENANT);
    }
    expect(queue.dlq).toHaveLength(0);
  });

  it("a non-VIP (standard) check-in enqueues NO VIP-arrival notifications", async () => {
    const queue = freshQueue();
    await checkIn(queue); // visitorCategory = "standard" by default

    expect(notificationsFor(VIP_ARRIVED_EVENT)).toHaveLength(0);
    expect(queue.dlq).toHaveLength(0);
  });
});

describe("Fix 2 — check-in → badge auto-handoff", () => {
  it("enqueues a printJobCreate when the tenant's auto_print_badge toggle is ON", async () => {
    autoPrintEnabled = true;
    const queue = freshQueue();
    await checkIn(queue);

    const jobs = printJobEnqueues();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.passId).toBe(PASS_ID);
    expect(jobs[0].payload.visitorCategory).toBe("default"); // "standard" → default bucket
    expect(jobs[0].tenantId).toBe(TENANT);
    expect(queue.dlq).toHaveLength(0);
  });

  it("enqueues NO printJobCreate when the tenant disables the toggle", async () => {
    autoPrintEnabled = false;
    const queue = freshQueue();
    await checkIn(queue);

    expect(printJobEnqueues()).toHaveLength(0);
    expect(queue.dlq).toHaveLength(0);
  });

  it("uses the visitor's own badge category for a VIP visitor", async () => {
    autoPrintEnabled = true;
    visitRow = { ...visitRow, visitorCategory: "vip" };
    const queue = freshQueue();
    await checkIn(queue);

    const jobs = printJobEnqueues();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.visitorCategory).toBe("vip");
  });
});
