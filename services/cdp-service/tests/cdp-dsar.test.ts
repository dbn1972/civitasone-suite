/**
 * CDP-011 — DSAR intake, listing and completion with downstream propagation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { isCompletable, requiresDownstreamPurge } from "../src/modules/dsar/domain.js";
import { EVENTS } from "../src/topics.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const DSAR_ID = "99999999-1111-4000-8000-000000000001";

// ── PURE ──────────────────────────────────────────────────────────────────────

describe("isCompletable", () => {
  it("allows pending and in_progress", () => {
    expect(isCompletable("pending")).toBe(true);
    expect(isCompletable("in_progress")).toBe(true);
  });

  it("treats completed and rejected as terminal", () => {
    expect(isCompletable("completed")).toBe(false);
    expect(isCompletable("rejected")).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(isCompletable("archived")).toBe(false);
  });
});

describe("requiresDownstreamPurge", () => {
  it("is true for the request types that change stored data", () => {
    expect(requiresDownstreamPurge("erasure")).toBe(true);
    expect(requiresDownstreamPurge("rectification")).toBe(true);
  });

  it("is false for read-only disclosures", () => {
    expect(requiresDownstreamPurge("access")).toBe(false);
    expect(requiresDownstreamPurge("portability")).toBe(false);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  findByIdMock: vi.fn(),
  listMock: vi.fn(),
  insertMock: vi.fn(),
  completeMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: (t: string, r: string, i: string) => `cdp:${t}:${r}:${i}` },
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

vi.mock("../src/modules/dsar/repo.js", () => ({
  findById: (...a: unknown[]) => H.findByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.listMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  complete: (...a: unknown[]) => H.completeMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
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

function makeDsar(overrides: Record<string, unknown> = {}) {
  return {
    id: DSAR_ID, tenantId: TENANT, profileId: PROFILE_ID, requestType: "erasure",
    status: "pending", reason: "citizen request", requestedAt: new Date("2025-06-01T00:00:00Z"),
    completedAt: null, version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("m");
  H.insertMock.mockResolvedValue(undefined);
  H.completeMock.mockResolvedValue(true);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.profileFindByIdMock.mockResolvedValue(makeProfile());
});

describe("POST /v1/cdp/dsar", () => {
  const url = "/v1/cdp/dsar";
  const payload = { profileId: PROFILE_ID, requestType: "erasure", reason: "citizen request" };

  it("202 — accepts DSAR raise and publishes the command", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(r.json().id).toBeDefined();
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(H.publishMock.mock.calls[0]![0]).toBe("cdp.dsar.raise");
    expect(H.insertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — accepts every statutory request type", async () => {
    const app = await buildApp();
    for (const requestType of ["access", "erasure", "rectification", "portability"]) {
      const r = await app.inject({ method: "POST", url, headers: auth(), payload: { profileId: PROFILE_ID, requestType } });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe("accepted");
    }
    expect(H.publishMock).toHaveBeenCalledTimes(4);
    await app.close();
  });

  it("400 — unsupported request type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { profileId: PROFILE_ID, requestType: "forgetting" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-uuid profile id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { profileId: "nope", requestType: "access" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    expect(H.insertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot raise a DSAR", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/dsar", () => {
  const url = "/v1/cdp/dsar";

  it("200 — paginated list envelope", async () => {
    H.listMock.mockResolvedValue({ rows: [makeDsar()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    await app.close();
  });

  it("200 — passes the status filter through", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?status=completed`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { status: "completed" });
    await app.close();
  });

  it("200 — filters by profile as well", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `${url}?profileId=${PROFILE_ID}`, headers: auth() });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { profileId: PROFILE_ID });
    await app.close();
  });

  it("400 — unsupported status filter", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?status=lost`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=201`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without stewardship access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["cdp_user"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/dsar/:id/complete", () => {
  const url = `/v1/cdp/dsar/${DSAR_ID}/complete`;

  it("202 — accepts DSAR complete", async () => {
    H.findByIdMock.mockResolvedValue(makeDsar());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/dsar/${DSAR_ID}/complete`, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(H.publishMock.mock.calls[0]![0]).toBe("cdp.dsar.complete");
    expect(H.completeMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — an access request complete is accepted", async () => {
    H.findByIdMock.mockResolvedValue(makeDsar({ requestType: "access" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/dsar/${DSAR_ID}/complete`, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("202 — an in_progress request can be completed", async () => {
    H.findByIdMock.mockResolvedValue(makeDsar({ status: "in_progress", version: 2 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/dsar/${DSAR_ID}/complete`, headers: auth(), payload: { version: 2 } });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — missing version", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown request", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — stale version", async () => {
    H.findByIdMock.mockResolvedValue(makeDsar({ version: 3 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/dsar/${DSAR_ID}/complete`, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — an already-completed request is not re-completed", async () => {
    H.findByIdMock.mockResolvedValue(makeDsar({ status: "completed" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(422);
    // No second purge event.
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — a rejected request is terminal", async () => {
    H.findByIdMock.mockResolvedValue(makeDsar({ status: "rejected" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot complete a DSAR", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload: { version: 1 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
