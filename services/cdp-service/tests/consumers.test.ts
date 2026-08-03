/**
 * Consumer coverage for the four cdp commands that carry real asynchronous work. The two
 * cross-service crm.contact.* handlers have their own file (crm-consumer.test.ts) because
 * their resolution cases need an identity graph keyed by real identifier hashes.
 *
 * `markProcessed` is backed by a real Set rather than a stub returning true, so the
 * idempotency cases below exercise the actual gate: the second delivery of a messageId
 * returns false exactly as the inbox table would, and the assertion that the effect
 * happened once is meaningful instead of tautological.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommandEnvelope } from "@civitasone/queue";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const SEGMENT_ID = "cccccccc-1111-4000-8000-000000000001";
const ACTIVATION_ID = "dddddddd-1111-4000-8000-000000000001";
const DSAR_ID = "eeeeeeee-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  processed: new Set<string>(),
  markProcessedMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  eventInsertMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  profileFindByIdTxMock: vi.fn(),
  profileInsertMock: vi.fn(),
  profileUpdateMock: vi.fn(),
  segmentFindByIdMock: vi.fn(),
  membershipDeleteMock: vi.fn(),
  activationFindByIdMock: vi.fn(),
  activationUpdateStatusMock: vi.fn(),
  activationInsertMock: vi.fn(),
  activationRefreshMock: vi.fn(),
  dsarFindByIdMock: vi.fn(),
  dsarStartMock: vi.fn(),
  dsarInsertMock: vi.fn(),
  deviceDeleteMock: vi.fn(),
  identityFindByHashTxMock: vi.fn(),
  identityInsertMock: vi.fn(),
  identityDeleteMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: (_tx: unknown, messageId: string) => H.markProcessedMock(messageId),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (t: string, r: string, i: string) => `cdp:${t}:${r}:${i}`,
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/events/repo.js", () => ({
  insert: (...a: unknown[]) => H.eventInsertMock(...a),
  insertBatch: vi.fn(),
  listByProfile: vi.fn(),
  getTimeline: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  findByIdTx: (...a: unknown[]) => H.profileFindByIdTxMock(...a),
  insert: (...a: unknown[]) => H.profileInsertMock(...a),
  update: (...a: unknown[]) => H.profileUpdateMock(...a),
  listByTenant: vi.fn(),
  markMerged: vi.fn(),
  findByIds: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/segments/repo.js", () => ({
  findById: (...a: unknown[]) => H.segmentFindByIdMock(...a),
  listByTenant: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
  evaluateMembers: vi.fn(),
  updateMemberCount: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/segments/membership-repo.js", () => ({
  listMembers: vi.fn(),
  countMembers: vi.fn(),
  countSegmentsForProfile: vi.fn(),
  recompute: vi.fn(),
  deleteByProfile: (...a: unknown[]) => H.membershipDeleteMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/activations/repo.js", () => ({
  findById: (...a: unknown[]) => H.activationFindByIdMock(...a),
  listByTenant: vi.fn(),
  insert: vi.fn(),
  updateStatus: (...a: unknown[]) => H.activationUpdateStatusMock(...a),
  insert: (...a: unknown[]) => H.activationInsertMock(...a),
  refreshPendingAudience: (...a: unknown[]) => H.activationRefreshMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/dsar/repo.js", () => ({
  findById: (...a: unknown[]) => H.dsarFindByIdMock(...a),
  listByTenant: vi.fn(),
  insert: vi.fn(),
  complete: vi.fn(),
  startProcessing: (...a: unknown[]) => H.dsarStartMock(...a),
  insert: (...a: unknown[]) => H.dsarInsertMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/device-repo.js", () => ({
  findByToken: vi.fn(),
  listByProfile: vi.fn(),
  countByProfile: vi.fn(),
  insert: vi.fn(),
  relink: vi.fn(),
  deleteByProfile: (...a: unknown[]) => H.deviceDeleteMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/repo.js", () => ({
  findByHash: vi.fn(),
  findByHashTx: (...a: unknown[]) => H.identityFindByHashTxMock(...a),
  findByProfileId: vi.fn(),
  findById: vi.fn(),
  insert: (...a: unknown[]) => H.identityInsertMock(...a),
  deleteById: vi.fn(),
  deleteByProfile: (...a: unknown[]) => H.identityDeleteMock(...a),
  reassignProfile: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

const { handleIngestEventBatch } = await import("../src/modules/events/consumer.js");
const { handleComputeSegment } = await import("../src/modules/segments/consumer.js");
const { handleActivateSegment } = await import("../src/modules/activations/consumer.js");
const { handleRaiseDsar } = await import("../src/modules/dsar/consumer.js");

function envelope(payload: unknown, messageId = "10000000-0000-4000-8000-000000000001"): CommandEnvelope<unknown> {
  return {
    messageId,
    type: "test",
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload,
  };
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    tenantId: TENANT,
    profileType: "individual",
    attributes: {} as Record<string, unknown>,
    sourceLineage: [] as Array<{ source: string; sourceId: string; timestamp: string }>,
    mergedFromIds: [] as string[],
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 3,
    ...overrides,
  };
}

/** Topics of the outbox rows written during a handler run. */
function enqueuedTopics(): string[] {
  return H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
}

beforeEach(() => {
  vi.clearAllMocks();
  H.processed.clear();
  // Real inbox semantics: first delivery claims the id, every later one is refused.
  H.markProcessedMock.mockImplementation(async (messageId: string) => {
    if (H.processed.has(messageId)) return false;
    H.processed.add(messageId);
    return true;
  });
  H.enqueueMock.mockResolvedValue(undefined);
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.eventInsertMock.mockResolvedValue(undefined);
  H.profileFindByIdMock.mockResolvedValue(makeProfile());
  H.profileFindByIdTxMock.mockResolvedValue(makeProfile());
  H.profileInsertMock.mockResolvedValue(undefined);
  H.profileUpdateMock.mockResolvedValue(true);
  H.segmentFindByIdMock.mockResolvedValue({ id: SEGMENT_ID, tenantId: TENANT, status: "active" });
  H.membershipDeleteMock.mockResolvedValue(2);
  H.activationFindByIdMock.mockResolvedValue({
    id: ACTIVATION_ID, tenantId: TENANT, segmentId: SEGMENT_ID, channel: "sms",
    status: "pending", audienceCount: 42, startedAt: null, completedAt: null, version: 1,
  });
  H.activationUpdateStatusMock.mockResolvedValue(true);
  H.activationInsertMock.mockResolvedValue(undefined);
  H.activationRefreshMock.mockResolvedValue([ACTIVATION_ID]);
  H.dsarFindByIdMock.mockResolvedValue({
    id: DSAR_ID, tenantId: TENANT, profileId: PROFILE_ID, requestType: "erasure",
    status: "pending", reason: null, requestedAt: new Date(), completedAt: null, version: 1,
  });
  H.dsarStartMock.mockResolvedValue(true);
  H.dsarInsertMock.mockResolvedValue(undefined);
  H.deviceDeleteMock.mockResolvedValue(3);
  H.identityFindByHashTxMock.mockResolvedValue([]);
  H.identityInsertMock.mockResolvedValue(undefined);
  H.identityDeleteMock.mockResolvedValue(4);
});

describe("cdp.event.ingest_batch consumer (CDP-003)", () => {
  const payload = {
    profileId: PROFILE_ID,
    eventType: "order.placed",
    payload: { orderId: "o-1" },
    occurredAt: "2026-01-01T10:00:00.000Z",
    source: "web-collector",
  };

  it("writes the event, emits the domain event and an audit event", async () => {
    await handleIngestEventBatch(envelope(payload));
    expect(H.eventInsertMock).toHaveBeenCalledOnce();
    const row = H.eventInsertMock.mock.calls[0]?.[1] as { profileId: string; eventType: string; occurredAt: Date };
    expect(row.profileId).toBe(PROFILE_ID);
    expect(row.eventType).toBe("order.placed");
    expect(row.occurredAt.toISOString()).toBe(payload.occurredAt);
    expect(enqueuedTopics()).toEqual(["cdp.event.ingested", "audit.event.record"]);
    expect(H.cacheInvalidateMock).toHaveBeenCalledWith(`cdp:${TENANT}:profile_summary:${PROFILE_ID}`);
  });

  it("idempotency — the same messageId twice stores exactly one event", async () => {
    await handleIngestEventBatch(envelope(payload));
    await handleIngestEventBatch(envelope(payload));
    expect(H.markProcessedMock).toHaveBeenCalledTimes(2);
    expect(H.eventInsertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("a different messageId for the same event is processed again", async () => {
    await handleIngestEventBatch(envelope(payload, "10000000-0000-4000-8000-00000000000a"));
    await handleIngestEventBatch(envelope(payload, "10000000-0000-4000-8000-00000000000b"));
    expect(H.eventInsertMock).toHaveBeenCalledTimes(2);
  });

  it("a malformed payload is skipped without throwing", async () => {
    await expect(handleIngestEventBatch(envelope({ eventType: "order.placed" }))).resolves.toBeUndefined();
    expect(H.eventInsertMock).not.toHaveBeenCalled();
    expect(H.markProcessedMock).not.toHaveBeenCalled();
  });

  it("a partial payload (no occurredAt) is skipped without throwing", async () => {
    await expect(
      handleIngestEventBatch(envelope({ profileId: PROFILE_ID, eventType: "order.placed" })),
    ).resolves.toBeUndefined();
    expect(H.eventInsertMock).not.toHaveBeenCalled();
  });

  it("an unknown profile is skipped", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    await handleIngestEventBatch(envelope(payload));
    expect(H.eventInsertMock).not.toHaveBeenCalled();
  });

  it("a merged profile is skipped — its events belong to the winner", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    await handleIngestEventBatch(envelope(payload));
    expect(H.eventInsertMock).not.toHaveBeenCalled();
  });

  it("consent withdrawn between publish and consume blocks the write", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ attributes: { consent: { marketing: false } } }));
    await handleIngestEventBatch(envelope({ ...payload, eventType: "marketing.email_opened" }));
    expect(H.eventInsertMock).not.toHaveBeenCalled();
  });

  it("consent granted allows a consent-gated event", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ attributes: { consent: { marketing: true } } }));
    await handleIngestEventBatch(envelope({ ...payload, eventType: "marketing.email_opened" }));
    expect(H.eventInsertMock).toHaveBeenCalledOnce();
  });
});

describe("cdp.segment.compute consumer (CDP-005)", () => {
  const payload = { segmentId: SEGMENT_ID, memberCount: 7, computedAt: "2026-01-01T10:00:00.000Z" };

  it("refreshes the audience snapshot of pending activations only", async () => {
    await handleComputeSegment(envelope(payload));
    expect(H.activationRefreshMock).toHaveBeenCalledWith({}, TENANT, SEGMENT_ID, 7);
    expect(enqueuedTopics()).toEqual(["cdp.activation.audience_refreshed", "audit.event.record"]);
  });

  it("does not re-run the recompute the route already performed", async () => {
    const membershipRepo = await import("../src/modules/segments/membership-repo.js");
    await handleComputeSegment(envelope(payload));
    expect(membershipRepo.recompute).not.toHaveBeenCalled();
  });

  it("idempotency — the same messageId twice refreshes exactly once", async () => {
    await handleComputeSegment(envelope(payload));
    await handleComputeSegment(envelope(payload));
    expect(H.activationRefreshMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("emits nothing when no activation is waiting on the segment", async () => {
    H.activationRefreshMock.mockResolvedValue([]);
    await handleComputeSegment(envelope(payload));
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });

  it("a malformed payload is skipped without throwing", async () => {
    await expect(handleComputeSegment(envelope({ segmentId: "not-a-uuid" }))).resolves.toBeUndefined();
    expect(H.activationRefreshMock).not.toHaveBeenCalled();
  });

  it("a negative member count is rejected rather than written", async () => {
    await handleComputeSegment(envelope({ segmentId: SEGMENT_ID, memberCount: -1 }));
    expect(H.activationRefreshMock).not.toHaveBeenCalled();
  });

  it("an archived or unknown segment is skipped", async () => {
    H.segmentFindByIdMock.mockResolvedValue(null);
    await handleComputeSegment(envelope(payload));
    expect(H.activationRefreshMock).not.toHaveBeenCalled();
  });
});

describe("cdp.segment.activate consumer (CDP-012)", () => {
  const payload = {
    activationId: ACTIVATION_ID,
    segmentId: SEGMENT_ID,
    channel: "sms",
    audienceCount: 42,
    dispatchAt: "2020-01-01T00:00:00.000Z",
  };

  it("inserts and dispatches an immediate run", async () => {
    await handleActivateSegment(envelope(payload));
    expect(H.activationInsertMock).toHaveBeenCalledOnce();
    const row = H.activationInsertMock.mock.calls[0]?.[1] as { status: string };
    expect(row.status).toBe("completed");
    expect(enqueuedTopics()).toEqual([
      "cdp.activation.requested",
      "cdp.activation.dispatched",
      "audit.event.record",
    ]);
  });

  it("idempotency — the same messageId twice writes exactly once", async () => {
    await handleActivateSegment(envelope(payload));
    await handleActivateSegment(envelope(payload));
    expect(H.activationInsertMock).toHaveBeenCalledOnce();
  });

  it("a future dispatch time inserts pending without dispatch", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await handleActivateSegment(envelope({ ...payload, dispatchAt: future }));
    expect(H.activationInsertMock).toHaveBeenCalledOnce();
    const row = H.activationInsertMock.mock.calls[0]?.[1] as { status: string };
    expect(row.status).toBe("pending");
    expect(enqueuedTopics()).toEqual(["cdp.activation.requested", "audit.event.record"]);
  });

  it("an unsupported channel is skipped without throwing", async () => {
    await expect(handleActivateSegment(envelope({ ...payload, channel: "carrier-pigeon" }))).resolves.toBeUndefined();
    expect(H.activationInsertMock).not.toHaveBeenCalled();
  });

  it("a malformed payload is skipped without throwing", async () => {
    await expect(handleActivateSegment(envelope({ activationId: ACTIVATION_ID }))).resolves.toBeUndefined();
    expect(H.activationInsertMock).not.toHaveBeenCalled();
  });
});

describe("cdp.dsar.raise consumer (CDP-011)", () => {
  const payload = { dsarId: DSAR_ID, profileId: PROFILE_ID, requestType: "erasure" };

  it("erasure inserts, starts processing, and purges in one transaction", async () => {
    await handleRaiseDsar(envelope(payload));
    expect(H.dsarInsertMock).toHaveBeenCalledOnce();
    expect(H.dsarStartMock).toHaveBeenCalledWith({}, DSAR_ID, TENANT, 1);
    expect(H.deviceDeleteMock).toHaveBeenCalledWith({}, PROFILE_ID, TENANT);
    expect(H.identityDeleteMock).toHaveBeenCalledWith({}, PROFILE_ID, TENANT);
    expect(H.membershipDeleteMock).toHaveBeenCalledWith({}, PROFILE_ID, TENANT);
    expect(enqueuedTopics()).toEqual(["cdp.dsar.raised", "cdp.dsar.in_progress", "audit.event.record"]);
  });

  it("idempotency — the same messageId twice purges exactly once", async () => {
    await handleRaiseDsar(envelope(payload));
    await handleRaiseDsar(envelope(payload));
    expect(H.dsarInsertMock).toHaveBeenCalledOnce();
    expect(H.dsarStartMock).toHaveBeenCalledOnce();
    expect(H.deviceDeleteMock).toHaveBeenCalledOnce();
  });

  it("rectification drops audiences but keeps identifiers and devices", async () => {
    await handleRaiseDsar(envelope({ ...payload, requestType: "rectification" }));
    expect(H.membershipDeleteMock).toHaveBeenCalledOnce();
    expect(H.deviceDeleteMock).not.toHaveBeenCalled();
    expect(H.identityDeleteMock).not.toHaveBeenCalled();
  });

  it("access destroys nothing — it is a read-only disclosure", async () => {
    await handleRaiseDsar(envelope({ ...payload, requestType: "access" }));
    expect(H.dsarStartMock).toHaveBeenCalledOnce();
    expect(H.deviceDeleteMock).not.toHaveBeenCalled();
    expect(H.identityDeleteMock).not.toHaveBeenCalled();
    expect(H.membershipDeleteMock).not.toHaveBeenCalled();
  });

  it("an optimistic-lock miss purges nothing after insert", async () => {
    H.dsarStartMock.mockResolvedValue(false);
    await handleRaiseDsar(envelope(payload));
    expect(H.dsarInsertMock).toHaveBeenCalledOnce();
    expect(H.deviceDeleteMock).not.toHaveBeenCalled();
  });

  it("a malformed payload is skipped without throwing", async () => {
    await expect(handleRaiseDsar(envelope({ dsarId: DSAR_ID }))).resolves.toBeUndefined();
    expect(H.dsarInsertMock).not.toHaveBeenCalled();
  });
});
