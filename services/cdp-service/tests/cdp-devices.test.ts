/**
 * CDP-007 — cross-device identity graph (tokenised).
 * Also asserts the privacy invariant: the raw token never leaves the service.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { toView } from "../src/modules/identity/device-repo.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const DEVICE_ID = "dddddddd-1111-4000-8000-000000000001";
const TOKEN = "tok_9f2c4b7d61e8a350";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  findByTokenMock: vi.fn(),
  listByProfileMock: vi.fn(),
  insertMock: vi.fn(),
  relinkMock: vi.fn(),
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

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: vi.fn(),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/identity/device-repo.js", async (orig) => {
  const actual = await orig<typeof import("../src/modules/identity/device-repo.js")>();
  return {
    ...actual,
    findByToken: (...a: unknown[]) => H.findByTokenMock(...a),
    listByProfile: (...a: unknown[]) => H.listByProfileMock(...a),
    countByProfile: vi.fn(async () => 0),
    insert: (...a: unknown[]) => H.insertMock(...a),
    relink: (...a: unknown[]) => H.relinkMock(...a),
  };
});

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_user"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID, tenantId: TENANT, profileType: "individual", attributes: {},
    sourceLineage: [], mergedFromIds: [], version: 1,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID, tenantId: TENANT, profileId: PROFILE_ID, deviceToken: TOKEN,
    deviceType: "android", lastSeenAt: new Date("2025-05-01T00:00:00Z"), version: 2,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("m");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.insertMock.mockResolvedValue(undefined);
  H.relinkMock.mockResolvedValue(true);
  H.findByTokenMock.mockResolvedValue(null);
  H.listByProfileMock.mockResolvedValue({ rows: [], total: 0 });
  H.profileFindByIdMock.mockResolvedValue(makeProfile());
});

// ── PURE-ish: the view projection is the privacy boundary ─────────────────────

describe("device toView", () => {
  it("exposes only the last four characters of the token", () => {
    const view = toView(makeDevice() as never);
    expect(view.tokenFingerprint).toBe("a350");
    expect(JSON.stringify(view)).not.toContain(TOKEN);
  });
});

describe("POST /v1/cdp/identity/devices", () => {
  const url = "/v1/cdp/identity/devices";
  const payload = { profileId: PROFILE_ID, deviceToken: TOKEN, deviceType: "android" };

  it("202 — links a new device token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.relinked).toBe(false);
    expect(H.insertMock).toHaveBeenCalledOnce();
    expect(H.relinkMock).not.toHaveBeenCalled();
    // The summary projection counts devices, so it must be invalidated.
    expect(H.cacheInvalidateMock).toHaveBeenCalledWith(`cdp:${TENANT}:profile_summary:${PROFILE_ID}`);
    await app.close();
  });

  it("202 — never echoes the token back to the caller or onto the event", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.body).not.toContain(TOKEN);
    expect(JSON.stringify(H.enqueueMock.mock.calls)).not.toContain(TOKEN);
    // The route publishes no command (the write is synchronous); the token must not
    // reach the outbox event either.
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — an existing token moves to the new profile instead of duplicating", async () => {
    H.findByTokenMock.mockResolvedValue(makeDevice({ profileId: "bbbbbbbb-9999-4000-8000-000000000009" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.relinked).toBe(true);
    expect(r.json().data.id).toBe(DEVICE_ID);
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.relinkMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("202 — defaults an unspecified device type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { profileId: PROFILE_ID, deviceToken: TOKEN },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.deviceType).toBe("unknown");
    await app.close();
  });

  it("400 — token shorter than the 16-character minimum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { profileId: PROFILE_ID, deviceToken: "short" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unsupported device type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { ...payload, deviceType: "toaster" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — a merged profile cannot own a device", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — concurrent re-link loses the version race", async () => {
    H.findByTokenMock.mockResolvedValue(makeDevice());
    H.relinkMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["viewer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/profiles/:id/devices", () => {
  const url = `/v1/cdp/profiles/${PROFILE_ID}/devices`;

  it("200 — lists linked devices with only a token fingerprint", async () => {
    H.listByProfileMock.mockResolvedValue({ rows: [makeDevice()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].tokenFingerprint).toBe("a350");
    expect(r.json().data[0].deviceToken).toBeUndefined();
    expect(r.body).not.toContain(TOKEN);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    await app.close();
  });

  it("200 — empty envelope when nothing is linked", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=500`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
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
