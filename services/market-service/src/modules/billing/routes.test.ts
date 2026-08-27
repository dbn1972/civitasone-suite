/**
 * Re-review regression tests (PR #821 REQUEST CHANGES):
 *
 * MEDIUM (a): POST /demands/:id/waive checked canTransition(status, "paid")
 * instead of "waived" (copy-paste from the /pay handler). This was invisible
 * to a plain behavioral test because "paid" and "waived" happen to share the
 * exact same valid-from set in every entry of the current VALID_TRANSITIONS
 * table (domain.ts) — so this test spies on canTransition itself to pin the
 * SECOND ARGUMENT each route actually passes, which is the one thing that
 * would have caught the bug regardless of the table's current symmetry.
 *
 * Also covers the pre-existing (already correct) duplicate-demand 409
 * fast-path, to document the two-layer defense alongside the new atomic
 * onConflictDoNothing guard covered separately in consumer.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const DEMAND_ID = "cccccccc-1111-4000-8000-000000000001";
const ALLOTMENT_ID = "dddddddd-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  queuePublishMock: vi.fn(),
  demandsFindByIdMock: vi.fn(),
  findByAllotmentAndMonthMock: vi.fn(),
  allotmentsFindByIdMock: vi.fn(),
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

vi.mock("./repo.js", async () => {
  const actual = await vi.importActual<typeof import("./repo.js")>("./repo.js");
  return {
    ...actual,
    findById: (...a: unknown[]) => H.demandsFindByIdMock(...a),
    findByAllotmentAndMonth: (...a: unknown[]) => H.findByAllotmentAndMonthMock(...a),
  };
});

vi.mock("./domain.js", async () => {
  const actual = await vi.importActual<typeof import("./domain.js")>("./domain.js");
  return { ...actual, canTransition: vi.fn(actual.canTransition) };
});

vi.mock("../allotments/repo.js", () => ({
  findById: (...a: unknown[]) => H.allotmentsFindByIdMock(...a),
}));

import { buildApp } from "../../app.js";
import { canTransition } from "./domain.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles: string[]) => ({ authorization: `Bearer ${tok(roles)}`, "x-tenant-id": TENANT });

function makeDemand(status: string) {
  return {
    id: DEMAND_ID, tenantId: TENANT, allotmentId: ALLOTMENT_ID, demandMonth: "2026-08",
    amountMinor: 500000n, lateFeeMinor: 0n, currency: "INR", dueDate: "2026-08-10",
    status, paidAt: null, paymentRef: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.queuePublishMock.mockResolvedValue(undefined);
});

describe("POST /v1/market/demands/:id/waive vs /pay — correct transition target", () => {
  it("/waive checks canTransition against 'waived', not 'paid'", async () => {
    H.demandsFindByIdMock.mockResolvedValue(makeDemand("generated"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/market/demands/${DEMAND_ID}/waive`,
      headers: auth(["market_admin"]),
    });
    expect(r.statusCode).toBe(202);
    expect(canTransition).toHaveBeenCalledWith("generated", "waived");
    expect(canTransition).not.toHaveBeenCalledWith("generated", "paid");
    await app.close();
  });

  it("/pay checks canTransition against 'paid', not 'waived'", async () => {
    H.demandsFindByIdMock.mockResolvedValue(makeDemand("generated"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/market/demands/${DEMAND_ID}/pay`,
      headers: auth(["market_user"]),
      payload: { paymentRef: "UPI-REF-123" },
    });
    expect(r.statusCode).toBe(202);
    expect(canTransition).toHaveBeenCalledWith("generated", "paid");
    expect(canTransition).not.toHaveBeenCalledWith("generated", "waived");
    await app.close();
  });

  it("/waive still rejects a demand that is already paid (terminal)", async () => {
    H.demandsFindByIdMock.mockResolvedValue(makeDemand("paid"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/market/demands/${DEMAND_ID}/waive`,
      headers: auth(["market_admin"]),
    });
    expect(r.statusCode).toBe(422);
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /v1/market/demands — duplicate-month fast path", () => {
  it("rejects with 409 when a demand already exists for this allotment+month", async () => {
    H.allotmentsFindByIdMock.mockResolvedValue({
      id: ALLOTMENT_ID, tenantId: TENANT, status: "agreement_signed", monthlyRentMinor: 500000n,
    });
    H.findByAllotmentAndMonthMock.mockResolvedValue(makeDemand("generated"));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/market/demands",
      headers: auth(["market_admin"]),
      payload: { allotmentId: ALLOTMENT_ID, demandMonth: "2026-08", dueDate: "2026-08-10" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DEMAND_ALREADY_EXISTS");
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });
});
