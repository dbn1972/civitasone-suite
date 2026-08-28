/**
 * Re-review regression test (PR #821 REQUEST CHANGES, MEDIUM finding (d)):
 *
 * transfer/cancellation/eviction request-creation and /approve previously only
 * checked that the target allotment EXISTED, never that it was in a status
 * those actions actually apply to (LIFECYCLE_ACTIONABLE_STATUSES). The only
 * place that was ever checked was deep inside completeRequest's atomic guard
 * — by which point the original HTTP caller had long since received their 202
 * with no way to learn the completion silently aborted. These tests confirm
 * the new synchronous 422 at request-creation and approval time.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const ALLOTMENT_ID = "cccccccc-1111-4000-8000-000000000001";
const REQUEST_ID = "dddddddd-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  queuePublishMock: vi.fn(),
  allotmentsFindByIdMock: vi.fn(),
  lifecycleFindByIdMock: vi.fn(),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn() },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => unknown) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../allotments/repo.js", () => ({
  findById: (...a: unknown[]) => H.allotmentsFindByIdMock(...a),
}));

vi.mock("./repo.js", async () => {
  const actual = await vi.importActual<typeof import("./repo.js")>("./repo.js");
  return { ...actual, findById: (...a: unknown[]) => H.lifecycleFindByIdMock(...a) };
});

import { buildApp } from "../../app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles: string[]) => ({ authorization: `Bearer ${tok(roles)}`, "x-tenant-id": TENANT });

function makeAllotment(status: string) {
  return {
    id: ALLOTMENT_ID, tenantId: TENANT, allotmentNumber: "MKT/ULB/2026/000001",
    propertyId: "ee000000-0000-4000-8000-000000000001", allotteeName: "Ramesh Kumar",
    allotteePhone: null, allotteeAadhaar: null, allotmentType: "direct",
    allotmentDate: null, agreementStartDate: null, agreementEndDate: null,
    monthlyRentMinor: 500000n, securityDepositMinor: 1000000n, currency: "INR",
    status, createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
  };
}

function makeLifecycleRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, tenantId: TENANT, allotmentId: ALLOTMENT_ID,
    requestNumber: "MKT-LC/ULB/2026/000001", requestType: "transfer", status: "submitted",
    transfereeName: "New Allottee", transfereeAadhaar: null, reason: null,
    approvedBy: null, completedAt: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.queuePublishMock.mockResolvedValue(undefined);
});

describe.each([
  ["transfer", "/v1/market/lifecycle/transfer", ["market_user"], { allotmentId: ALLOTMENT_ID, transfereeName: "New Guy" }],
  ["cancellation", "/v1/market/lifecycle/cancellation", ["market_user"], { allotmentId: ALLOTMENT_ID }],
  ["eviction", "/v1/market/lifecycle/eviction", ["market_admin"], { allotmentId: ALLOTMENT_ID, reason: "non-payment" }],
])("POST %s request — allotment actionability guard", (_label, url, roles, payload) => {
  it("rejects with 422 ALLOTMENT_NOT_ACTIONABLE when the allotment has not reached agreement_signed/active", async () => {
    H.allotmentsFindByIdMock.mockResolvedValue(makeAllotment("applied"));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(roles), payload });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ALLOTMENT_NOT_ACTIONABLE");
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects with 422 when the allotment is already transferred/cancelled/evicted (terminal)", async () => {
    H.allotmentsFindByIdMock.mockResolvedValue(makeAllotment("transferred"));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(roles), payload });
    expect(r.statusCode).toBe(422);
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts when the allotment is agreement_signed", async () => {
    H.allotmentsFindByIdMock.mockResolvedValue(makeAllotment("agreement_signed"));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(roles), payload });
    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe("POST /v1/market/lifecycle/:id/approve — allotment actionability guard", () => {
  it("rejects with 422 when the request's allotment is no longer actionable", async () => {
    H.lifecycleFindByIdMock.mockResolvedValue(makeLifecycleRequest({ status: "submitted" }));
    H.allotmentsFindByIdMock.mockResolvedValue(makeAllotment("cancelled"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/market/lifecycle/${REQUEST_ID}/approve`,
      headers: auth(["market_admin"]),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ALLOTMENT_NOT_ACTIONABLE");
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("approves when both the request and its allotment are in valid states", async () => {
    H.lifecycleFindByIdMock.mockResolvedValue(makeLifecycleRequest({ status: "submitted" }));
    H.allotmentsFindByIdMock.mockResolvedValue(makeAllotment("agreement_signed"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/market/lifecycle/${REQUEST_ID}/approve`,
      headers: auth(["market_admin"]),
    });
    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    await app.close();
  });
});
