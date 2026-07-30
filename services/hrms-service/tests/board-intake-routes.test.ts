/**
 * Route-level tests for board-intake module.
 * Covers: happy path, 400, 401, 403, 404, 409
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const ITEM_ID = "bbbbbbbb-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  listByStatus: vi.fn(),
  findById: vi.fn(),
  review: vi.fn(),
}));

vi.mock("../src/modules/board-intake/repo.js", () => ({
  listByStatus: (...a: unknown[]) => H.listByStatus(...a),
  findById: (...a: unknown[]) => H.findById(...a),
  review: (...a: unknown[]) => H.review(...a),
}));

vi.mock("../src/shared/db.js", () => {
  const mockTx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => ({ rowCount: 1 }) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => ({ onConflictDoNothing: () => ({ returning: () => [] }) }) }),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const pendingRow = () => ({
  id: ITEM_ID, tenantId: TENANT, decisionId: "dec-1", meetingId: "m-1",
  status: "pending_review", reviewedBy: null, reviewedAt: null, note: null,
  version: 1, createdAt: new Date(), updatedAt: new Date(),
  payload: { subject: "transfer order" },
});

beforeEach(() => { vi.clearAllMocks(); });
afterAll(async () => { await sqlClient.end(); });

describe("Board Intake — GET /v1/hrms/board-intake", () => {
  it("200 — lists pending items (happy path)", async () => {
    H.listByStatus.mockResolvedValue([pendingRow()]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(H.listByStatus).toHaveBeenCalledWith(TENANT, "pending_review");
    await app.close();
  });

  it("200 — filters by status query param", async () => {
    H.listByStatus.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake?status=accepted", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(H.listByStatus).toHaveBeenCalledWith(TENANT, "accepted");
    await app.close();
  });

  it("400 — invalid status enum", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake?status=invalid_value", headers: auth() });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role is denied", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("Board Intake — GET /v1/hrms/board-intake/:id", () => {
  it("200 — returns the item (happy path)", async () => {
    H.findById.mockResolvedValue(pendingRow());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/board-intake/${ITEM_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(ITEM_ID);
    await app.close();
  });

  it("400 — invalid uuid param", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake/not-a-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/board-intake/${ITEM_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/board-intake/${ITEM_ID}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — item not found", async () => {
    H.findById.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/board-intake/${ITEM_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

describe("Board Intake — POST /v1/hrms/board-intake/:id/accept", () => {
  it("200 — accepts a pending item (happy path)", async () => {
    H.findById.mockResolvedValue(pendingRow());
    H.review.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/accept`, headers: auth(), payload: { note: "looks good" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("accepted");
    expect(r.json().reviewedBy).toBe(USER);
    await app.close();
  });

  it("200 — accepts without note (optional)", async () => {
    H.findById.mockResolvedValue(pendingRow());
    H.review.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/accept`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("400 — invalid uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/board-intake/not-a-uuid/accept", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/accept`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/accept`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — item not found", async () => {
    H.findById.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/accept`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("409 — item already accepted", async () => {
    H.findById.mockResolvedValue({ ...pendingRow(), status: "accepted" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/accept`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    await app.close();
  });
});

describe("Board Intake — POST /v1/hrms/board-intake/:id/reject", () => {
  it("200 — rejects with note (happy path)", async () => {
    H.findById.mockResolvedValue(pendingRow());
    H.review.mockResolvedValue(undefined);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, headers: auth(), payload: { note: "not applicable" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    expect(r.json().reviewedBy).toBe(USER);
    await app.close();
  });

  it("400 — note missing (required for reject)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — note empty string", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, headers: auth(), payload: { note: "" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/board-intake/not-a-uuid/reject", headers: auth(), payload: { note: "x" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, payload: { note: "x" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, headers: auth(USER, ["employee"]), payload: { note: "x" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — item not found", async () => {
    H.findById.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, headers: auth(), payload: { note: "x" } });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("409 — item already rejected", async () => {
    H.findById.mockResolvedValue({ ...pendingRow(), status: "rejected" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/board-intake/${ITEM_ID}/reject`, headers: auth(), payload: { note: "x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    await app.close();
  });
});
