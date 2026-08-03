/**
 * CDP-012 — activate a segment to any supported channel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { resolveDispatchAt, isImmediate, ACTIVATION_CHANNELS } from "../src/modules/activations/domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const SEGMENT_ID = "cccccccc-1111-4000-8000-000000000001";
const ACTIVATION_ID = "77777777-1111-4000-8000-000000000001";

const NOW = new Date("2026-01-01T00:00:00.000Z");

// ── PURE ──────────────────────────────────────────────────────────────────────

describe("resolveDispatchAt", () => {
  it("dispatches now when no schedule is given", () => {
    expect(resolveDispatchAt(undefined, NOW)).toEqual(NOW);
  });

  it("keeps a future schedule", () => {
    const future = "2026-02-01T00:00:00.000Z";
    expect(resolveDispatchAt(future, NOW).toISOString()).toBe(future);
  });

  it("treats a past schedule as send-now rather than rejecting it", () => {
    expect(resolveDispatchAt("2025-01-01T00:00:00.000Z", NOW)).toEqual(NOW);
  });

  it("treats the exact current instant as send-now", () => {
    expect(resolveDispatchAt(NOW.toISOString(), NOW)).toEqual(NOW);
  });

  it("falls back to now for an unparseable schedule", () => {
    expect(resolveDispatchAt("next tuesday", NOW)).toEqual(NOW);
  });
});

describe("isImmediate", () => {
  it("is true at or before now", () => {
    expect(isImmediate(NOW, NOW)).toBe(true);
    expect(isImmediate(new Date(NOW.getTime() - 1), NOW)).toBe(true);
  });

  it("is false for a future dispatch", () => {
    expect(isImmediate(new Date(NOW.getTime() + 1), NOW)).toBe(false);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  segmentFindByIdMock: vi.fn(),
  countMembersMock: vi.fn(),
  insertMock: vi.fn(),
  listMock: vi.fn(),
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

vi.mock("../src/modules/segments/repo.js", () => ({
  findById: (...a: unknown[]) => H.segmentFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: vi.fn(async () => true),
  softDelete: vi.fn(async () => true),
  evaluateMembers: vi.fn(async () => ({ profileIds: [], total: 0 })),
  updateMemberCount: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/segments/membership-repo.js", () => ({
  listMembers: vi.fn(async () => ({ rows: [], total: 0 })),
  countMembers: (...a: unknown[]) => H.countMembersMock(...a),
  countSegmentsForProfile: vi.fn(async () => 0),
  recompute: vi.fn(async () => 0),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/activations/repo.js", () => ({
  findById: vi.fn(async () => null),
  listByTenant: (...a: unknown[]) => H.listMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  updateStatus: vi.fn(async () => true),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: SEGMENT_ID, tenantId: TENANT, name: "Pune residents", description: null,
    segmentType: "dynamic", criteria: {}, status: "active", memberCount: 12,
    isArchived: false, version: 1,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

function makeActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTIVATION_ID, tenantId: TENANT, segmentId: SEGMENT_ID, channel: "whatsapp",
    status: "pending", audienceCount: 12, startedAt: null, completedAt: null, version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("m");
  H.insertMock.mockResolvedValue(undefined);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.countMembersMock.mockResolvedValue(12);
  H.segmentFindByIdMock.mockResolvedValue(makeSegment());
});

describe("POST /v1/cdp/segments/:id/activate", () => {
  const url = `/v1/cdp/segments/${SEGMENT_ID}/activate`;

  it("202 — accepts activation sized from materialised membership", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.countMembersMock.mockResolvedValue(42);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/segments/${SEGMENT_ID}/activate`, headers: auth(), payload: { channel: "sms" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(r.json().id).toBeDefined();
    expect(H.publishMock).toHaveBeenCalledOnce();
    expect(H.publishMock.mock.calls[0]![0]).toBe("cdp.segment.activate");
    expect(H.insertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — supports every channel including umang", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.countMembersMock.mockResolvedValue(1);
    const app = await buildApp();
    for (const channel of ACTIVATION_CHANNELS) {
      const r = await app.inject({ method: "POST", url: `/v1/cdp/segments/${SEGMENT_ID}/activate`, headers: auth(), payload: { channel } });
      expect(r.statusCode).toBe(202);
      expect(r.json().status).toBe("accepted");
    }
    expect(H.publishMock).toHaveBeenCalledTimes(ACTIVATION_CHANNELS.length);
    await app.close();
  });

  it("202 — a future schedule is published on the command", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.countMembersMock.mockResolvedValue(3);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/segments/${SEGMENT_ID}/activate`, headers: auth(), payload: { channel: "email", scheduledAt: "2030-01-01T00:00:00.000Z" } });
    expect(r.statusCode).toBe(202);
    const pub = H.publishMock.mock.calls[0]![1] as { payload: { dispatchAt: string } };
    expect(pub.payload.dispatchAt).toBe("2030-01-01T00:00:00.000Z");
    await app.close();
  });

  it("202 — an immediate run publishes activate command", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.countMembersMock.mockResolvedValue(5);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/segments/${SEGMENT_ID}/activate`, headers: auth(), payload: { channel: "push" } });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("202 — an empty audience still accepts activation", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment());
    H.countMembersMock.mockResolvedValue(0);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/cdp/segments/${SEGMENT_ID}/activate`, headers: auth(), payload: { channel: "whatsapp" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    const pub = H.publishMock.mock.calls[0]![1] as { payload: { audienceCount: number } };
    expect(pub.payload.audienceCount).toBe(0);
    await app.close();
  });

  it("400 — unsupported channel", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { channel: "fax" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing channel", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — scheduledAt is not a datetime", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { channel: "sms", scheduledAt: "tomorrow" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown segment", async () => {
    H.segmentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { channel: "sms" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — a paused segment cannot be activated", async () => {
    H.segmentFindByIdMock.mockResolvedValue(makeSegment({ status: "paused" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { channel: "sms" } });
    expect(r.statusCode).toBe(422);
    expect(H.insertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { channel: "sms" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot activate", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload: { channel: "sms" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/activations", () => {
  const url = "/v1/cdp/activations";

  it("200 — paginated list envelope", async () => {
    H.listMock.mockResolvedValue({ rows: [makeActivation()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    await app.close();
  });

  it("200 — filters by channel and status together", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?channel=push&status=running`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { channel: "push", status: "running" });
    await app.close();
  });

  it("200 — filters by segment", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `${url}?segmentId=${SEGMENT_ID}`, headers: auth() });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { segmentId: SEGMENT_ID });
    await app.close();
  });

  it("200 — page number is derived from the offset", async () => {
    H.listMock.mockResolvedValue({ rows: [], total: 9 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=3&offset=6`, headers: auth() });
    expect(r.json().meta).toEqual({ page: 3, pageSize: 3, total: 9 });
    await app.close();
  });

  it("400 — unsupported channel filter", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?channel=fax`, headers: auth() });
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

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
