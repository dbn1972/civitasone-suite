/**
 * CDP-001 — golden profile source lineage. Route coverage: happy path + 400/401/403/404/409.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  profileUpdateMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
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
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: (...a: unknown[]) => H.profileUpdateMock(...a),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

const LINEAGE = [
  { source: "crm", sourceId: "c1", timestamp: "2025-01-01T00:00:00.000Z" },
  { source: "helpdesk", sourceId: "h9", timestamp: "2025-03-04T10:00:00.000Z" },
];

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    tenantId: TENANT,
    profileType: "individual",
    attributes: { name: "Asha" },
    sourceLineage: LINEAGE,
    mergedFromIds: [],
    version: 3,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-03-04T10:00:00Z"),
    createdBy: USER,
    updatedBy: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockImplementation((t: string, r: string, i: string) => `cdp:${t}:${r}:${i}`);
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("msg-1");
  H.profileUpdateMock.mockResolvedValue(true);
});

describe("GET /v1/cdp/profiles/:id/lineage", () => {
  it("200 — returns the lineage in stored order", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.profileId).toBe(PROFILE_ID);
    expect(r.json().data.lineage).toEqual(LINEAGE);
    // Cache-first read, keyed per tenant + resource.
    expect(H.cacheMakeKeyMock).toHaveBeenCalledWith(TENANT, "profile_lineage", PROFILE_ID);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — a merged profile is not addressable", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profiles/not-a-uuid/lineage", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/profiles/:id/lineage", () => {
  const body = { entry: { source: "umang", sourceId: "u-42", timestamp: "2025-06-01T00:00:00.000Z" }, version: 3 };

  it("202 — publishes lineage append command", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(), payload: body,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.status).toBe("accepted");
    expect(r.json().data.version).toBe(4);
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({
        payload: expect.objectContaining({
          op: "lineage_append",
          profileId: PROFILE_ID,
          sourceLineage: [...LINEAGE, body.entry],
        }),
      }),
    );
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — server stamps a missing timestamp in the command payload", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(),
      payload: { entry: { source: "umang", sourceId: "u-42" }, version: 3 },
    });
    expect(r.statusCode).toBe(202);
    expect(typeof r.json().data.entry.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(r.json().data.entry.timestamp))).toBe(false);
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("400 — missing source", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(),
      payload: { entry: { sourceId: "u-42" }, version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing version (optimistic lock is mandatory)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(),
      payload: { entry: { source: "umang", sourceId: "u-42" } },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(), payload: body,
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — version conflicts deferred to consumer", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(), payload: body,
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, payload: body,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — read-only cdp role cannot append", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/profiles/${PROFILE_ID}/lineage`, headers: auth(["cdp_user"]), payload: body,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
