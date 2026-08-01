/**
 * crm-consumer.test.ts — cross-service stitching for crm.contact.created /
 * crm.contact.updated (src/modules/identity/crm-consumer.ts).
 *
 * `markProcessed` is backed by a real Set rather than a stub returning true, so the
 * idempotency cases exercise the actual gate: the second delivery of a messageId returns
 * false exactly as the inbox table would, which makes "exactly one row" meaningful instead
 * of tautological. `identity/repo.findByHashTx` is backed by a hash→edges map so the
 * resolution cases go through the real SHA-256 hashing in identity/domain.ts — a test that
 * stubbed the hash could not catch a second hashing scheme, which is the one bug that would
 * silently stop CRM contacts from ever matching.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommandEnvelope } from "@civitasone/queue";
import { hashIdentifier } from "../src/modules/identity/domain.js";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-1111-4000-8000-000000000001";
const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const OTHER_PROFILE_ID = "bbbbbbbb-2222-4000-8000-000000000002";
const CONTACT_ID = "ffffffff-1111-4000-8000-000000000001";

/** All PII: asserted absent from every emitted event payload, never logged. */
const CONTACT_NAME = "Asha Devi";
const CONTACT_EMAIL = "asha.devi@example.gov.in";
const CONTACT_PHONE = "+91 98765 43210";

const EMAIL_HASH = hashIdentifier("email", CONTACT_EMAIL);
const PHONE_HASH = hashIdentifier("phone", CONTACT_PHONE);
const CONTACT_HASH = hashIdentifier("externalId", CONTACT_ID);

const H = vi.hoisted(() => ({
  processed: new Set<string>(),
  /** hash → identity-graph edges, so resolution is driven by real hashes. */
  graph: new Map<string, Array<Record<string, unknown>>>(),
  markProcessedMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  profileFindByIdTxMock: vi.fn(),
  profileInsertMock: vi.fn(),
  profileUpdateMock: vi.fn(),
  identityFindByHashTxMock: vi.fn(),
  identityInsertMock: vi.fn(),
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

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: vi.fn(),
  findByIdTx: (...a: unknown[]) => H.profileFindByIdTxMock(...a),
  insert: (...a: unknown[]) => H.profileInsertMock(...a),
  update: (...a: unknown[]) => H.profileUpdateMock(...a),
  listByTenant: vi.fn(),
  markMerged: vi.fn(),
  findByIds: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/repo.js", () => ({
  findByHash: vi.fn(),
  findByHashTx: (...a: unknown[]) => H.identityFindByHashTxMock(...a),
  findByProfileId: vi.fn(),
  findById: vi.fn(),
  insert: (...a: unknown[]) => H.identityInsertMock(...a),
  deleteById: vi.fn(),
  deleteByProfile: vi.fn(),
  reassignProfile: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

const { handleCrmContactCreated, handleCrmContactUpdated } = await import(
  "../src/modules/identity/crm-consumer.js"
);

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

/** Seed an identity-graph edge under a real identifier hash. */
function seedEdge(hash: string, profileId: string, identifierType: string): void {
  const rows = H.graph.get(hash) ?? [];
  rows.push({
    id: `edge-${hash.slice(0, 8)}`,
    tenantId: TENANT,
    profileId,
    identifierType,
    identifierHash: hash,
    confidence: "1.0000",
    createdAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
  });
  H.graph.set(hash, rows);
}

/** Topics of the outbox rows written during a handler run. */
function enqueuedTopics(): string[] {
  return H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
}

function insertedEdge(index: number): { profileId: string; identifierType: string; identifierHash: string } {
  return H.identityInsertMock.mock.calls[index]?.[1] as {
    profileId: string;
    identifierType: string;
    identifierHash: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.processed.clear();
  H.graph.clear();
  // Real inbox semantics: first delivery claims the id, every later one is refused.
  H.markProcessedMock.mockImplementation(async (messageId: string) => {
    if (H.processed.has(messageId)) return false;
    H.processed.add(messageId);
    return true;
  });
  H.enqueueMock.mockResolvedValue(undefined);
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.profileInsertMock.mockResolvedValue(undefined);
  H.profileUpdateMock.mockResolvedValue(true);
  H.profileFindByIdTxMock.mockImplementation(async (_tx: unknown, id: string) => makeProfile({ id }));
  H.identityInsertMock.mockResolvedValue(undefined);
  H.identityFindByHashTxMock.mockImplementation(async (_tx: unknown, hash: string) => H.graph.get(hash) ?? []);
});

describe("crm.contact.created — no match creates a golden profile", () => {
  it("creates the profile with crm lineage and hashed identifier edges", async () => {
    await handleCrmContactCreated(
      envelope({ contactId: CONTACT_ID, name: CONTACT_NAME, email: CONTACT_EMAIL, phone: CONTACT_PHONE, city: "Pune" }),
    );

    expect(H.profileInsertMock).toHaveBeenCalledOnce();
    const row = H.profileInsertMock.mock.calls[0]?.[1] as {
      id: string;
      profileType: string;
      attributes: Record<string, unknown>;
      sourceLineage: Array<{ source: string; sourceId: string; timestamp: string }>;
    };
    expect(row.profileType).toBe("individual");
    // Contact identifiers stay out of the unencrypted attribute bag.
    expect(row.attributes).toEqual({ name: CONTACT_NAME, city: "Pune" });
    expect(row.sourceLineage).toHaveLength(1);
    expect(row.sourceLineage[0]?.source).toBe("crm");
    expect(row.sourceLineage[0]?.sourceId).toBe(CONTACT_ID);
    expect(Date.parse(row.sourceLineage[0]?.timestamp ?? "")).not.toBeNaN();

    // externalId + email + phone, all hashed with the identity module's own scheme.
    expect(H.identityInsertMock).toHaveBeenCalledTimes(3);
    expect(insertedEdge(0)).toMatchObject({ identifierType: "externalId", identifierHash: CONTACT_HASH });
    expect(insertedEdge(1)).toMatchObject({ identifierType: "email", identifierHash: EMAIL_HASH });
    expect(insertedEdge(2)).toMatchObject({ identifierType: "phone", identifierHash: PHONE_HASH });
    for (const call of H.identityInsertMock.mock.calls) {
      expect((call[1] as { profileId: string }).profileId).toBe(row.id);
    }

    expect(enqueuedTopics()).toEqual(["cdp.profile.created", "audit.event.record"]);
    const created = H.enqueueMock.mock.calls[0]?.[1] as { payload: { profileId: string; attributeKeys: string[] } };
    expect(created.payload.profileId).toBe(row.id);
    expect(created.payload.attributeKeys).toEqual(["name", "city"]);
  });

  it("a payload with only contactId still produces a profile and one edge", async () => {
    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID }));
    const row = H.profileInsertMock.mock.calls[0]?.[1] as { attributes: Record<string, unknown> };
    expect(row.attributes).toEqual({});
    expect(H.identityInsertMock).toHaveBeenCalledOnce();
    expect(insertedEdge(0).identifierType).toBe("externalId");
  });

  it("invalidates the profile reads of the new profile after the commit", async () => {
    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID }));
    const profileId = (H.profileInsertMock.mock.calls[0]?.[1] as { id: string }).id;
    expect(H.cacheInvalidateMock.mock.calls.map((c) => c[0])).toEqual([
      `cdp:${TENANT}:profile:${profileId}`,
      `cdp:${TENANT}:profile_lineage:${profileId}`,
      `cdp:${TENANT}:profile_summary:${profileId}`,
    ]);
  });

  it("a non-uuid actorId degrades to the system actor instead of failing the stitch", async () => {
    await handleCrmContactCreated({ ...envelope({ contactId: CONTACT_ID }), actorId: "crm-worker" });
    const row = H.profileInsertMock.mock.calls[0]?.[1] as { createdBy: string; updatedBy: string };
    expect(row.createdBy).toBe(SYSTEM_ACTOR);
    expect(row.updatedBy).toBe(SYSTEM_ACTOR);
  });
});

describe("crm.contact.created — a match links instead of duplicating", () => {
  it("links to the profile that already holds the contact's email", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");

    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME, email: CONTACT_EMAIL }));

    // The whole point: no second golden profile for a person the CDP already knows.
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    // The email edge already exists (unique on tenant+type+hash), so only the contact id
    // is added as a new exact key.
    expect(H.identityInsertMock).toHaveBeenCalledOnce();
    expect(insertedEdge(0)).toMatchObject({
      profileId: PROFILE_ID,
      identifierType: "externalId",
      identifierHash: CONTACT_HASH,
    });

    expect(enqueuedTopics()).toEqual(["cdp.identity.resolved", "audit.event.record"]);
    const resolved = H.enqueueMock.mock.calls[0]?.[1] as {
      payload: { profileId: string; outcome: string; matchedOn: string[]; sourceId: string };
    };
    expect(resolved.payload).toEqual({
      profileId: PROFILE_ID,
      source: "crm",
      sourceId: CONTACT_ID,
      outcome: "linked",
      matchedOn: ["email"],
    });
  });

  it("stamps crm provenance and merges reported attributes onto the matched profile", async () => {
    seedEdge(PHONE_HASH, PROFILE_ID, "phone");
    H.profileFindByIdTxMock.mockResolvedValue(
      makeProfile({
        attributes: { language: "hi" },
        sourceLineage: [{ source: "web", sourceId: "sess-9", timestamp: "2020-01-01T00:00:00.000Z" }],
      }),
    );

    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME, phone: CONTACT_PHONE }));

    const [, id, tenantId, patch, version] = H.profileUpdateMock.mock.calls[0] as [
      unknown, string, string,
      { attributes: Record<string, unknown>; sourceLineage: Array<{ source: string }> },
      number,
    ];
    expect(id).toBe(PROFILE_ID);
    expect(tenantId).toBe(TENANT);
    expect(version).toBe(3);
    expect(patch.attributes).toEqual({ language: "hi", name: CONTACT_NAME });
    expect(patch.sourceLineage.map((e) => e.source)).toEqual(["web", "crm"]);
  });

  it("adds the identifiers the matched profile did not have yet", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");
    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID, email: CONTACT_EMAIL, phone: CONTACT_PHONE }));
    expect(H.identityInsertMock).toHaveBeenCalledTimes(2);
    expect(insertedEdge(0).identifierType).toBe("externalId");
    expect(insertedEdge(1)).toMatchObject({ identifierType: "phone", identifierHash: PHONE_HASH });
  });

  it("keeps the link when the provenance stamp loses an optimistic-lock race", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");
    H.profileUpdateMock.mockResolvedValue(false);

    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID, email: CONTACT_EMAIL }));

    // The resolution is the valuable part and it is recorded; the lineage stamp is
    // re-applied by the next crm.contact.updated.
    expect(H.identityInsertMock).toHaveBeenCalledOnce();
    expect(enqueuedTopics()).toEqual(["cdp.identity.resolved", "audit.event.record"]);
  });

  it("a contact split across two profiles is left for the steward, not guessed", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");
    seedEdge(PHONE_HASH, OTHER_PROFILE_ID, "phone");

    await handleCrmContactCreated(
      envelope({ contactId: CONTACT_ID, email: CONTACT_EMAIL, phone: CONTACT_PHONE, name: CONTACT_NAME }),
    );

    expect(H.profileInsertMock).not.toHaveBeenCalled();
    expect(H.identityInsertMock).not.toHaveBeenCalled();
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    expect(H.cacheInvalidateMock).not.toHaveBeenCalled();
  });

  it("an edge pointing at a merged profile is stale — a fresh profile is created", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");
    H.profileFindByIdTxMock.mockResolvedValue(makeProfile({ profileType: "merged" }));

    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID, email: CONTACT_EMAIL }));

    expect(H.profileInsertMock).toHaveBeenCalledOnce();
    expect(enqueuedTopics()).toEqual(["cdp.profile.created", "audit.event.record"]);
    // The pre-existing email edge is not duplicated onto the new profile.
    expect(H.identityInsertMock).toHaveBeenCalledTimes(2);
  });

  it("an already-stitched contact is a no-op, so a CRM replay is safe", async () => {
    seedEdge(CONTACT_HASH, PROFILE_ID, "externalId");
    await handleCrmContactCreated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME }));
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    expect(H.identityInsertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });
});

describe("crm.contact.created — redelivery and malformed payloads", () => {
  const payload = { contactId: CONTACT_ID, name: CONTACT_NAME, email: CONTACT_EMAIL };

  it("the same messageId twice creates exactly one profile", async () => {
    await handleCrmContactCreated(envelope(payload));
    await handleCrmContactCreated(envelope(payload));
    expect(H.markProcessedMock).toHaveBeenCalledTimes(2);
    expect(H.profileInsertMock).toHaveBeenCalledOnce();
    expect(H.identityInsertMock).toHaveBeenCalledTimes(2);
    // One create's worth of outbox rows, not two.
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("the same messageId twice links exactly once", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");
    await handleCrmContactCreated(envelope(payload));
    await handleCrmContactCreated(envelope(payload));
    expect(H.identityInsertMock).toHaveBeenCalledOnce();
    expect(H.profileUpdateMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("a different messageId for the same contact re-resolves rather than duplicating", async () => {
    await handleCrmContactCreated(envelope(payload, "10000000-0000-4000-8000-00000000000a"));
    const created = (H.profileInsertMock.mock.calls[0]?.[1] as { id: string }).id;
    // Second delivery sees the edges the first one wrote.
    seedEdge(CONTACT_HASH, created, "externalId");
    await handleCrmContactCreated(envelope(payload, "10000000-0000-4000-8000-00000000000b"));
    expect(H.profileInsertMock).toHaveBeenCalledOnce();
  });

  it("the bulk-import shape crm publishes on the same topic is skipped, not thrown", async () => {
    await expect(
      handleCrmContactCreated(envelope({ batchId: "b-1", total: 10, inserted: 9, skipped: 1, errored: 0 })),
    ).resolves.toBeUndefined();
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    // Not claimed: a payload this consumer cannot act on must stay replayable.
    expect(H.markProcessedMock).not.toHaveBeenCalled();
  });

  it("a malformed email is skipped rather than stored unhashed", async () => {
    await expect(
      handleCrmContactCreated(envelope({ contactId: CONTACT_ID, email: "not-an-email" })),
    ).resolves.toBeUndefined();
    expect(H.profileInsertMock).not.toHaveBeenCalled();
  });
});

describe("crm.contact.updated", () => {
  beforeEach(() => {
    seedEdge(CONTACT_HASH, PROFILE_ID, "externalId");
  });

  it("merges reported attributes and re-stamps the crm lineage entry", async () => {
    H.profileFindByIdTxMock.mockResolvedValue(
      makeProfile({
        attributes: { name: "Old Name", language: "hi" },
        sourceLineage: [{ source: "crm", sourceId: CONTACT_ID, timestamp: "2020-01-01T00:00:00.000Z" }],
      }),
    );

    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME, city: "Pune" }));

    const [, id, tenantId, patch, version] = H.profileUpdateMock.mock.calls[0] as [
      unknown, string, string,
      { attributes: Record<string, unknown>; sourceLineage: Array<{ source: string; timestamp: string }> },
      number,
    ];
    expect(id).toBe(PROFILE_ID);
    expect(tenantId).toBe(TENANT);
    expect(version).toBe(3);
    // Absent fields mean "not reported", so existing attributes survive.
    expect(patch.attributes).toEqual({ name: CONTACT_NAME, language: "hi", city: "Pune" });
    // Replaced in place, not appended — lineage must not grow per update.
    expect(patch.sourceLineage).toHaveLength(1);
    expect(patch.sourceLineage[0]?.timestamp).not.toBe("2020-01-01T00:00:00.000Z");
    expect(enqueuedTopics()).toEqual(["cdp.profile.updated", "audit.event.record"]);
  });

  it("the same messageId twice updates exactly once", async () => {
    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME }));
    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME }));
    expect(H.profileUpdateMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("a contactId-only payload still refreshes provenance", async () => {
    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID }));
    expect(H.profileUpdateMock).toHaveBeenCalledOnce();
    const patch = H.profileUpdateMock.mock.calls[0]?.[3] as {
      attributes: Record<string, unknown>;
      sourceLineage: Array<{ source: string }>;
    };
    expect(patch.attributes).toEqual({});
    expect(patch.sourceLineage[0]?.source).toBe("crm");
    const event = H.enqueueMock.mock.calls[0]?.[1] as { payload: { changedKeys: string[] } };
    expect(event.payload.changedKeys).toEqual([]);
  });

  it("invalidates the profile, lineage and summary reads after the commit", async () => {
    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME }));
    expect(H.cacheInvalidateMock.mock.calls.map((c) => c[0])).toEqual([
      `cdp:${TENANT}:profile:${PROFILE_ID}`,
      `cdp:${TENANT}:profile_lineage:${PROFILE_ID}`,
      `cdp:${TENANT}:profile_summary:${PROFILE_ID}`,
    ]);
  });

  it("an optimistic-lock miss emits nothing and does not throw", async () => {
    H.profileUpdateMock.mockResolvedValue(false);
    await expect(
      handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME })),
    ).resolves.toBeUndefined();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    expect(H.cacheInvalidateMock).not.toHaveBeenCalled();
  });

  it("a profile that has since been merged away is skipped", async () => {
    H.profileFindByIdTxMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME }));
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });

  it("a malformed foreign payload is skipped without throwing", async () => {
    await expect(handleCrmContactUpdated(envelope({ contactId: 42 }))).resolves.toBeUndefined();
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
  });
});

describe("crm.contact.updated — no matching profile is a silent no-op", () => {
  it("writes nothing, emits nothing and does not throw", async () => {
    // Empty graph: this contact was never stitched.
    await expect(
      handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME, email: CONTACT_EMAIL })),
    ).resolves.toBeUndefined();
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    expect(H.cacheInvalidateMock).not.toHaveBeenCalled();
  });

  it("a profile that vanished between the edge read and the profile read is a no-op", async () => {
    seedEdge(CONTACT_HASH, PROFILE_ID, "externalId");
    H.profileFindByIdTxMock.mockResolvedValue(null);
    await handleCrmContactUpdated(envelope({ contactId: CONTACT_ID, name: CONTACT_NAME }));
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });
});

describe("PII never reaches an emitted event payload", () => {
  const full = { contactId: CONTACT_ID, name: CONTACT_NAME, email: CONTACT_EMAIL, phone: CONTACT_PHONE, city: "Pune" };

  /** Every value the outbox saw, for a substring search over emitted payloads. */
  function emitted(): string {
    return JSON.stringify(H.enqueueMock.mock.calls);
  }

  it("create: no name, email or phone on cdp.profile.created or its audit row", async () => {
    await handleCrmContactCreated(envelope(full));
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
    expect(emitted()).not.toContain(CONTACT_NAME);
    expect(emitted()).not.toContain(CONTACT_EMAIL);
    expect(emitted()).not.toContain(CONTACT_PHONE);
    // The hashes are not in the events either — only ids and key/type names.
    expect(emitted()).not.toContain(EMAIL_HASH);
    expect(emitted()).toContain(CONTACT_ID);
  });

  it("link: no name, email or phone on cdp.identity.resolved or its audit row", async () => {
    seedEdge(EMAIL_HASH, PROFILE_ID, "email");
    await handleCrmContactCreated(envelope(full));
    expect(emitted()).not.toContain(CONTACT_NAME);
    expect(emitted()).not.toContain(CONTACT_EMAIL);
    expect(emitted()).not.toContain(CONTACT_PHONE);
  });

  it("update: no name, email or phone on cdp.profile.updated or its audit row", async () => {
    seedEdge(CONTACT_HASH, PROFILE_ID, "externalId");
    await handleCrmContactUpdated(envelope(full));
    expect(emitted()).not.toContain(CONTACT_NAME);
    expect(emitted()).not.toContain(CONTACT_EMAIL);
    expect(emitted()).not.toContain(CONTACT_PHONE);
    // Key names are safe and are what a downstream needs to know changed.
    expect(emitted()).toContain("changedKeys");
  });
});
