/**
 * Stock Service — Comprehensive Domain + Route Tests.
 * Source: modules/entry/domain.ts, routes
 */
import { describe, it, expect, afterAll } from "vitest";
import { weightedAvgRate, assertStockNotNegative, voucherTypeForEntry, DomainError, type ValuationState, type EntryType } from "../src/modules/entry/domain.js";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "ee880001-8888-4000-8000-000000st001";
const ACTOR = "ee88aaaa-8888-4000-8000-000000st00a";
function token(roles: string[]) { return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600); }
const storeAdmin = () => ({ authorization: `Bearer ${token(["store_admin"])}` });
const unrelated = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ ENTRY DOMAIN ═══

describe("weightedAvgRate — comprehensive bigint arithmetic", () => {
  it("first receipt sets rate directly", () => expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 100, 5000n)).toBe(5000n));
  it("blends 50:50", () => expect(weightedAvgRate({ qty: 100, rateMinor: 5000n }, 100, 7000n)).toBe(6000n));
  it("blends 2:1 weight", () => expect(weightedAvgRate({ qty: 200, rateMinor: 5000n }, 100, 8000n)).toBe(6000n));
  it("zero combined qty → 0", () => expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 0, 5000n)).toBe(0n));
  it("floor division (no float)", () => expect(weightedAvgRate({ qty: 3, rateMinor: 1000n }, 4, 2000n)).toBe(1571n)); // (3000+8000)/7=1571
  it("large values stay precise", () => {
    const r = weightedAvgRate({ qty: 10000, rateMinor: 99999n }, 5000, 100001n);
    expect(r).toBe(99999n); // (999990000+500005000)/15000 = 99999.666... → 99999
  });
});

describe("assertStockNotNegative — guard", () => {
  it("passes at exact qty", () => expect(() => assertStockNotNegative(10, 10)).not.toThrow());
  it("passes below", () => expect(() => assertStockNotNegative(100, 50)).not.toThrow());
  it("throws INSUFFICIENT_STOCK", () => expect(() => assertStockNotNegative(5, 6)).toThrow("INSUFFICIENT_STOCK"));
  it("throws for zero stock with any issue", () => expect(() => assertStockNotNegative(0, 1)).toThrow(DomainError));
});

describe("voucherTypeForEntry — all entry types", () => {
  it("receipt → receipt", () => expect(voucherTypeForEntry("receipt", "to")).toBe("receipt"));
  it("issue → issue", () => expect(voucherTypeForEntry("issue", "from")).toBe("issue"));
  it("transfer from → transfer_out", () => expect(voucherTypeForEntry("transfer", "from")).toBe("transfer_out"));
  it("transfer to → transfer_in", () => expect(voucherTypeForEntry("transfer", "to")).toBe("transfer_in"));
  it("adjustment → adjustment", () => expect(voucherTypeForEntry("adjustment", "from")).toBe("adjustment"));
});

// ═══ ROUTE RBAC ═══

describe("POST /v1/stock/entries — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/stock/entries", payload: {} }); await app.close(); expect(r.statusCode).toBe(401);
  });
  it("403 for employee", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/stock/entries", headers: unrelated(), payload: { itemId: "x", qty: 1 } }); await app.close(); expect(r.statusCode).toBe(403);
  });
  it("400 for missing body with super_admin", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "POST", url: "/v1/stock/entries", headers: { authorization: `Bearer ${token(["super_admin"])}` }, payload: {} }); await app.close(); expect(r.statusCode).toBe(400);
  });
});

describe("GET /v1/stock/dashboard — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "GET", url: "/v1/stock/dashboard" }); await app.close(); expect(r.statusCode).toBe(401);
  });
  it("403 for employee", async () => {
    const app = await buildApp(); const r = await app.inject({ method: "GET", url: "/v1/stock/dashboard", headers: unrelated() }); await app.close(); expect(r.statusCode).toBe(403);
  });
});
