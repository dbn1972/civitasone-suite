import { describe, it, expect } from "vitest";
import {
  computeValueSize,
  wouldExceedQuota,
  getQuotaBytes,
  remainingQuotaBytes,
} from "../src/modules/store/domain.js";
import { STORE_QUOTA_BYTES } from "../src/modules/store/schema.js";

describe("Plugin Store Domain Logic", () => {
  describe("computeValueSize", () => {
    it("computes size of a simple string value", () => {
      const size = computeValueSize("hello");
      // JSON.stringify("hello") = '"hello"' = 7 bytes
      expect(size).toBe(7);
    });

    it("computes size of a number value", () => {
      const size = computeValueSize(42);
      // JSON.stringify(42) = '42' = 2 bytes
      expect(size).toBe(2);
    });

    it("computes size of a complex object", () => {
      const obj = { name: "test", count: 5, nested: { a: 1 } };
      const serialized = JSON.stringify(obj);
      expect(computeValueSize(obj)).toBe(Buffer.byteLength(serialized, "utf8"));
    });

    it("computes size of null value", () => {
      const size = computeValueSize(null);
      // JSON.stringify(null) = 'null' = 4 bytes
      expect(size).toBe(4);
    });

    it("computes size of empty object", () => {
      const size = computeValueSize({});
      // JSON.stringify({}) = '{}' = 2 bytes
      expect(size).toBe(2);
    });

    it("computes size of an array value", () => {
      const arr = [1, 2, 3];
      const serialized = JSON.stringify(arr);
      expect(computeValueSize(arr)).toBe(Buffer.byteLength(serialized, "utf8"));
    });

    it("handles unicode characters correctly", () => {
      const value = "こんにちは"; // Japanese characters
      const serialized = JSON.stringify(value);
      expect(computeValueSize(value)).toBe(Buffer.byteLength(serialized, "utf8"));
    });
  });

  describe("wouldExceedQuota", () => {
    it("returns false when well under quota", () => {
      expect(wouldExceedQuota(1000, 0, 500)).toBe(false);
    });

    it("returns false when exactly at quota", () => {
      // Current usage 100MB - existing 10 bytes + new 10 bytes = 100MB exactly
      expect(wouldExceedQuota(STORE_QUOTA_BYTES - 10, 10, 10)).toBe(false);
    });

    it("returns true when exceeding quota with new key", () => {
      // Current 100MB + 1 byte over = exceeds
      expect(wouldExceedQuota(STORE_QUOTA_BYTES, 0, 1)).toBe(true);
    });

    it("returns false when replacing existing key with smaller value", () => {
      // Current is at quota, but we are replacing a 1000-byte entry with 500 bytes
      expect(wouldExceedQuota(STORE_QUOTA_BYTES, 1000, 500)).toBe(false);
    });

    it("returns true when replacing existing key with larger value that exceeds quota", () => {
      // Current is at quota-1, existing is 10, new is 12 → net +2, exceeds by 1
      expect(wouldExceedQuota(STORE_QUOTA_BYTES - 1, 10, 12)).toBe(true);
    });

    it("accounts for existing key bytes when updating", () => {
      const currentUsage = STORE_QUOTA_BYTES - 100;
      // Existing key is 200 bytes, new value is 250 bytes
      // Net change: -200 + 250 = +50. Projected: QUOTA-100+50 = QUOTA-50, under quota
      expect(wouldExceedQuota(currentUsage, 200, 250)).toBe(false);
    });
  });

  describe("getQuotaBytes", () => {
    it("returns 100MB in bytes", () => {
      expect(getQuotaBytes()).toBe(100 * 1024 * 1024);
    });

    it("matches STORE_QUOTA_BYTES constant", () => {
      expect(getQuotaBytes()).toBe(STORE_QUOTA_BYTES);
    });
  });

  describe("remainingQuotaBytes", () => {
    it("returns full quota when usage is zero", () => {
      expect(remainingQuotaBytes(0)).toBe(STORE_QUOTA_BYTES);
    });

    it("returns zero when usage equals quota", () => {
      expect(remainingQuotaBytes(STORE_QUOTA_BYTES)).toBe(0);
    });

    it("returns correct difference for partial usage", () => {
      expect(remainingQuotaBytes(1000)).toBe(STORE_QUOTA_BYTES - 1000);
    });

    it("returns zero when usage exceeds quota (should not happen, but safe)", () => {
      expect(remainingQuotaBytes(STORE_QUOTA_BYTES + 100)).toBe(0);
    });
  });
});
