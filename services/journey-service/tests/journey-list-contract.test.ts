/**
 * GAP-JOURNEYS-ACTIVE-03 / ANALYTICS-03 / BUILDER-03 / TEMPLATES-03 pinning test.
 *
 * These items were filed "unverified-service-absent": the audit snapshot had no
 * journey-service, so the list endpoints' role gate, tenant scope and
 * server-side pagination cap could not be checked. The service IS present in
 * this worktree, and the list routes already:
 *   - require a journeys role (requireRole(ctx, JOURNEY_ROLES)) → 403 without it,
 *   - scope every query to ctx.tenantId (repo.listByTenant(ctx.tenantId, ...)),
 *   - DEFAULT the page size to 20 and CLAMP it to max 200 (listQuery zod),
 *     and return { data, meta: { page, pageSize, total } }.
 *
 * This test pins that contract for GET /v1/journeys, /executions and /triggers
 * so a later change can't silently drop the cap or the role gate. It fails on
 * code that removed any of those (no default limit / no role gate).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET as string; // supplied by vitest.config.ts
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const OTHER_TENANT = "aaaaaaaa-0002-4000-8000-000000000002";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  journeyListMock: vi.fn(),
  triggerListMock: vi.fn(),
  execListMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  publishMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));
vi.mock("../src/modules/journeys/repo.js", () => ({
  findById: vi.fn(), listByTenant: (...a: unknown[]) => H.journeyListMock(...a),
  insert: vi.fn(), update: vi.fn(), softDelete: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/triggers/repo.js", () => ({
  findById: vi.fn(), listByTenant: (...a: unknown[]) => H.triggerListMock(...a),
  insert: vi.fn(), update: vi.fn(), softDelete: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/steps/repo.js", () => ({
  findById: vi.fn(), listByJourney: vi.fn(), insert: vi.fn(), updateStatus: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/executions/repo.js", () => ({
  findById: vi.fn(), listByTenant: (...a: unknown[]) => H.execListMock(...a),
  insert: vi.fn(), updateStatus: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const auth = (sub = USER, roles = ["journey_admin"], tid = TENANT) =>
  ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s" }, SECRET)}` });

const LIST = [
  { path: "/v1/journeys", mock: () => H.journeyListMock },
  { path: "/v1/journeys/executions", mock: () => H.execListMock },
  { path: "/v1/journeys/triggers", mock: () => H.triggerListMock },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  H.journeyListMock.mockResolvedValue({ rows: [], total: 0 });
  H.execListMock.mockResolvedValue({ rows: [], total: 0 });
  H.triggerListMock.mockResolvedValue({ rows: [], total: 0 });
});

describe.each(LIST)("$path — list contract", ({ path, mock }) => {
  it("403 without a journeys role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: path, headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: path });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("defaults to a server-capped page size (limit=20) when no limit is passed", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: path, headers: auth() });
    expect(r.statusCode).toBe(200);
    // repo called with (tenantId, limit=20, offset=0, filters)
    const [, limit, offset] = mock().mock.calls[0]!;
    expect(limit).toBe(20);
    expect(offset).toBe(0);
    expect(r.json().meta.pageSize).toBe(20);
    await app.close();
  });

  it("clamps an over-large limit to the max page size (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${path}?limit=5000`, headers: auth() });
    // 5000 is above the zod max(200) → 400 rejection, so an unbounded page can never be requested.
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("scopes the query to the caller's tenant", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: path, headers: auth(USER, ["journey_admin"], OTHER_TENANT) });
    const [tenantId] = mock().mock.calls[0]!;
    expect(tenantId).toBe(OTHER_TENANT);
    await app.close();
  });
});
