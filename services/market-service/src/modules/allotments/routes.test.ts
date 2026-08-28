/**
 * Re-review regression test (PR #821 REQUEST CHANGES, HIGH finding #1):
 *
 * POST /v1/market/allotments used to accept a client-supplied
 * monthlyRentMinor/securityDepositMinor directly, gated only by USER_ROLES
 * (a plain market_user, not admin). `property` was already being fetched for
 * its status check, but nothing cross-checked the client's numbers against
 * it — so a citizen could set their own allotment's rent to 1, and the
 * (correctly-fixed) billing path would then faithfully derive the billed
 * amount from that self-set value. The fix removes both fields from the
 * accepted request body entirely and always derives them from the property.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROPERTY_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  queuePublishMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  propertiesFindByIdMock: vi.fn(),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: { getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a) },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

// shared/db.ts calls createTenantDb(...) at module-import time, which stands
// up a real connection pool — must be mocked before app.ts (which imports it
// transitively) is ever imported, or buildApp() would try to hit a real DB.
vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) },
  scopedRead: async (fn: (tx: unknown) => unknown) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../properties/repo.js", () => ({
  findById: (...a: unknown[]) => H.propertiesFindByIdMock(...a),
}));

import { buildApp } from "../../app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["market_user"]) => ({ authorization: `Bearer ${tok(roles)}`, "x-tenant-id": TENANT });

function makeProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPERTY_ID,
    tenantId: TENANT,
    propertyCode: "SHOP-1",
    marketName: "Central Market",
    propertyType: "shop",
    location: null,
    area: null,
    areaUnit: "sqft",
    floorNumber: null,
    monthlyRentMinor: 500000n, // Rs. 5,000.00 — the REAL, admin-set rent
    securityDepositMinor: 1000000n, // Rs. 10,000.00 — the REAL, admin-set deposit
    currency: "INR",
    status: "available",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.queuePublishMock.mockResolvedValue(undefined);
  H.propertiesFindByIdMock.mockResolvedValue(makeProperty());
});

describe("POST /v1/market/allotments — rent/deposit trust boundary", () => {
  it("derives monthlyRentMinor/securityDepositMinor from the property, ignoring any client-supplied values", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/market/allotments",
      headers: auth(["market_user"]), // plain citizen role, NOT admin
      payload: {
        propertyId: PROPERTY_ID,
        allotteeName: "Ramesh Kumar",
        allotmentType: "direct",
        // Attempted smuggling of a self-set rent/deposit — must be ignored.
        monthlyRentMinor: 1,
        securityDepositMinor: 1,
      },
    });

    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    const [, message] = H.queuePublishMock.mock.calls[0] as [string, { payload: Record<string, unknown> }];
    // The published command must carry the PROPERTY's real values...
    expect(message.payload.monthlyRentMinor).toBe("500000");
    expect(message.payload.securityDepositMinor).toBe("1000000");
    // ...never the attacker-supplied "1".
    expect(message.payload.monthlyRentMinor).not.toBe(1);
    expect(message.payload.securityDepositMinor).not.toBe(1);
    await app.close();
  });

  it("still creates an allotment when the property has no configured rent/deposit, without fabricating a value", async () => {
    H.propertiesFindByIdMock.mockResolvedValue(makeProperty({ monthlyRentMinor: null, securityDepositMinor: null }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/market/allotments",
      headers: auth(["market_user"]),
      payload: { propertyId: PROPERTY_ID, allotteeName: "Suresh Rao", allotmentType: "draw" },
    });

    expect(r.statusCode).toBe(202);
    const [, message] = H.queuePublishMock.mock.calls[0] as [string, { payload: Record<string, unknown> }];
    expect(message.payload.monthlyRentMinor).toBeUndefined();
    expect(message.payload.securityDepositMinor).toBeUndefined();
    await app.close();
  });

  it("rejects allotment application against a property that is not available", async () => {
    H.propertiesFindByIdMock.mockResolvedValue(makeProperty({ status: "under_maintenance" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/market/allotments",
      headers: auth(["market_user"]),
      payload: { propertyId: PROPERTY_ID, allotteeName: "Geeta Devi", allotmentType: "auction" },
    });

    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PROPERTY_NOT_AVAILABLE");
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });
});
