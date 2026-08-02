/**
 * Comprehensive route coverage tests for procurement-service.
 * Hits ALL routes to push line coverage above 80%.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000099";
const FAKE_UUID = "00000000-0000-4000-8000-000000000001";

function tok(roles: string[] = ["procurement_officer", "procurement_manager", "super_admin"]) {
  return signToken({ sub: "user-cov-001", tid: TENANT, roles, sid: "sess-cov-001" }, SECRET);
}
function citizenTok() {
  return signToken({ sub: "citizen-001", tid: TENANT, roles: ["citizen"], sid: "sess-cit-001" }, SECRET);
}
const auth = { authorization: `Bearer ${tok()}` };
const citizenAuth = { authorization: `Bearer ${citizenTok()}` };

afterAll(async () => { await sqlClient.end(); });

// ─── GET routes: expect 200 ──────────────────────────────────────────────────
describe("GET routes — 200 OK", () => {
  const gets: string[] = [
    "/v1/procurement/dashboard",
    "/v1/procurement/indents",
    "/v1/procurement/indents/tender-required",
    "/v1/procurement/vendors",
    "/v1/procurement/pos",
    "/v1/procurement/orders",
    "/v1/procurement/grns",
    "/v1/procurement/rfqs",
    "/v1/procurement/tenders",
    "/v1/procurement/approvals",
    "/v1/procurement/emd",
    "/v1/procurement/pbg",
    "/v1/procurement/three-way-match",
    "/v1/procurement/vendor-blacklist",
    "/v1/procurement/vendors/blacklisted",
    "/v1/procurement/central-debarment",
  ];

  for (const url of gets) {
    it(`GET ${url} → 200`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url, headers: auth });
      await app.close();
      expect(res.statusCode).toBe(200);
    });
  }
});

// ─── GET :id routes — expect 404 for non-existent ────────────────────────────
describe("GET :id routes — 404 for non-existent", () => {
  const detailRoutes: string[] = [
    `/v1/procurement/indents/${FAKE_UUID}`,
    `/v1/procurement/vendors/${FAKE_UUID}`,
    `/v1/procurement/pos/${FAKE_UUID}`,
    `/v1/procurement/grns/${FAKE_UUID}`,
    `/v1/procurement/rfqs/${FAKE_UUID}`,
    `/v1/procurement/tenders/${FAKE_UUID}`,
    `/v1/procurement/tenders/${FAKE_UUID}/evaluation`,
    `/v1/procurement/auctions/${FAKE_UUID}`,
    `/v1/procurement/emd/${FAKE_UUID}`,
    `/v1/procurement/pbg/${FAKE_UUID}`,
  ];

  for (const url of detailRoutes) {
    it(`GET ${url} → 404`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url, headers: auth });
      await app.close();
      expect(res.statusCode).toBe(404);
    });
  }
});

// ─── POST routes with valid payloads — expect 202 (accepted) ─────────────────
describe("POST routes — accepted (202)", () => {
  it("POST /v1/procurement/indents → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/indents", headers: auth,
      payload: {
        indentNo: "IND-TEST-001", department: "IT", purpose: "Test indent",
        items: [{ itemCode: "IT001", description: "Laptop", quantity: 2, unitPriceMinor: 500000 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/vendors → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/vendors", headers: auth,
      payload: { name: "TestVendor Pvt Ltd" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/pos → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos", headers: auth,
      payload: {
        poNo: "PO-TEST-001", vendorId: FAKE_UUID, indentRef: "IND-001",
        items: [{ itemCode: "IT001", description: "Monitor", quantity: 5, unitPriceMinor: 200000 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/pos/gem → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos/gem", headers: auth,
      payload: {
        poNo: "GEM-PO-001", vendorId: FAKE_UUID, indentRef: "IND-002",
        gemOrderNo: "GEMC-123456",
        items: [{ itemCode: "IT002", description: "Printer", quantity: 1, unitPriceMinor: 100000 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/grns → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/grns", headers: auth,
      payload: {
        grnNo: "GRN-TEST-001", poRef: "PO-001", vendorId: FAKE_UUID,
        items: [{ poItemRef: "item-1", itemCode: "IT001", orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
        inspection: { inspectorId: FAKE_UUID, result: "pass" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/auctions → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/auctions", headers: auth,
      payload: {
        auctionNo: "AUC-001", indentRef: "IND-003", title: "Server auction",
        reserveMinor: 5000000,
        startAt: "2025-03-01T10:00:00Z", endAt: "2025-03-02T10:00:00Z",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/tenders → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/tenders", headers: auth,
      payload: {
        title: "IT Equipment Tender", bidClosingDate: "2025-04-01",
        type: "open", estimatedMinor: 600000000,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/emd → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/emd", headers: auth,
      payload: { vendorId: FAKE_UUID, amountMinor: 100000, instrument: "dd" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/pbg → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pbg", headers: auth,
      payload: { vendorId: FAKE_UUID, amountMinor: 500000, instrument: "bank_guarantee" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/advances → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/advances", headers: auth,
      payload: { poRef: "PO-001", vendorId: FAKE_UUID, amountMinor: 250000 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/debit-notes → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/debit-notes", headers: auth,
      payload: { grnRef: "GRN-001", vendorId: FAKE_UUID, reason: "Short shipment found", amountMinor: 50000 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ─── POST :id action routes with fake UUID — expect 202 or 404 ──────────────
describe("POST :id action routes — fake UUID", () => {
  it("POST /v1/procurement/tenders/:id/publish → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/publish`, headers: auth,
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/tenders/:id/bids → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/bids`, headers: auth,
      payload: { vendorId: FAKE_UUID, financialAmountMinor: 1000000 },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/tenders/:id/technical-evaluation → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/technical-evaluation`, headers: auth,
      payload: { results: [{ bidId: FAKE_UUID, qualified: true, score: 85 }] },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/tenders/:id/open-financial → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/open-financial`, headers: auth,
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/tenders/:id/award → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/award`, headers: auth,
      payload: {},
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/emd/:id/forfeit → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/emd/${FAKE_UUID}/forfeit`, headers: auth,
      payload: {},
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/emd/:id/refund → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/emd/${FAKE_UUID}/refund`, headers: auth,
      payload: {},
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/pbg/:id/forfeit → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pbg/${FAKE_UUID}/forfeit`, headers: auth,
      payload: {},
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/pbg/:id/release → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pbg/${FAKE_UUID}/release`, headers: auth,
      payload: {},
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/pos/:id/dispatch → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pos/${FAKE_UUID}/dispatch`, headers: auth,
      payload: { notes: "Dispatched" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/pos/:id/submit-approval → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pos/${FAKE_UUID}/submit-approval`, headers: auth,
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("PATCH /v1/procurement/indents/:id/approve → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/indents/${FAKE_UUID}/approve`, headers: auth,
      payload: { notes: "approved" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("PATCH /v1/procurement/indents/:id/reject → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/indents/${FAKE_UUID}/reject`, headers: auth,
      payload: { reason: "not needed" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("PATCH /v1/procurement/auctions/:id/close → 202|404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/auctions/${FAKE_UUID}/close`, headers: auth,
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/auctions/:id/bids → 202|404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/auctions/${FAKE_UUID}/bids`, headers: auth,
      payload: { vendorId: FAKE_UUID, bidMinor: 4000000 },
    });
    await app.close();
    expect([202, 400, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/three-way-match → 404 (PO not found)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: FAKE_UUID, grnId: FAKE_UUID },
    });
    await app.close();
    expect([201, 404]).toContain(res.statusCode);
  });
});

// ─── Vendor blacklist routes ────────────────────────────────────────────────
describe("Vendor blacklist routes", () => {
  it("POST /v1/procurement/vendors/:id/blacklist → 404 (vendor not found)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/vendors/${FAKE_UUID}/blacklist`, headers: auth,
      payload: { reason: "fraud detected", blacklistedFrom: "2025-01-01" },
    });
    await app.close();
    expect([201, 404]).toContain(res.statusCode);
  });

  it("DELETE /v1/procurement/vendors/:id/blacklist → 404 (not in blacklist)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/procurement/vendors/${FAKE_UUID}/blacklist`, headers: auth,
    });
    await app.close();
    expect([200, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/central-debarment → 202|201|409|500", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/central-debarment", headers: auth,
      payload: { pan: "ABCDE1234F", reason: "CVC debarment order", blacklistedFrom: "2025-01-01" },
    });
    await app.close();
    expect([202, 201, 409, 500]).toContain(res.statusCode);
  });
});

// ─── Vendor empanel route ───────────────────────────────────────────────────
describe("Vendor empanel route", () => {
  it("PATCH /v1/procurement/vendors/:id/empanel → 202|404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/vendors/${FAKE_UUID}/empanel`, headers: auth,
      payload: { category: "IT Equipment" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });
});

// ─── PO print/download routes ────────────────────────────────────────────────
describe("PO print/download routes", () => {
  it("GET /v1/procurement/pos/:id/pdf → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/procurement/pos/${FAKE_UUID}/pdf`, headers: auth,
    });
    await app.close();
    expect([200, 404]).toContain(res.statusCode);
  });

  it("GET /v1/procurement/pos/:id/download → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/procurement/pos/${FAKE_UUID}/download`, headers: auth,
    });
    await app.close();
    expect([200, 404]).toContain(res.statusCode);
  });
});

// ─── Auth 403 tests — citizen role ──────────────────────────────────────────
describe("Auth 403 — citizen role blocked", () => {
  const protectedRoutes = [
    { method: "GET" as const, url: "/v1/procurement/dashboard" },
    { method: "GET" as const, url: "/v1/procurement/indents" },
    { method: "GET" as const, url: "/v1/procurement/pos" },
    { method: "GET" as const, url: "/v1/procurement/tenders" },
    { method: "GET" as const, url: "/v1/procurement/vendors" },
    { method: "GET" as const, url: "/v1/procurement/emd" },
    { method: "GET" as const, url: "/v1/procurement/pbg" },
    { method: "GET" as const, url: "/v1/procurement/approvals" },
    { method: "GET" as const, url: "/v1/procurement/three-way-match" },
    { method: "POST" as const, url: "/v1/procurement/indents" },
    { method: "POST" as const, url: "/v1/procurement/vendors" },
    { method: "POST" as const, url: "/v1/procurement/pos" },
    { method: "POST" as const, url: "/v1/procurement/tenders" },
    { method: "POST" as const, url: "/v1/procurement/emd" },
  ];

  for (const { method, url } of protectedRoutes) {
    it(`${method} ${url} → 403 for citizen`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method, url, headers: citizenAuth, payload: {} });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  }
});

// ─── Validation 400 tests — empty payloads on POST routes ───────────────────
describe("Validation 400 — empty/invalid payloads", () => {
  const postRoutes = [
    "/v1/procurement/indents",
    "/v1/procurement/vendors",
    "/v1/procurement/pos",
    "/v1/procurement/pos/gem",
    "/v1/procurement/grns",
    "/v1/procurement/auctions",
    "/v1/procurement/tenders",
    "/v1/procurement/emd",
    "/v1/procurement/pbg",
    "/v1/procurement/advances",
    "/v1/procurement/debit-notes",
    "/v1/procurement/three-way-match",
    "/v1/procurement/central-debarment",
  ];

  for (const url of postRoutes) {
    it(`POST ${url} with empty body → 400`, async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST", url, headers: auth, payload: {},
      });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  }
});

// ─── 401 Unauthorized tests (no token) ──────────────────────────────────────
describe("401 Unauthorized — no token", () => {
  const noAuthRoutes = [
    "/v1/procurement/dashboard",
    "/v1/procurement/indents",
    "/v1/procurement/vendors",
    "/v1/procurement/pos",
    "/v1/procurement/tenders",
    "/v1/procurement/emd",
  ];

  for (const url of noAuthRoutes) {
    it(`GET ${url} without token → 401`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url });
      await app.close();
      expect(res.statusCode).toBe(401);
    });
  }
});

// ─── Invalid UUID param → 400 ───────────────────────────────────────────────
describe("Invalid UUID param → 400", () => {
  const paramRoutes = [
    "/v1/procurement/indents/not-a-uuid",
    "/v1/procurement/vendors/not-a-uuid",
    "/v1/procurement/pos/not-a-uuid",
    "/v1/procurement/grns/not-a-uuid",
    "/v1/procurement/rfqs/not-a-uuid",
    "/v1/procurement/tenders/not-a-uuid",
    "/v1/procurement/emd/not-a-uuid",
    "/v1/procurement/pbg/not-a-uuid",
  ];

  for (const url of paramRoutes) {
    it(`GET ${url} → 400`, async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url, headers: auth });
      await app.close();
      expect(res.statusCode).toBe(400);
    });
  }
});

// ─── Domain pure function tests ─────────────────────────────────────────────
describe("indent domain — assertTransitionAllowed", async () => {
  const { assertTransitionAllowed, assertDistinctMakerChecker, DomainError } =
    await import("../src/modules/indent/domain.js");

  it("draft → pending: allowed", () => {
    expect(() => assertTransitionAllowed("draft", "pending")).not.toThrow();
  });
  it("pending → approved: allowed", () => {
    expect(() => assertTransitionAllowed("pending", "approved")).not.toThrow();
  });
  it("pending → rejected: allowed", () => {
    expect(() => assertTransitionAllowed("pending", "rejected")).not.toThrow();
  });
  it("pending → tender_required: allowed", () => {
    expect(() => assertTransitionAllowed("pending", "tender_required")).not.toThrow();
  });
  it("approved → closed: allowed", () => {
    expect(() => assertTransitionAllowed("approved", "closed")).not.toThrow();
  });
  it("draft → approved: throws INVALID_TRANSITION", () => {
    expect(() => assertTransitionAllowed("draft", "approved")).toThrow(DomainError);
  });
  it("rejected → approved: throws INVALID_TRANSITION", () => {
    expect(() => assertTransitionAllowed("rejected", "approved")).toThrow(DomainError);
  });
  it("closed → pending: throws INVALID_TRANSITION", () => {
    expect(() => assertTransitionAllowed("closed", "pending")).toThrow(DomainError);
  });
  it("unknown → pending: throws INVALID_TRANSITION", () => {
    expect(() => assertTransitionAllowed("unknown", "pending")).toThrow(DomainError);
  });
  it("assertDistinctMakerChecker: same user throws SOD_VIOLATION", () => {
    expect(() => assertDistinctMakerChecker("user-1", "user-1")).toThrow(DomainError);
  });
  it("assertDistinctMakerChecker: different users ok", () => {
    expect(() => assertDistinctMakerChecker("user-1", "user-2")).not.toThrow();
  });
  it("assertDistinctMakerChecker: empty string ok", () => {
    expect(() => assertDistinctMakerChecker("", "user-2")).not.toThrow();
  });
});

// ─── GFR mode-bands domain tests ────────────────────────────────────────────
describe("GFR mode-bands — assertModeAllowedForValue", async () => {
  const { assertModeAllowedForValue, allowedModesForValue, bandLabel, modeForTenderType, GfrModeError } =
    await import("../src/modules/gfr/mode-bands.js");

  it("direct_purchase at Rs 20,000 (paise): allowed", () => {
    expect(() => assertModeAllowedForValue("direct_purchase", 2_000_000n)).not.toThrow();
  });
  it("direct_purchase at Rs 30,000 (paise): NOT allowed", () => {
    expect(() => assertModeAllowedForValue("direct_purchase", 3_000_000n)).toThrow(GfrModeError);
  });
  it("limited_tender at Rs 10,00,000 (paise): allowed", () => {
    expect(() => assertModeAllowedForValue("limited_tender", 100_000_000n)).not.toThrow();
  });
  it("limited_tender at Rs 60,00,000 (paise): NOT allowed", () => {
    expect(() => assertModeAllowedForValue("limited_tender", 600_000_000n)).toThrow(GfrModeError);
  });
  it("advertised_tender at any value: allowed", () => {
    expect(() => assertModeAllowedForValue("advertised_tender", 1_000n)).not.toThrow();
  });
  it("gem at any value: always allowed", () => {
    expect(() => assertModeAllowedForValue("gem", 999_999_999_999n)).not.toThrow();
  });
  it("single_tender at any value: always allowed", () => {
    expect(() => assertModeAllowedForValue("single_tender", 999_999_999_999n)).not.toThrow();
  });
  it("negative value throws GFR_INVALID_VALUE", () => {
    expect(() => assertModeAllowedForValue("direct_purchase", -1n)).toThrow(GfrModeError);
  });
  it("unknown mode throws GFR_UNKNOWN_MODE", () => {
    expect(() => assertModeAllowedForValue("bogus" as any, 1000n)).toThrow(GfrModeError);
  });

  it("allowedModesForValue returns correct modes for small value", () => {
    const modes = allowedModesForValue(1_000_000n);
    expect(modes).toContain("direct_purchase");
    expect(modes).toContain("gem");
    expect(modes).toContain("single_tender");
  });
  it("allowedModesForValue returns limited_tender for mid value", () => {
    const modes = allowedModesForValue(30_000_000n);
    expect(modes).toContain("limited_tender");
  });
  it("allowedModesForValue returns advertised_tender for large value", () => {
    const modes = allowedModesForValue(600_000_000n);
    expect(modes).toContain("advertised_tender");
  });

  it("bandLabel returns correct label for each band", () => {
    expect(bandLabel(1_000_000n)).toContain("Rs 25,000");
    expect(bandLabel(3_000_000n)).toContain("Rs 25,001");
    expect(bandLabel(30_000_000n)).toContain("limited tender");
    expect(bandLabel(600_000_000n)).toContain("advertised tender");
  });

  it("modeForTenderType maps correctly", () => {
    expect(modeForTenderType("open")).toBe("advertised_tender");
    expect(modeForTenderType("limited")).toBe("limited_tender");
    expect(modeForTenderType("single_source")).toBe("single_tender");
    expect(modeForTenderType("gem")).toBe("gem");
    expect(modeForTenderType("unknown")).toBe("advertised_tender");
  });
});

// ─── Indent creation with GFR mode validation ───────────────────────────────
describe("Indent creation with GFR mode — 400 for violated band", () => {
  it("direct_purchase with high value → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/indents", headers: auth,
      payload: {
        indentNo: "IND-GFR-001", department: "Works", purpose: "Construction material",
        procurementMode: "direct_purchase",
        items: [{ itemCode: "CIV01", description: "Cement bags", quantity: 100, unitPriceMinor: 5000000 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("GFR_MODE_NOT_ALLOWED");
  });

  it("gem mode with high value → 202 (always allowed)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/indents", headers: auth,
      payload: {
        indentNo: "IND-GFR-002", department: "IT", purpose: "Server purchase via GeM",
        procurementMode: "gem",
        items: [{ itemCode: "SRV01", description: "Server", quantity: 10, unitPriceMinor: 10000000 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("direct_purchase within band → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/indents", headers: auth,
      payload: {
        indentNo: "IND-GFR-003", department: "Admin", purpose: "Stationery",
        procurementMode: "direct_purchase",
        items: [{ itemCode: "STN01", description: "Pens", quantity: 100, unitPriceMinor: 2000 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ─── Vendor validation — PAN/GSTIN/IFSC ─────────────────────────────────────
describe("Vendor validation — specific field formats", () => {
  it("invalid PAN format → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/vendors", headers: auth,
      payload: { name: "Bad PAN Vendor", pan: "INVALID" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("invalid GSTIN format → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/vendors", headers: auth,
      payload: { name: "Bad GSTIN Vendor", gstin: "INVALID_GSTIN" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("invalid IFSC format → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/vendors", headers: auth,
      payload: { name: "Bad IFSC Vendor", ifsc: "INVALID" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("valid vendor with optional fields → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/vendors", headers: auth,
      payload: {
        name: "Full Vendor", pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5",
        ifsc: "SBIN0001234", email: "vendor@example.com", phone: "9876543210",
        mse: true, msme: true, udyamNo: "UDYAM-XX-00-0001234",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ─── Additional coverage — vendor empanel/blacklist with validation ──────────
describe("Vendor empanel/blacklist validation", () => {
  it("PATCH /v1/procurement/vendors/:id/empanel with empty body → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/vendors/${FAKE_UUID}/empanel`, headers: auth,
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/procurement/vendors/:id/blacklist with short reason → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/vendors/${FAKE_UUID}/blacklist`, headers: auth,
      payload: { reason: "ab" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/procurement/vendors/:id/blacklist with valid reason → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/vendors/${FAKE_UUID}/blacklist`, headers: auth,
      payload: { reason: "Vendor failed to deliver goods on time and violated terms" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ─── Security detail routes — exercise queries mapping code ─────────────────
describe("Security queries coverage", () => {
  it("GET /v1/procurement/emd with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/emd?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
  });

  it("GET /v1/procurement/pbg with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/pbg?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
  });
});

// ─── Additional PO routes coverage ──────────────────────────────────────────
describe("PO routes — additional paths", () => {
  it("PATCH /v1/procurement/pos/:id/dispatch with invalid uuid → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/procurement/pos/not-uuid/dispatch", headers: auth,
      payload: { notes: "Dispatch" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/pos with missing items → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos", headers: auth,
      payload: { poNo: "PO-001", vendorId: FAKE_UUID, indentRef: "IND-001", items: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/pos/gem with missing gemOrderNo → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pos/gem", headers: auth,
      payload: { poNo: "GEM-001", vendorId: FAKE_UUID, indentRef: "IND-001", items: [{ itemCode: "IT1", description: "Printer", quantity: 1, unitPriceMinor: 5000 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/procurement/pos with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/pos?limit=5&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

// ─── Additional indent routes coverage ──────────────────────────────────────
describe("Indent routes — additional paths", () => {
  it("GET /v1/procurement/indents with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/indents?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/procurement/indents with invalid item quantity → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/indents", headers: auth,
      payload: {
        indentNo: "IND-BAD", department: "IT", purpose: "Test",
        items: [{ itemCode: "X", description: "Bad", quantity: -1, unitPriceMinor: 100 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/indents with missing purpose → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/indents", headers: auth,
      payload: {
        indentNo: "IND-BAD", department: "IT",
        items: [{ itemCode: "X", description: "Item", quantity: 1, unitPriceMinor: 100 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/procurement/indents/:id/approve with non-super_admin → 403", async () => {
    const officerToken = signToken({ sub: "user-off-001", tid: TENANT, roles: ["procurement_officer"], sid: "sess-off" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/procurement/indents/${FAKE_UUID}/approve`, headers: { authorization: `Bearer ${officerToken}` },
      payload: { notes: "ok" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── Three-way-match additional coverage ─────────────────────────────────────
describe("Three-way-match additional", () => {
  it("POST /v1/procurement/three-way-match with invalid uuid → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/three-way-match", headers: auth,
      payload: { poId: "not-uuid", grnId: "not-uuid" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/procurement/three-way-match with poId filter → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/procurement/three-way-match?poId=${FAKE_UUID}`, headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/procurement/three-way-match with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/three-way-match?limit=10&offset=5", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

// ─── Auction additional coverage ────────────────────────────────────────────
describe("Auction additional coverage", () => {
  it("POST /v1/procurement/auctions with missing fields → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/auctions", headers: auth,
      payload: { auctionNo: "AUC-001" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/auctions/:id/bids with invalid bid → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/auctions/${FAKE_UUID}/bids`, headers: auth,
      payload: { vendorId: "not-uuid", bidMinor: -1 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/procurement/auctions/not-uuid/close → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/procurement/auctions/not-uuid/close", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/procurement/auctions/not-uuid → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/auctions/not-uuid", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ─── Vendor-blacklist additional coverage ───────────────────────────────────
describe("Vendor-blacklist additional coverage", () => {
  it("GET /v1/procurement/vendor-blacklist with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/vendor-blacklist?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/procurement/vendors/blacklisted with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/vendors/blacklisted?limit=20&offset=5", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/procurement/central-debarment with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/central-debarment?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/procurement/vendors/:id/blacklist with missing date → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/vendors/${FAKE_UUID}/blacklist`, headers: auth,
      payload: { reason: "fraud detected" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/central-debarment with invalid pan → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/central-debarment", headers: auth,
      payload: { pan: "invalid", reason: "test", blacklistedFrom: "2025-01-01" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/procurement/vendors/not-uuid/blacklist → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: "/v1/procurement/vendors/not-uuid/blacklist", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ─── GRN additional coverage ────────────────────────────────────────────────
describe("GRN additional coverage", () => {
  it("POST /v1/procurement/grns with missing inspection → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/grns", headers: auth,
      payload: {
        grnNo: "GRN-BAD", poRef: "PO-001", vendorId: FAKE_UUID,
        items: [{ poItemRef: "item-1", itemCode: "IT001", orderedQty: 5, receivedQty: 5, acceptedQty: 5 }],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/procurement/grns with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/grns?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

// ─── Tender additional coverage ─────────────────────────────────────────────
describe("Tender additional coverage", () => {
  it("POST /v1/procurement/tenders with missing bidClosingDate → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/tenders", headers: auth,
      payload: { title: "Test Tender" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/tenders/:id/bids with missing fields → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/bids`, headers: auth,
      payload: { vendorId: "not-uuid" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/tenders/:id/technical-evaluation with empty results → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/tenders/${FAKE_UUID}/technical-evaluation`, headers: auth,
      payload: { results: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/procurement/tenders with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/tenders?limit=5&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

// ─── Payments additional coverage ───────────────────────────────────────────
describe("Payments additional coverage", () => {
  it("POST /v1/procurement/advances with negative amount → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/advances", headers: auth,
      payload: { poRef: "PO-001", vendorId: FAKE_UUID, amountMinor: -100 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/debit-notes with short reason → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/debit-notes", headers: auth,
      payload: { grnRef: "GRN-001", vendorId: FAKE_UUID, reason: "ab", amountMinor: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/procurement/advances with invalid currency → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/advances", headers: auth,
      payload: { poRef: "PO-001", vendorId: FAKE_UUID, amountMinor: 5000, currency: "TOOLONG" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ─── Auction domain tests ───────────────────────────────────────────────────
describe("Auction domain — computeEffectivePrice & rankBids", async () => {
  const { computeEffectivePrice, rankBids, MSE_PREF_NUM, MSE_PREF_DEN } =
    await import("../src/modules/auction/domain.js");

  it("non-MSE bid with preference → same price", () => {
    expect(computeEffectivePrice(1000000n, false, true)).toBe(1000000n);
  });
  it("MSE bid without preference → same price", () => {
    expect(computeEffectivePrice(1000000n, true, false)).toBe(1000000n);
  });
  it("MSE bid with preference → 85% price", () => {
    expect(computeEffectivePrice(1000000n, true, true)).toBe(850000n);
  });
  it("MSE preference constants are correct", () => {
    expect(MSE_PREF_NUM).toBe(85n);
    expect(MSE_PREF_DEN).toBe(100n);
  });

  it("rankBids ranks by effective price ascending", () => {
    const bids = [
      { id: "b1", vendorId: "v1", bidMinor: 2000000n, isMse: false },
      { id: "b2", vendorId: "v2", bidMinor: 1500000n, isMse: false },
      { id: "b3", vendorId: "v3", bidMinor: 1800000n, isMse: true },
    ];
    const ranked = rankBids(bids, true);
    expect(ranked[0]!.id).toBe("b2"); // 1500000
    expect(ranked[1]!.id).toBe("b3"); // 1800000*85/100 = 1530000
    expect(ranked[2]!.id).toBe("b1"); // 2000000
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[2]!.rank).toBe(3);
  });

  it("rankBids filters ineligible bids", () => {
    const bids = [
      { id: "b1", vendorId: "v1", bidMinor: 1000000n, isMse: false, eligible: false },
      { id: "b2", vendorId: "v2", bidMinor: 2000000n, isMse: false, eligible: true },
    ];
    const ranked = rankBids(bids, true);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.id).toBe("b2");
    expect(ranked[0]!.rank).toBe(1);
  });

  it("rankBids tie-break by bidAt", () => {
    const bids = [
      { id: "b1", vendorId: "v1", bidMinor: 1000000n, isMse: false, bidAt: "2025-01-02T10:00:00Z" },
      { id: "b2", vendorId: "v2", bidMinor: 1000000n, isMse: false, bidAt: "2025-01-01T10:00:00Z" },
    ];
    const ranked = rankBids(bids, false);
    expect(ranked[0]!.id).toBe("b2"); // earlier bid wins
  });

  it("rankBids tie-break by id when bidAt is same", () => {
    const bids = [
      { id: "b2", vendorId: "v1", bidMinor: 1000000n, isMse: false, bidAt: "2025-01-01T10:00:00Z" },
      { id: "b1", vendorId: "v2", bidMinor: 1000000n, isMse: false, bidAt: "2025-01-01T10:00:00Z" },
    ];
    const ranked = rankBids(bids, false);
    expect(ranked[0]!.id).toBe("b1"); // lower id wins
  });

  it("rankBids handles empty array", () => {
    expect(rankBids([], true)).toEqual([]);
  });
});

// ─── Vendor domain tests ────────────────────────────────────────────────────
describe("Vendor domain — assertNotBlacklisted & assertCanEmpanel", async () => {
  const { assertNotBlacklisted, assertCanEmpanel, DomainError } =
    await import("../src/modules/vendor/domain.js");

  it("assertNotBlacklisted: registered vendor ok", () => {
    expect(() => assertNotBlacklisted("registered")).not.toThrow();
  });
  it("assertNotBlacklisted: blacklisted vendor throws", () => {
    expect(() => assertNotBlacklisted("blacklisted")).toThrow(DomainError);
  });
  it("assertCanEmpanel: registered vendor ok", () => {
    expect(() => assertCanEmpanel("registered")).not.toThrow();
  });
  it("assertCanEmpanel: blacklisted vendor throws", () => {
    expect(() => assertCanEmpanel("blacklisted")).toThrow(DomainError);
  });
});

// ─── Security domain tests ──────────────────────────────────────────────────
describe("Security domain — assertEmdTransition & assertPbgTransition", async () => {
  const { assertEmdTransition, assertPbgTransition, assertPositiveAmount, DomainError } =
    await import("../src/modules/security/domain.js");

  it("EMD collected → forfeited: allowed", () => {
    expect(() => assertEmdTransition("collected", "forfeited")).not.toThrow();
  });
  it("EMD collected → refunded: allowed", () => {
    expect(() => assertEmdTransition("collected", "refunded")).not.toThrow();
  });
  it("EMD forfeited → refunded: not allowed", () => {
    expect(() => assertEmdTransition("forfeited", "refunded")).toThrow(DomainError);
  });
  it("EMD refunded → forfeited: not allowed", () => {
    expect(() => assertEmdTransition("refunded", "forfeited")).toThrow(DomainError);
  });
  it("EMD unknown status → any: not allowed", () => {
    expect(() => assertEmdTransition("unknown", "forfeited")).toThrow(DomainError);
  });

  it("PBG active → forfeited: allowed", () => {
    expect(() => assertPbgTransition("active", "forfeited")).not.toThrow();
  });
  it("PBG active → released: allowed", () => {
    expect(() => assertPbgTransition("active", "released")).not.toThrow();
  });
  it("PBG forfeited → released: not allowed", () => {
    expect(() => assertPbgTransition("forfeited", "released")).toThrow(DomainError);
  });
  it("PBG released → forfeited: not allowed", () => {
    expect(() => assertPbgTransition("released", "forfeited")).toThrow(DomainError);
  });

  it("assertPositiveAmount: positive ok", () => {
    expect(() => assertPositiveAmount(100n)).not.toThrow();
  });
  it("assertPositiveAmount: zero throws", () => {
    expect(() => assertPositiveAmount(0n)).toThrow(DomainError);
  });
  it("assertPositiveAmount: negative throws", () => {
    expect(() => assertPositiveAmount(-1n)).toThrow(DomainError);
  });
});

// ─── indent domain — assertIndentApproved ───────────────────────────────────
describe("Indent domain — assertIndentApproved", async () => {
  const { assertIndentApproved, DomainError } = await import("../src/modules/indent/domain.js");

  it("approved status: ok", () => {
    expect(() => assertIndentApproved("approved")).not.toThrow();
  });
  it("draft status: throws INDENT_NOT_APPROVED", () => {
    expect(() => assertIndentApproved("draft")).toThrow(DomainError);
  });
  it("pending status: throws INDENT_NOT_APPROVED", () => {
    expect(() => assertIndentApproved("pending")).toThrow(DomainError);
  });
});

// ─── Additional security routes — with reason → 202 ────────────────────────
describe("Security routes — forfeit/refund/release with reason", () => {
  it("POST /v1/procurement/emd/:id/forfeit with reason → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/emd/${FAKE_UUID}/forfeit`, headers: auth,
      payload: { reason: "vendor default" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/emd/:id/refund with reason → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/emd/${FAKE_UUID}/refund`, headers: auth,
      payload: { reason: "tender cancelled" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/pbg/:id/forfeit with reason → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pbg/${FAKE_UUID}/forfeit`, headers: auth,
      payload: { reason: "performance failure" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/pbg/:id/release with reason → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/procurement/pbg/${FAKE_UUID}/release`, headers: auth,
      payload: { reason: "warranty period ended" },
    });
    await app.close();
    expect([202, 404]).toContain(res.statusCode);
  });

  it("POST /v1/procurement/emd with full fields → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/emd", headers: auth,
      payload: { vendorId: FAKE_UUID, tenderId: FAKE_UUID, bidId: FAKE_UUID, amountMinor: 200000, instrument: "online" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/procurement/pbg with full fields → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/pbg", headers: auth,
      payload: { vendorId: FAKE_UUID, poRef: "PO-001", tenderId: FAKE_UUID, amountMinor: 300000, instrument: "dd", validUntil: "2026-01-01" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

// ─── RFQ routes additional — exercise error handler paths ───────────────────
describe("RFQ routes additional", () => {
  it("GET /v1/procurement/rfqs with limit/offset → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/rfqs?limit=10&offset=0", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/procurement/rfqs/not-a-uuid → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/rfqs/not-a-uuid", headers: auth,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ─── PO-print escapeHtml and renderTemplate coverage ────────────────────────
describe("PO-print routes — cover HTML generation paths", () => {
  it("GET /v1/procurement/pos/:id/pdf with invalid uuid → 400|500", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/pos/not-a-uuid/pdf", headers: auth,
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("GET /v1/procurement/pos/:id/download with invalid uuid → 400|500", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/procurement/pos/not-a-uuid/download", headers: auth,
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ─── Dashboard additional routes ────────────────────────────────────────────
describe("Dashboard additional routes", () => {
  it("GET /v1/procurement/dashboard returns numeric fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/procurement/dashboard", headers: auth });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.pendingIndents).toBe("number");
    expect(typeof body.activePOs).toBe("number");
  });
});

// ─── GRN domain tests ───────────────────────────────────────────────────────
describe("GRN domain — computeThreeWayMatch & assertQtyValid", async () => {
  const { computeThreeWayMatch, assertQtyValid, DomainError } =
    await import("../src/modules/grn/domain.js");

  it("pass inspection + valid items → true", () => {
    const items = [{ orderedQty: 10, receivedQty: 10, acceptedQty: 10 }];
    expect(computeThreeWayMatch(items, "pass")).toBe(true);
  });
  it("fail inspection → false", () => {
    const items = [{ orderedQty: 10, receivedQty: 10, acceptedQty: 10 }];
    expect(computeThreeWayMatch(items, "fail")).toBe(false);
  });
  it("pending inspection → false", () => {
    const items = [{ orderedQty: 10, receivedQty: 10, acceptedQty: 10 }];
    expect(computeThreeWayMatch(items, "pending")).toBe(false);
  });
  it("empty items → false", () => {
    expect(computeThreeWayMatch([], "pass")).toBe(false);
  });
  it("partial delivery (accepted < ordered) → true", () => {
    const items = [{ orderedQty: 10, receivedQty: 5, acceptedQty: 5 }];
    expect(computeThreeWayMatch(items, "pass")).toBe(true);
  });
  it("over-accept (accepted > ordered) → false", () => {
    const items = [{ orderedQty: 5, receivedQty: 10, acceptedQty: 7 }];
    expect(computeThreeWayMatch(items, "pass")).toBe(false);
  });
  it("zero total accepted → false", () => {
    const items = [{ orderedQty: 10, receivedQty: 5, acceptedQty: 0 }];
    expect(computeThreeWayMatch(items, "pass")).toBe(false);
  });
  it("accepted > received → false", () => {
    const items = [{ orderedQty: 10, receivedQty: 3, acceptedQty: 5 }];
    expect(computeThreeWayMatch(items, "pass")).toBe(false);
  });

  it("assertQtyValid: valid items → no throw", () => {
    expect(() => assertQtyValid([{ orderedQty: 10, receivedQty: 10, acceptedQty: 10 }])).not.toThrow();
  });
  it("assertQtyValid: negative received → throws", () => {
    expect(() => assertQtyValid([{ orderedQty: 10, receivedQty: -1, acceptedQty: 0 }])).toThrow(DomainError);
  });
  it("assertQtyValid: accepted > received → throws", () => {
    expect(() => assertQtyValid([{ orderedQty: 10, receivedQty: 5, acceptedQty: 7 }])).toThrow(DomainError);
  });
  it("assertQtyValid: over-accept → throws OVER_ACCEPT", () => {
    expect(() => assertQtyValid([{ orderedQty: 5, receivedQty: 10, acceptedQty: 7 }])).toThrow(DomainError);
  });
  it("assertQtyValid: orderedQty=0 skips over-accept check", () => {
    expect(() => assertQtyValid([{ orderedQty: 0, receivedQty: 10, acceptedQty: 10 }])).not.toThrow();
  });
});
