/**
 * digital-pass/consumer.ts's passReplace handler sources the replacement
 * pass's visitor identity from `originalPass.createdBy` (consumer.ts:314-315:
 * `visitorId: originalPass.createdBy, // visitor identified by creator
 * context`) instead of the actual visitor. `createdBy` is `msg.actorId` from
 * whichever command originally created the pass row — the issuing
 * employee/host/system actor, not the visitor — so a replaced pass's QR JWT
 * embeds the wrong `visitor_id` claim.
 *
 * There is no visitor-identity column on `digital_passes` at all (schema.ts
 * has no `visitorId` field), so this test proves the negative that IS
 * checkable without inventing a ground truth this codebase doesn't have:
 * the replacement must not be issued to the pass's *creating actor* — that
 * is categorically the wrong source, whatever the eventual correct fix reads
 * instead (e.g. resolving the visit request's own identity).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const addToRevokedSetMock = vi.fn(async () => undefined);
const replacePassMock = vi.fn(async () => ({
  passNumber: "VP-NEW-001",
  qrJwt: "new-signed-jwt",
  validFrom: new Date("2025-06-15T08:00:00Z"),
  validUntil: new Date("2025-06-15T18:00:00Z"),
}));

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
let selectCallIdx = 0;

function makeSelectChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => {
    selectCallIdx++;
    if (selectCallIdx === 1) return makeSelectChain(passRow ? [passRow] : []);
    return makeSelectChain(visitRow ? [visitRow] : []);
  }),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/modules/digital-pass/revocation-store.js", () => ({
  addToRevokedSet: (...args: unknown[]) => addToRevokedSetMock(...args),
}));

vi.mock("../src/modules/digital-pass/domain.js", () => ({
  generatePass: async () => ({ passNumber: "VP-1", qrJwt: "j", validFrom: new Date(), validUntil: new Date() }),
  revokePass: () => ({ revoked: true, revokedAt: new Date("2025-06-15T12:00:00Z"), revokeReason: "Lost badge" }),
  replacePass: (...args: unknown[]) => replacePassMock(...args),
  computeValidityWindow: (_t: string, from: Date, until: Date) => ({ validFrom: from, validUntil: until }),
}));

const { registerDigitalPassConsumers } = await import("../src/modules/digital-pass/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
// The message actor performing the replace (e.g. a front-desk employee) —
// deliberately distinct from PASS_CREATOR below.
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const NEW_PASS_ID = "44444444-4444-4444-4444-444444444444";
const VISIT_ID = "55555555-5555-5555-5555-555555555555";
const LOCATION_ID = "66666666-6666-6666-6666-666666666666";
// The actor who originally created the pass row — e.g. the SYSTEM actor for
// an auto-approved VIP pass, or a receptionist keying in a walk-in. Never
// the visitor.
const PASS_CREATOR = "77777777-7777-7777-7777-777777777777";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerDigitalPassConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, { type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0", payload });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  addToRevokedSetMock.mockReset().mockResolvedValue(undefined);
  replacePassMock.mockClear();
  fakeTx.select.mockClear();
  selectCallIdx = 0;

  passRow = {
    id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_ID, locationId: LOCATION_ID,
    passNumber: "VP-001", status: "active", passType: "single", qrJwt: "old-jwt",
    validFrom: new Date("2025-06-15T08:00:00Z"), validUntil: new Date("2025-06-15T18:00:00Z"),
    permittedAreas: ["area-1"], revoked: false, escortEmployeeId: null,
    createdBy: PASS_CREATOR,
  };
  visitRow = { id: VISIT_ID, tenantId: TENANT, visitorName: "Jane Visitor", visitorPhone: "9876543210", visitorEmail: "jane@example.com" };
});

const replacePayload = {
  originalPassId: PASS_ID, newPassId: NEW_PASS_ID, reason: "Lost badge", tenantId: TENANT,
  tenantPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
};

describe("passReplace visitor identity (today's actual behavior)", () => {
  it("sources the replacement's visitorId from the original pass's createdBy (the issuing actor, not the visitor)", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    expect(replacePassMock).toHaveBeenCalledTimes(1);
    const params = replacePassMock.mock.calls[0]?.[0] as { visitorId?: string };
    expect(params.visitorId).toBe(PASS_CREATOR);
  });
});

describe("what SHOULD happen (fails today)", () => {
  it.fails("a replacement pass is not issued to whichever actor happened to create the original pass row", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    const params = replacePassMock.mock.calls[0]?.[0] as { visitorId?: string };
    expect(params.visitorId).not.toBe(PASS_CREATOR);
  });
});
