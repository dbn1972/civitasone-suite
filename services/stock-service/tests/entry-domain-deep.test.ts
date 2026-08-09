/**
 * Stock Service — Entry Domain: Deep tests.
 * Source: modules/entry/domain.ts
 */
import { describe, it, expect } from "vitest";
import { weightedAvgRate, assertStockNotNegative, voucherTypeForEntry, DomainError, type ValuationState } from "../src/modules/entry/domain.js";

describe("weightedAvgRate — bigint WAVG", () => {
  it("first receipt sets rate", () => expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 100, 5000n)).toBe(5000n));
  it("blends existing + receipt", () => expect(weightedAvgRate({ qty: 100, rateMinor: 5000n }, 100, 7000n)).toBe(6000n));
  it("zero combined qty returns 0", () => expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 0, 5000n)).toBe(0n));
  it("floor division (no float)", () => expect(weightedAvgRate({ qty: 10, rateMinor: 1001n }, 10, 1000n)).toBe(1000n));
});

describe("assertStockNotNegative", () => {
  it("passes when available >= issue", () => expect(() => assertStockNotNegative(100, 50)).not.toThrow());
  it("passes at exact qty", () => expect(() => assertStockNotNegative(10, 10)).not.toThrow());
  it("throws INSUFFICIENT_STOCK", () => expect(() => assertStockNotNegative(5, 6)).toThrow("INSUFFICIENT_STOCK"));
});

describe("voucherTypeForEntry", () => {
  it("receipt → receipt", () => expect(voucherTypeForEntry("receipt", "to")).toBe("receipt"));
  it("issue → issue", () => expect(voucherTypeForEntry("issue", "from")).toBe("issue"));
  it("transfer from → transfer_out", () => expect(voucherTypeForEntry("transfer", "from")).toBe("transfer_out"));
  it("transfer to → transfer_in", () => expect(voucherTypeForEntry("transfer", "to")).toBe("transfer_in"));
  it("adjustment → adjustment", () => expect(voucherTypeForEntry("adjustment", "from")).toBe("adjustment"));
});
