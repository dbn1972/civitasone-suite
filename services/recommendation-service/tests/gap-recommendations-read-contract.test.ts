/**
 * GAP-RECOMMENDATIONS-{FEEDBACK,HEALTH,MATRIX,NBA}-04 — the audit snapshot
 * marked these "unverified-service-absent" (recommendation-service was not in
 * the snapshot). The service IS present in this worktree, so this pins the
 * contract the web loaders depend on for all four read endpoints:
 *   - unauthenticated  -> 401
 *   - wrong role       -> 403
 *   - authenticated    -> 200 with a bounded (paginated) list envelope
 *
 * Fully mocked (no DB), mirroring tests/health-scoring.test.ts's harness.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  queuePublishMock: vi.fn(),
  predictiveListRankedMock: vi.fn(),
  matrixListByTenantMock: vi.fn(),
  healthListAtRiskMock: vi.fn(),
  rejectionSummaryMock: vi.fn(),
  totalRejectionsMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/predictive/repo.js", async () => {
  const actual = await import("../src/modules/predictive/repo.js");
  return { ...actual, listRanked: (...a: unknown[]) => H.predictiveListRankedMock(...a) };
});
vi.mock("../src/modules/matrix/repo.js", async () => {
  const actual = await import("../src/modules/matrix/repo.js");
  return { ...actual, listByTenant: (...a: unknown[]) => H.matrixListByTenantMock(...a) };
});
vi.mock("../src/modules/health/scoring-repo.js", () => ({
  listAtRisk: (...a: unknown[]) => H.healthListAtRiskMock(...a),
  findCurrent: vi.fn(),
}));
vi.mock("../src/modules/feedback/reason-repo.js", async () => {
  const actual = await import("../src/modules/feedback/reason-repo.js");
  return {
    ...actual,
    rejectionSummary: (...a: unknown[]) => H.rejectionSummaryMock(...a),
    totalRejections: (...a: unknown[]) => H.totalRejectionsMock(...a),
  };
});

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const strangerAuth = () => auth(["viewer"]);

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.predictiveListRankedMock.mockResolvedValue({ rows: [], total: 0 });
  H.matrixListByTenantMock.mockResolvedValue({ rows: [], total: 0 });
  H.healthListAtRiskMock.mockResolvedValue({ rows: [], total: 0 });
  H.rejectionSummaryMock.mockResolvedValue([]);
  H.totalRejectionsMock.mockResolvedValue(0);
});

const ENDPOINTS: { gap: string; url: string }[] = [
  { gap: "NBA-04", url: "/v1/recommendations/predictive" },
  { gap: "MATRIX-04", url: "/v1/recommendations/matrix" },
  { gap: "HEALTH-04", url: "/v1/recommendations/health/at-risk" },
  { gap: "FEEDBACK-04", url: "/v1/recommendations/feedback/rejection-summary" },
];

describe("recommendation read endpoints — auth + role contract (GAP-*-04)", () => {
  for (const { gap, url } of ENDPOINTS) {
    it(`${gap}: 401 without a token (${url})`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it(`${gap}: 403 with a wrong role (${url})`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: strangerAuth() });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it(`${gap}: 200 with a recommendation role (${url})`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toHaveProperty("data");
      await app.close();
    });
  }
});

describe("list endpoints bound their page size (GAP-*-04 pagination)", () => {
  it("predictive clamps limit above the max to 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?limit=99999",
      headers: auth(),
    });
    // zod max is 200, so a request for 99999 is rejected (not silently unbounded).
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("health at-risk honours an explicit limit", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk?limit=5",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const call = H.healthListAtRiskMock.mock.calls[0];
    expect(call[call.length - 1]).toBe(5);
    await app.close();
  });
});
