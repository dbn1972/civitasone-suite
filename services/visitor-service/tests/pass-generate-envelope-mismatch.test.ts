/**
 * CRITICAL — approving a visit request never produces a digital pass.
 *
 * Root cause, confirmed by direct reading of the three publish sites and the
 * shared envelope contract:
 *
 *   - modules/visit-request/consumer.ts:298, :492, :901 (visitRequestCreate
 *     auto-approve, visitRequestApprove, workflowTaskCompleted) all publish
 *     `COMMANDS.passGenerate` via the raw infra `queue` singleton with
 *     `messageId: `${id}:pass-gen`` — not a UUID.
 *   - packages/events/src/envelope.ts:15 — `eventEnvelopeSchema` requires
 *     `messageId: z.string().uuid()`.
 *   - services/queue-service/src/bus.ts:184-190 (MemoryQueue#deliver) and the
 *     equivalent SQS consumer loop both call `parseEnvelope()` BEFORE any
 *     handler runs; on failure the message is pushed straight to the DLQ and
 *     the handler (digital-pass/consumer.ts's passGenerate subscriber,
 *     modules/digital-pass/consumer.ts:86) is never invoked.
 *
 * Even if the messageId were fixed, the payload shape sent by all three
 * sites — {visitRequestId, tenantId, locationId, visitorName, visitorPhone,
 * visitorEmail, hostEmployeeId, passType, permittedAreas, scheduledAt} — is
 * missing `id`, `visitorId`, `validFrom`, `validUntil`, and
 * `tenantPrivateKeyPem`, all required by digital-pass/consumer.ts's
 * `PassGeneratePayload` (consumer.ts:53-65). The one function that builds the
 * correct shape, digital-pass/commands.ts#passGenerate(), has zero call sites
 * anywhere in src besides its own definition — confirmed by repo-wide grep.
 *
 * FIXED: all 3 sites now route through digital-pass/commands.ts#passGenerate()
 * via visit-request/consumer.ts's triggerPassGenerate() helper, which mints a
 * real UUID messageId and the full correct payload shape. The "what SHOULD
 * happen" assertions below are flipped from it.fails() to plain it() — they
 * now pass for real, not just in principle.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { parseEnvelope } from "@civitasone/events";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const generatePassMock = vi.fn(async () => ({
  passNumber: "VP-TEST-001",
  qrJwt: "signed-jwt-token",
  validFrom: new Date("2025-06-15T08:00:00Z"),
  validUntil: new Date("2025-06-15T18:00:00Z"),
}));

let visitRequestRow: Record<string, unknown> | undefined;
let areaRows: Record<string, unknown>[] = [];

function makeSelectChain(rows: Record<string, unknown>[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

const fakeTx = {
  select: vi.fn(() => makeSelectChain(visitRequestRow ? [visitRequestRow] : [])),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  versionedUpdate: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getAutoApproveCategories: async () => new Set(["vip"]),
  getPolicyNumber: async () => 7,
  MS_PER_DAY: 86_400_000,
}));

vi.mock("../src/modules/location/schema.js", () => ({
  areas: { id: "id", tenantId: "tenantId", locationId: "locationId", securityLevel: "securityLevel", authorizedApprovers: "authorizedApprovers" },
}));

vi.mock("../src/modules/digital-pass/domain.js", () => ({
  generatePass: (...args: unknown[]) => generatePassMock(...args),
  revokePass: () => ({ revoked: true, revokedAt: new Date(), revokeReason: "x" }),
  replacePass: async () => ({ passNumber: "VP-2", qrJwt: "j", validFrom: new Date(), validUntil: new Date() }),
  computeValidityWindow: (_t: string, from: Date, until: Date) => ({ validFrom: from, validUntil: until }),
}));

vi.mock("../src/modules/digital-pass/revocation-store.js", () => ({
  addToRevokedSet: vi.fn(async () => undefined),
}));

// The infra queue singleton is shared between visit-request's post-commit
// publish and digital-pass's subscription — a REAL MemoryQueue so the
// dead-letter behavior is the genuine mechanism, not a mock's opinion of it.
const infraQueue = new MemoryQueue();
vi.mock("../src/shared/infra.js", () => ({
  queue: infraQueue,
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...args: unknown[]) => args.join(":"), getOrLoad: vi.fn(async (_k: unknown, fn: () => unknown) => fn()) },
}));

const { registerVisitRequestConsumers } = await import("../src/modules/visit-request/consumer.js");
const { registerDigitalPassConsumers } = await import("../src/modules/digital-pass/consumer.js");
const { passGenerate: correctlyShapedPassGenerate } = await import("../src/modules/digital-pass/commands.js");
const { COMMANDS, CONSUMED_EVENTS } = await import("../src/topics.js");

// Wire the REAL digital-pass subscriber onto the same singleton visit-request
// publishes to, exactly as production worker.ts does.
registerDigitalPassConsumers(infraQueue);

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "33333333-3333-3333-3333-333333333333";
const HOST_ID = "44444444-4444-4444-4444-444444444444";
const LOCATION_ID = "55555555-5555-5555-5555-555555555555";

function freshVisitRequestQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerVisitRequestConsumers(queue);
  return queue;
}

async function publishAndDrain(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 30): Promise<void> {
  await queue.publish(topic, { type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", schemaVersion: "1.0", payload });
  await new Promise((r) => setTimeout(r, waitMs));
  await infraQueue.drain();
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  generatePassMock.mockClear();
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  areaRows = [];
  infraQueue.dlq.length = 0;

  visitRequestRow = {
    id: REQUEST_ID, tenantId: TENANT, locationId: LOCATION_ID, hostEmployeeId: HOST_ID,
    status: "pending_approval", visitorName: "Jane Visitor", visitorPhone: "9876543210",
    visitorEmail: "jane@example.com", passType: "single", visitorCategory: "standard",
    permittedAreas: [], scheduledAt: new Date("2025-06-15T10:00:00Z"), version: 1,
  };
});

describe("packages/events envelope contract vs. the actual passGenerate messageId", () => {
  it("rejects the exact non-UUID messageId format used at all three publish sites (visit-request/consumer.ts:298,492,901)", () => {
    const envelopeAsPublishedToday = {
      messageId: `${REQUEST_ID}:pass-gen`,
      type: COMMANDS.passGenerate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-1",
      timestamp: new Date().toISOString(),
      schemaVersion: "1.0",
      payload: { visitRequestId: REQUEST_ID, tenantId: TENANT },
    };

    const result = parseEnvelope(envelopeAsPublishedToday);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("messageId");
  });
});

describe("end-to-end: visitRequestApprove -> passGenerate (FIXED — was 'today's actual behavior')", () => {
  it("FIXED: no longer dead-letters the cascaded passGenerate message — it carries a real UUID messageId and digital-pass's handler actually runs", async () => {
    const queue = freshVisitRequestQueue();
    await publishAndDrain(queue, COMMANDS.visitRequestApprove, { id: REQUEST_ID, tenantId: TENANT });

    const dlqEntry = infraQueue.dlq.find((e) => e.topic === COMMANDS.passGenerate);
    expect(dlqEntry).toBeUndefined();
    expect(generatePassMock).toHaveBeenCalledTimes(1);
  });
});

describe("what SHOULD happen (FIXED)", () => {
  it("approving a visit request actually generates a digital pass", async () => {
    const queue = freshVisitRequestQueue();
    await publishAndDrain(queue, COMMANDS.visitRequestApprove, { id: REQUEST_ID, tenantId: TENANT });

    expect(infraQueue.dlq).toHaveLength(0);
    expect(generatePassMock).toHaveBeenCalledTimes(1);
  });

  it("VIP auto-approve on visitRequestCreate actually generates a digital pass (2nd publish site)", async () => {
    visitRequestRow = { ...visitRequestRow, visitorCategory: "vip" };
    const queue = freshVisitRequestQueue();
    await publishAndDrain(queue, COMMANDS.visitRequestCreate, {
      id: REQUEST_ID, tenantId: TENANT, locationId: LOCATION_ID, visitorName: "Jane",
      visitorPhone: "999", visitorEmail: null, purpose: "meeting", hostEmployeeId: HOST_ID,
      scheduledAt: "2025-06-15T10:00:00Z", passType: "single", identityDocType: null,
      identityDocRef: null, visitorCategory: "vip", source: "portal", permittedAreas: [],
      createdBy: ACTOR,
    });

    expect(infraQueue.dlq).toHaveLength(0);
    expect(generatePassMock).toHaveBeenCalledTimes(1);
  });

  it("workflow approval of a restricted-area visit actually generates a digital pass (3rd publish site)", async () => {
    visitRequestRow = { ...visitRequestRow, status: "pending_approval" };
    const queue = freshVisitRequestQueue();
    await publishAndDrain(queue, CONSUMED_EVENTS.workflowTaskCompleted, {
      taskId: "task-1", instanceId: "instance-1", decision: "approve", refId: REQUEST_ID,
    });

    expect(infraQueue.dlq).toHaveLength(0);
    expect(generatePassMock).toHaveBeenCalledTimes(1);
  });

  it("the passGenerate payload includes every field digital-pass/consumer.ts's PassGeneratePayload requires", async () => {
    const publishSpy = vi.spyOn(infraQueue, "publish");
    const queue = freshVisitRequestQueue();
    await publishAndDrain(queue, COMMANDS.visitRequestApprove, { id: REQUEST_ID, tenantId: TENANT });

    const call = publishSpy.mock.calls.find((c) => c[0] === COMMANDS.passGenerate);
    const sentPayload = (call?.[1] as { payload?: Record<string, unknown> } | undefined)?.payload ?? {};

    expect(sentPayload).toMatchObject({
      id: expect.any(String),
      visitorId: expect.any(String),
      validFrom: expect.any(String),
      validUntil: expect.any(String),
      tenantPrivateKeyPem: expect.any(String),
    });
    publishSpy.mockRestore();
  });
});

describe("the fix-ready replacement already exists but is dead code", () => {
  it("digital-pass/commands.ts#passGenerate() publishes a correctly-shaped, UUID-keyed envelope", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1" } as never;
    const accepted = await correctlyShapedPassGenerate(ctx, {
      visitRequestId: REQUEST_ID,
      visitorId: "66666666-6666-6666-6666-666666666666",
      locationId: LOCATION_ID,
      passType: "single",
      validFrom: "2025-06-15T08:00:00Z",
      validUntil: "2025-06-15T18:00:00Z",
      permittedAreas: [],
      tenantPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
    });

    expect(parseEnvelope({
      messageId: accepted.id,
      type: COMMANDS.passGenerate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-1",
      timestamp: new Date().toISOString(),
      schemaVersion: "1.0",
      payload: {},
    }).ok).toBe(true);
  });
});
