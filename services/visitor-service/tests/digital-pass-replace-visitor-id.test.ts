/**
 * digital-pass/consumer.ts's passReplace handler used to source the
 * replacement pass's visitor identity from `originalPass.createdBy`
 * (consumer.ts:314-315: `visitorId: originalPass.createdBy, // visitor
 * identified by creator context`) instead of the actual visitor.
 * `createdBy` is `msg.actorId` from whichever command originally created the
 * pass row — the issuing employee/host/system actor, not the visitor — so a
 * replaced pass's QR JWT embedded the wrong `visitor_id` claim.
 *
 * There is no visitor-identity column on `digital_passes` itself (schema.ts
 * has no `visitorId` field) — the real source is `visit_requests.visitor_id`,
 * reached via the pass's `visitRequestId`.
 *
 * FIXED: the handler now looks up the visit request BEFORE calling
 * `replacePass()` and sources `visitorId: visit?.visitorId ??
 * originalPass.visitRequestId` — the same `visitorId ?? visitRequestId`
 * fallback convention visit-request/consumer.ts#triggerPassGenerate already
 * established for passGenerate (visit_requests.visitor_id is populated later
 * by identity verification and may still be null at replace time).
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
// The actual visitor — visit_requests.visitor_id — the correct source for
// the replacement's visitorId. Deliberately distinct from both PASS_CREATOR
// and VISIT_ID so a test asserting `toBe(VISITOR_ID)` cannot pass by
// accident via either the old wrong source or the visitRequestId fallback.
const VISITOR_ID = "88888888-8888-8888-8888-888888888888";

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
  visitRow = {
    id: VISIT_ID, tenantId: TENANT, visitorId: VISITOR_ID, visitorName: "Jane Visitor",
    visitorPhone: "9876543210", visitorEmail: "jane@example.com",
  };
});

const replacePayload = {
  originalPassId: PASS_ID, newPassId: NEW_PASS_ID, reason: "Lost badge", tenantId: TENANT,
  tenantPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
};

describe("passReplace visitor identity (FIXED)", () => {
  it("sources the replacement's visitorId from the visit request's own visitor_id — not the original pass's createdBy (the issuing actor)", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    expect(replacePassMock).toHaveBeenCalledTimes(1);
    const params = replacePassMock.mock.calls[0]?.[0] as { visitorId?: string };
    expect(params.visitorId).toBe(VISITOR_ID);
    expect(params.visitorId).not.toBe(PASS_CREATOR);
  });

  it("falls back to the visit request's own id (not the pass creator) when visit_requests.visitor_id is still null — same convention as triggerPassGenerate", async () => {
    visitRow = { id: VISIT_ID, tenantId: TENANT, visitorId: null, visitorName: "Jane Visitor", visitorPhone: "9876543210", visitorEmail: "jane@example.com" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    const params = replacePassMock.mock.calls[0]?.[0] as { visitorId?: string };
    expect(params.visitorId).toBe(VISIT_ID);
    expect(params.visitorId).not.toBe(PASS_CREATOR);
  });
});

describe("what SHOULD happen (FIXED)", () => {
  it("a replacement pass is not issued to whichever actor happened to create the original pass row", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    const params = replacePassMock.mock.calls[0]?.[0] as { visitorId?: string };
    expect(params.visitorId).not.toBe(PASS_CREATOR);
  });
});
