/**
 * CDP-005 — dynamic segmentation: recompute + paginated member reads.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const SEGMENT_ID = "cccccccc-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  segmentFindByIdMock: vi.fn(),
  segmentUpdateCountMock: vi.fn(),
  segmentEvaluateMock: vi.fn(),
  recomputeMock: vi.fn(),
  listMembersMock: vi.fn(),
  countMembersMock: vi.fn(),
  profileFindByIdsMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (t: string, r: string, i: string) => `cdp:${t}:${r}:${i}`,
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/segments/repo.js", () => ({
  findById: (...a: unknown[]) => H.segmentFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: vi.fn(async () => true),
  softDelete: vi.fn(async () => true),
  evaluateMembers: (...a: unknown[]) => H.segmentEvaluateMock(...a),
  updateMemberCount: (...a: unknown[]) => H.segmentUpdateCountMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/segments/membership-repo.js", () => ({
  listMembers: (...a: unknown[]) => H.listMembersMock(...a),
  countMembers: (...a: unknown[]) => H.countMembersMock(...a),
  countSegmentsForProfile: vi.fn(async () => 0),
  recompute: (...a: unknown[]) => H.recomputeMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: vi.fn(async () => null),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: vi.fn(),
  markMerged: vi.fn(),
  findByIds: (...a: unknown[]) => H.profileFindByIdsMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: SEGMENT_ID,
    tenantId: TENANT,
    name: "Pune residents",
    description: null,
    segmentType: "dynamic",
    criteria: { conditions: [{ field: "attributes.city", operator: "eq", value: "Pune" }], logic: "and" },
    status: "active",
    memberCount: 0,
    isArchived: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    ...overrides,
  };
}

function makeProfile(id = PROFILE_ID) {
  return {
    id, tenantId: TENANT, profileType: "individual", attributes: { city: "Pune" },
    sourceLineage: [], mergedFromIds: [], version: 1,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("m");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.recomputeMock.mockResolvedValue(7);
  H.segmentUpdateCountMock.mockResolvedValue(undefined);
  H.listMembersMock.mockResolvedValue({ rows: [], total: 0 });
  H.countMembersMock.mockResolvedValue(0);
  H.profileFindByIdsMock.mockResolvedValue([]);
  H.segmentEvaluateMock.mockResolvedValue({ profileIds: [], total: 0 });
});

describe("POST /v1/cdp/segments/:id/compute", () => {
  const url = `/v1/cdp/segments/${SEGMENT_ID}/compute`;

  it("202 — publishes segment compute command without writing", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth() });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.status).toBe("accepted");
    expect(r.json().data.segmentId).toBe(SEGMENT_ID);
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({
        payload: expect.objectContaining({ op: "segment_compute", segmentId: SEGMENT_ID }),
      }),
    );
    expect(H.recomputeMock).not.toHaveBeenCalled();
    expect(H.segmentUpdateCountMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    expect(H.cacheInvalidateMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — empty-audience criteria still enqueue compute", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth() });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("400 — non-uuid segment id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/cdp/segments/nope/compute", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown segment", async () => {
    H.segmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — stored criteria cannot be evaluated", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment({ criteria: { conditions: "nope", logic: "and" } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth() });
    expect(r.statusCode).toBe(422);
    expect(H.recomputeMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot trigger a recompute", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/segments/:id/members", () => {
  const url = `/v1/cdp/segments/${SEGMENT_ID}/members`;

  it("200 — serves the materialised membership when one exists", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.listMembersMock.mockResolvedValue({
      rows: [{ id: "m1", tenantId: TENANT, segmentId: SEGMENT_ID, profileId: PROFILE_ID, computedAt: new Date(), isRealtime: false, version: 1 }],
      total: 1,
    });
    H.profileFindByIdsMock.mockResolvedValue([makeProfile()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    // Live evaluation is not consulted once membership is materialised.
    expect(H.segmentEvaluateMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("200 — falls back to live criteria evaluation before the first compute", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.segmentEvaluateMock.mockResolvedValue({ profileIds: [PROFILE_ID], total: 1 });
    H.profileFindByIdsMock.mockResolvedValue([makeProfile()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta.total).toBe(1);
    expect(H.segmentEvaluateMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — empty envelope for a segment with no criteria and no membership", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment({ criteria: {} }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("200 — page number is derived from the offset", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.listMembersMock.mockResolvedValue({ rows: [], total: 5 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=2&offset=4`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta).toEqual({ page: 3, pageSize: 2, total: 5 });
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=201`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown segment", async () => {
    H.segmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
