/**
 * GAP-FIELD-VISITS-04: GET /v1/field/visits takes an optional from/to date range
 * (inclusive calendar days, IST) so the UI can page/filter beyond the newest page.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const SUP = "aaaaaaaa-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({ visitList: vi.fn() }));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async () => [],
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: async (_k: string, l: () => Promise<unknown>) => l(), invalidate: vi.fn(), makeKey: () => "k" },
  queue: { publish: vi.fn() },
}));
vi.mock("../src/modules/visits/repo.js", () => ({
  listRecent: (...a: unknown[]) => H.visitList(...a),
  findById: vi.fn(), findByTaskId: vi.fn(), findByAgent: vi.fn(),
  insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const auth = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: SUP, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.visitList.mockResolvedValue({ rows: [], total: 0 });
});

describe("GET /v1/field/visits date range", () => {
  it("passes an IST-day-bounded [from, to+1d) range to the repo", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/field/visits?from=2026-10-01&to=2026-10-02",
      headers: auth(["field_admin"]),
    });
    expect(r.statusCode).toBe(200);
    const range = H.visitList.mock.calls[0]![4] as { from?: Date; toExclusive?: Date };
    expect(range.from?.toISOString()).toBe("2026-09-30T18:30:00.000Z"); // 2026-10-01 00:00 IST
    expect(range.toExclusive?.toISOString()).toBe("2026-10-02T18:30:00.000Z"); // 2026-10-03 00:00 IST
    await app.close();
  });

  it("passes no range when neither bound is given (unchanged behaviour)", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/field/visits", headers: auth(["field_admin"]) });
    expect(H.visitList.mock.calls[0]![4]).toBeUndefined();
    await app.close();
  });

  it("rejects a malformed or inverted range with 400, never silently ignoring it", async () => {
    const app = await buildApp();
    for (const q of ["from=yesterday", "from=2026-10-05&to=2026-10-01", "to=2026-13-40"]) {
      const r = await app.inject({ method: "GET", url: `/v1/field/visits?${q}`, headers: auth(["field_admin"]) });
      expect(r.statusCode, q).toBe(400);
    }
    expect(H.visitList).not.toHaveBeenCalled();
    await app.close();
  });
});
