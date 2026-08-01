/**
 * CDP service route-level tests — profiles, identity, events, segments, steward.
 * Happy paths + 400/401/403/404/409/422.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const PROFILE_ID_2 = "bbbbbbbb-2222-4000-8000-000000000002";
const SEGMENT_ID = "cccccccc-1111-4000-8000-000000000001";
const MERGE_REQ_ID = "dddddddd-1111-4000-8000-000000000001";
const IDENTITY_ID = "eeeeeeee-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  profileListMock: vi.fn(),
  profileInsertMock: vi.fn(),
  profileUpdateMock: vi.fn(),
  profileMarkMergedMock: vi.fn(),
  profileFindByIdsMock: vi.fn(),
  identityFindByHashMock: vi.fn(),
  identityFindByProfileMock: vi.fn(),
  identityFindByIdMock: vi.fn(),
  identityInsertMock: vi.fn(),
  identityDeleteMock: vi.fn(),
  identityReassignMock: vi.fn(),
  eventsInsertMock: vi.fn(),
  eventsInsertBatchMock: vi.fn(),
  eventsListByProfileMock: vi.fn(),
  eventsTimelineMock: vi.fn(),
  segmentsFindByIdMock: vi.fn(),
  segmentsListMock: vi.fn(),
  segmentsInsertMock: vi.fn(),
  segmentsUpdateMock: vi.fn(),
  segmentsSoftDeleteMock: vi.fn(),
  segmentsEvaluateMock: vi.fn(),
  membershipListMock: vi.fn(),
  membershipCountMock: vi.fn(),
  stewardFindByIdMock: vi.fn(),
  stewardListMock: vi.fn(),
  stewardInsertMock: vi.fn(),
  stewardDecideMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.profileListMock(...a),
  insert: (...a: unknown[]) => H.profileInsertMock(...a),
  update: (...a: unknown[]) => H.profileUpdateMock(...a),
  markMerged: (...a: unknown[]) => H.profileMarkMergedMock(...a),
  findByIds: (...a: unknown[]) => H.profileFindByIdsMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/repo.js", () => ({
  findByHash: (...a: unknown[]) => H.identityFindByHashMock(...a),
  findByProfileId: (...a: unknown[]) => H.identityFindByProfileMock(...a),
  findById: (...a: unknown[]) => H.identityFindByIdMock(...a),
  insert: (...a: unknown[]) => H.identityInsertMock(...a),
  deleteById: (...a: unknown[]) => H.identityDeleteMock(...a),
  reassignProfile: (...a: unknown[]) => H.identityReassignMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/events/repo.js", () => ({
  insert: (...a: unknown[]) => H.eventsInsertMock(...a),
  insertBatch: (...a: unknown[]) => H.eventsInsertBatchMock(...a),
  listByProfile: (...a: unknown[]) => H.eventsListByProfileMock(...a),
  getTimeline: (...a: unknown[]) => H.eventsTimelineMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/segments/repo.js", () => ({
  findById: (...a: unknown[]) => H.segmentsFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.segmentsListMock(...a),
  insert: (...a: unknown[]) => H.segmentsInsertMock(...a),
  update: (...a: unknown[]) => H.segmentsUpdateMock(...a),
  softDelete: (...a: unknown[]) => H.segmentsSoftDeleteMock(...a),
  evaluateMembers: (...a: unknown[]) => H.segmentsEvaluateMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

// CDP-005 added materialised membership behind GET /segments/:id/members. With no
// persisted rows the route falls back to live criteria evaluation, which is what the
// member assertions below exercise.
vi.mock("../src/modules/segments/membership-repo.js", () => ({
  listMembers: (...a: unknown[]) => H.membershipListMock(...a),
  countMembers: (...a: unknown[]) => H.membershipCountMock(...a),
  countSegmentsForProfile: vi.fn(async () => 0),
  recompute: vi.fn(async () => 0),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/steward/repo.js", () => ({
  findById: (...a: unknown[]) => H.stewardFindByIdMock(...a),
  listByStatus: (...a: unknown[]) => H.stewardListMock(...a),
  insert: (...a: unknown[]) => H.stewardInsertMock(...a),
  decide: (...a: unknown[]) => H.stewardDecideMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["cdp_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["cdp_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID, tenantId: TENANT, profileType: "individual",
    attributes: { name: "Rajesh Kumar", email: "raj@example.com" },
    sourceLineage: [{ source: "crm", sourceId: "c1", timestamp: "2025-01-01T00:00:00Z" }],
    mergedFromIds: [], version: 1,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: SEGMENT_ID, tenantId: TENANT, name: "Delhi Users",
    description: "Users from Delhi", segmentType: "dynamic",
    criteria: { conditions: [{ field: "attributes.city", operator: "eq", value: "Delhi" }], logic: "and" },
    status: "active", memberCount: 42, isArchived: false, version: 1,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.profileInsertMock.mockResolvedValue(undefined);
  H.profileUpdateMock.mockResolvedValue(true);
  H.profileMarkMergedMock.mockResolvedValue(undefined);
  H.profileFindByIdsMock.mockResolvedValue([]);
  H.identityInsertMock.mockResolvedValue(undefined);
  H.identityDeleteMock.mockResolvedValue(true);
  H.identityReassignMock.mockResolvedValue(undefined);
  H.eventsInsertMock.mockResolvedValue(undefined);
  H.eventsInsertBatchMock.mockResolvedValue(undefined);
  H.segmentsInsertMock.mockResolvedValue(undefined);
  H.segmentsUpdateMock.mockResolvedValue(true);
  H.segmentsSoftDeleteMock.mockResolvedValue(true);
  H.membershipListMock.mockResolvedValue({ rows: [], total: 0 });
  H.membershipCountMock.mockResolvedValue(0);
  H.stewardInsertMock.mockResolvedValue(undefined);
  H.stewardDecideMock.mockResolvedValue(true);
});

// ── PROFILES ──────────────────────────────────────────────────────────────────

describe("POST /v1/cdp/profiles (create)", () => {
  it("201 — creates a golden profile", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles",
      headers: auth(), payload: { profileType: "individual", attributes: { name: "Test" } },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.profileType).toBe("individual");
    expect(H.profileInsertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles",
      payload: { profileType: "individual", attributes: {} },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles",
      headers: auth(USER, ["viewer"]),
      payload: { profileType: "individual", attributes: {} },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/profiles (list)", () => {
  it("200 — returns paginated list", async () => {
    H.profileListMock.mockResolvedValue({ rows: [makeProfile()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/profiles?limit=10&offset=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profiles" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/cdp/profiles/:id (get single)", () => {
  it("200 — returns the profile", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(PROFILE_ID);
    await app.close();
  });

  it("404 — profile not found", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — merged profile returns not found", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});


// ── PATCH /v1/cdp/profiles/:id (update) ───────────────────────────────────────

describe("PATCH /v1/cdp/profiles/:id (update)", () => {
  it("200 — updates profile attributes", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.profileUpdateMock.mockResolvedValue(true);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(),
      payload: { attributes: { city: "Mumbai" }, version: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.updated).toBe(true);
    expect(r.json().data.version).toBe(2);
    expect(H.profileUpdateMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — profile not found", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(),
      payload: { attributes: { city: "Mumbai" }, version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.profileUpdateMock.mockImplementation(async () => {
      throw Object.assign(new Error("profile has been modified; retry with current version"), { statusCode: 409, code: "VERSION_CONFLICT" });
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(),
      payload: { attributes: { city: "Mumbai" }, version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      payload: { attributes: { city: "Mumbai" }, version: 1 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/profiles/${PROFILE_ID}`,
      headers: auth(USER, ["viewer"]),
      payload: { attributes: { city: "Mumbai" }, version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/cdp/profiles/merge ───────────────────────────────────────────────

describe("POST /v1/cdp/profiles/merge", () => {
  it("200 — merges two profiles", async () => {
    H.profileFindByIdMock.mockImplementation(async (id: string) => {
      if (id === PROFILE_ID) return makeProfile();
      if (id === PROFILE_ID_2) return makeProfile({ id: PROFILE_ID_2 });
      return null;
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      headers: auth(),
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID_2 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("merged");
    expect(H.profileMarkMergedMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — winner not found", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      headers: auth(),
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID_2 },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toContain("winner");
    await app.close();
  });

  it("404 — loser not found", async () => {
    H.profileFindByIdMock.mockImplementation(async (id: string) => {
      if (id === PROFILE_ID) return makeProfile();
      return null;
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      headers: auth(),
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID_2 },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toContain("loser");
    await app.close();
  });

  it("422 — same profile id", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      headers: auth(),
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — different profile types", async () => {
    H.profileFindByIdMock.mockImplementation(async (id: string) => {
      if (id === PROFILE_ID) return makeProfile({ profileType: "individual" });
      if (id === PROFILE_ID_2) return makeProfile({ id: PROFILE_ID_2, profileType: "organization" });
      return null;
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      headers: auth(),
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID_2 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID_2 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (non-admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/profiles/merge",
      headers: auth(USER, ["cdp_user"]),
      payload: { winnerId: PROFILE_ID, loserId: PROFILE_ID_2 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/cdp/profiles/:id/timeline ─────────────────────────────────────────

describe("GET /v1/cdp/profiles/:id/timeline", () => {
  it("200 — returns timeline events", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.eventsTimelineMock.mockResolvedValue({
      rows: [{ id: "ev-1", eventType: "page_view", payload: {}, occurredAt: new Date() }],
      total: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/timeline`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("404 — profile not found", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/timeline`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/timeline`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ── POST /v1/cdp/resolve (identity resolution) ───────────────────────────────

describe("POST /v1/cdp/resolve", () => {
  const resolvePayload = {
    identifiers: [{ type: "email", value: "raj@example.com" }],
    attributes: { name: "Raj" },
  };

  it("201 — creates new profile when no match", async () => {
    H.identityFindByHashMock.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      headers: auth(),
      payload: resolvePayload,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("created");
    expect(r.json().data.profileId).toBeDefined();
    expect(r.json().data.confidence).toBe(1.0);
    expect(H.profileInsertMock).toHaveBeenCalledOnce();
    expect(H.identityInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — returns matched profile", async () => {
    H.identityFindByHashMock.mockResolvedValue([{ profileId: PROFILE_ID }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      headers: auth(),
      payload: resolvePayload,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("matched");
    expect(r.json().data.profileId).toBe(PROFILE_ID);
    expect(r.json().data.matched).toBe(true);
    await app.close();
  });

  it("200 — ambiguous match routes to steward queue", async () => {
    H.identityFindByHashMock.mockResolvedValue([
      { profileId: PROFILE_ID },
      { profileId: PROFILE_ID_2 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      headers: auth(),
      payload: resolvePayload,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("ambiguous");
    expect(r.json().data.matched).toBe(false);
    expect(r.json().data.candidates).toHaveLength(2);
    expect(H.stewardInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — not_found when createIfMissing=false", async () => {
    H.identityFindByHashMock.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      headers: auth(),
      payload: { ...resolvePayload, createIfMissing: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("not_found");
    expect(r.json().data.profileId).toBeNull();
    expect(H.profileInsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — invalid body (missing identifiers)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      headers: auth(),
      payload: { identifiers: [] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      payload: resolvePayload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/resolve",
      headers: auth(USER, ["viewer"]),
      payload: resolvePayload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/cdp/identity/:profileId ───────────────────────────────────────────

describe("GET /v1/cdp/identity/:profileId", () => {
  it("200 — returns identifiers for a profile", async () => {
    H.identityFindByProfileMock.mockResolvedValue([
      { id: IDENTITY_ID, profileId: PROFILE_ID, identifierType: "email", identifierHash: "abc123" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/identity/${PROFILE_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].identifierType).toBe("email");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/identity/${PROFILE_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ── DELETE /v1/cdp/identity/:id ───────────────────────────────────────────────

describe("DELETE /v1/cdp/identity/:id", () => {
  it("204 — deletes identity link", async () => {
    H.identityFindByIdMock.mockResolvedValue({
      id: IDENTITY_ID, profileId: PROFILE_ID, identifierType: "email",
    });
    H.identityDeleteMock.mockResolvedValue(true);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/identity/${IDENTITY_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(204);
    expect(H.identityDeleteMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — identity link not found", async () => {
    H.identityFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/identity/${IDENTITY_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/identity/${IDENTITY_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (non-admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/identity/${IDENTITY_ID}`,
      headers: auth(USER, ["cdp_user"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/cdp/events (ingest) ─────────────────────────────────────────────

describe("POST /v1/cdp/events", () => {
  const eventPayload = {
    profileId: PROFILE_ID,
    eventType: "page_view",
    payload: { url: "/home" },
    occurredAt: "2025-06-01T10:00:00Z",
  };

  it("201 — ingests event successfully", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events",
      headers: auth(),
      payload: eventPayload,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("ingested");
    expect(r.json().data.profileId).toBe(PROFILE_ID);
    expect(H.eventsInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — profile not found", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events",
      headers: auth(),
      payload: eventPayload,
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — consent denied", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({
      attributes: { consent: { marketing: false } },
    }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events",
      headers: auth(),
      payload: { ...eventPayload, eventType: "marketing.campaign_sent" },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("400 — invalid body (missing eventType)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events",
      headers: auth(),
      payload: { profileId: PROFILE_ID, payload: {}, occurredAt: "2025-06-01T10:00:00Z" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events",
      payload: eventPayload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ── POST /v1/cdp/events/batch ─────────────────────────────────────────────────

describe("POST /v1/cdp/events/batch", () => {
  it("201 — batch ingest succeeds", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/batch",
      headers: auth(),
      payload: {
        events: [
          { profileId: PROFILE_ID, eventType: "page_view", payload: {}, occurredAt: "2025-06-01T10:00:00Z" },
          { profileId: PROFILE_ID, eventType: "click", payload: {}, occurredAt: "2025-06-01T10:01:00Z" },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.ingested).toBe(2);
    expect(r.json().data.rejected).toBe(0);
    await app.close();
  });

  it("422 — all events rejected", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/batch",
      headers: auth(),
      payload: {
        events: [
          { profileId: PROFILE_ID, eventType: "page_view", payload: {}, occurredAt: "2025-06-01T10:00:00Z" },
        ],
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().data.ingested).toBe(0);
    expect(r.json().data.rejected).toBe(1);
    await app.close();
  });

  it("400 — invalid body (empty events array)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/batch",
      headers: auth(),
      payload: { events: [] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

// ── GET /v1/cdp/profiles/:id/events ───────────────────────────────────────────

describe("GET /v1/cdp/profiles/:id/events", () => {
  it("200 — returns paginated events", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.eventsListByProfileMock.mockResolvedValue({
      rows: [{ id: "ev-1", eventType: "page_view", payload: {}, occurredAt: new Date() }],
      total: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/events`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("404 — profile not found", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/events`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ── SEGMENTS CRUD ─────────────────────────────────────────────────────────────

describe("GET /v1/cdp/segments (list)", () => {
  it("200 — returns paginated segments", async () => {
    H.segmentsListMock.mockResolvedValue({ rows: [makeSegment()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/segments?limit=10&offset=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/segments" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/cdp/segments/:id (get single)", () => {
  it("200 — returns segment with member count", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentsEvaluateMock.mockResolvedValue({ profileIds: [PROFILE_ID], total: 42 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.memberCount).toBe(42);
    await app.close();
  });

  it("404 — segment not found", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /v1/cdp/segments (create)", () => {
  it("201 — creates a segment", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/segments",
      headers: auth(),
      payload: { name: "Delhi Users", segmentType: "dynamic", criteria: {} },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.name).toBe("Delhi Users");
    expect(r.json().data.status).toBe("active");
    expect(H.segmentsInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("400 — invalid criteria format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/segments",
      headers: auth(),
      payload: {
        name: "Bad Segment", segmentType: "dynamic",
        criteria: { conditions: "not-an-array", logic: "invalid" },
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/segments",
      payload: { name: "Test", criteria: {} },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (non-admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/segments",
      headers: auth(USER, ["cdp_user"]),
      payload: { name: "Test", criteria: {} },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/cdp/segments/:id (update)", () => {
  it("200 — updates segment", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentsUpdateMock.mockResolvedValue(true);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
      payload: { name: "Updated Segment", version: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.updated).toBe(true);
    await app.close();
  });

  it("404 — segment not found", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
      payload: { name: "Updated", version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentsUpdateMock.mockImplementation(async () => {
      throw Object.assign(new Error("segment has been modified; retry with current version"), { statusCode: 409, code: "VERSION_CONFLICT" });
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
      payload: { name: "Conflict", version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(USER, ["cdp_user"]),
      payload: { name: "Nope", version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("DELETE /v1/cdp/segments/:id", () => {
  it("204 — soft deletes segment", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentsSoftDeleteMock.mockResolvedValue(true);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(204);
    expect(H.segmentsSoftDeleteMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — segment not found", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — version conflict on delete", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentsSoftDeleteMock.mockImplementation(async () => {
      throw Object.assign(new Error("segment has been modified; retry with current version"), { statusCode: 409, code: "VERSION_CONFLICT" });
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/segments/${SEGMENT_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/cdp/segments/${SEGMENT_ID}`,
      headers: auth(USER, ["cdp_user"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/cdp/segments/:id/members ──────────────────────────────────────────

describe("GET /v1/cdp/segments/:id/members", () => {
  it("200 — returns member profiles", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentsEvaluateMock.mockResolvedValue({ profileIds: [PROFILE_ID], total: 1 });
    H.profileFindByIdsMock.mockResolvedValue([makeProfile()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/segments/${SEGMENT_ID}/members`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("404 — segment not found", async () => {
    H.segmentsFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/segments/${SEGMENT_ID}/members`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ── STEWARD ───────────────────────────────────────────────────────────────────

describe("GET /v1/cdp/steward/queue", () => {
  it("200 — lists pending merge requests", async () => {
    H.stewardListMock.mockResolvedValue({
      rows: [{
        id: MERGE_REQ_ID, sourceProfileId: PROFILE_ID, targetProfileId: PROFILE_ID_2,
        confidence: "0.75", matchReason: "email match", status: "pending",
        createdAt: new Date(), updatedAt: new Date(),
      }],
      total: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/steward/queue",
      headers: auth(USER, ["cdp_steward"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/steward/queue" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/steward/queue",
      headers: auth(USER, ["cdp_user"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/steward/decide", () => {
  it("200 — approve triggers merge", async () => {
    H.stewardFindByIdMock.mockResolvedValue({
      id: MERGE_REQ_ID, sourceProfileId: PROFILE_ID, targetProfileId: PROFILE_ID_2,
      status: "pending", tenantId: TENANT,
    });
    H.stewardDecideMock.mockResolvedValue(true);
    H.profileFindByIdMock.mockImplementation(async (id: string) => {
      if (id === PROFILE_ID) return makeProfile();
      if (id === PROFILE_ID_2) return makeProfile({ id: PROFILE_ID_2 });
      return null;
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/steward/decide",
      headers: auth(USER, ["cdp_steward"]),
      payload: { mergeRequestId: MERGE_REQ_ID, decision: "approve" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.decision).toBe("approved");
    expect(H.profileMarkMergedMock).toHaveBeenCalledOnce();
    expect(H.identityReassignMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — reject does not trigger merge", async () => {
    H.stewardFindByIdMock.mockResolvedValue({
      id: MERGE_REQ_ID, sourceProfileId: PROFILE_ID, targetProfileId: PROFILE_ID_2,
      status: "pending", tenantId: TENANT,
    });
    H.stewardDecideMock.mockResolvedValue(true);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/steward/decide",
      headers: auth(USER, ["cdp_steward"]),
      payload: { mergeRequestId: MERGE_REQ_ID, decision: "reject" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.decision).toBe("rejected");
    expect(H.profileMarkMergedMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 — merge request not found", async () => {
    H.stewardFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/steward/decide",
      headers: auth(USER, ["cdp_steward"]),
      payload: { mergeRequestId: MERGE_REQ_ID, decision: "approve" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — already decided", async () => {
    H.stewardFindByIdMock.mockResolvedValue({
      id: MERGE_REQ_ID, sourceProfileId: PROFILE_ID, targetProfileId: PROFILE_ID_2,
      status: "approved", tenantId: TENANT,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/steward/decide",
      headers: auth(USER, ["cdp_steward"]),
      payload: { mergeRequestId: MERGE_REQ_ID, decision: "approve" },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/steward/decide",
      payload: { mergeRequestId: MERGE_REQ_ID, decision: "approve" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/steward/decide",
      headers: auth(USER, ["cdp_user"]),
      payload: { mergeRequestId: MERGE_REQ_ID, decision: "approve" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
