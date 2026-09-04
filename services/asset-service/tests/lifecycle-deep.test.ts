/**
 * Asset Service — Lifecycle Domain + Validators: Deep tests.
 *
 * Tests transfer eligibility, disposal guards, gain/loss computation,
 * and input validators for transfer/dispose operations.
 *
 * Source: modules/lifecycle/domain.ts, modules/lifecycle/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  assertAssetTransferable, assertAssetDisposable, computeDisposalGainLoss, DomainError,
} from "../src/modules/lifecycle/domain.js";
import { transferBody, disposeBody, idParam } from "../src/modules/lifecycle/validators.js";

// ═══ Domain Logic ═══

describe("assertAssetTransferable", () => {
  it("passes for active assets", () => {
    expect(() => assertAssetTransferable("active")).not.toThrow();
  });
  it("throws ASSET_NOT_TRANSFERABLE for disposed", () => {
    expect(() => assertAssetTransferable("disposed")).toThrow("ASSET_NOT_TRANSFERABLE");
  });
  it("throws for written_off", () => {
    expect(() => assertAssetTransferable("written_off")).toThrow("ASSET_NOT_TRANSFERABLE");
  });
  it("throws for impaired", () => {
    expect(() => assertAssetTransferable("impaired")).toThrow("ASSET_NOT_TRANSFERABLE");
  });
  it("throws ASSET_NOT_TRANSFERABLE for under_maintenance", () => {
    // An asset being serviced is physically unavailable for handover; it must
    // not be transferable until it is back to "active".
    expect(() => assertAssetTransferable("under_maintenance")).toThrow("ASSET_NOT_TRANSFERABLE");
  });
  it("throws for draft", () => {
    expect(() => assertAssetTransferable("draft")).toThrow(DomainError);
  });
});

describe("assertAssetDisposable", () => {
  it("passes for active (can be disposed)", () => {
    expect(() => assertAssetDisposable("active")).not.toThrow();
  });
  it("passes for impaired (can still be disposed)", () => {
    expect(() => assertAssetDisposable("impaired")).not.toThrow();
  });
  it("throws ASSET_ALREADY_DISPOSED for disposed", () => {
    expect(() => assertAssetDisposable("disposed")).toThrow("ASSET_ALREADY_DISPOSED");
  });
  it("throws for written_off", () => {
    expect(() => assertAssetDisposable("written_off")).toThrow("ASSET_ALREADY_DISPOSED");
  });
});

describe("computeDisposalGainLoss — bigint arithmetic", () => {
  it("gain when proceeds > book value", () => {
    expect(computeDisposalGainLoss(500000n, 300000n)).toBe(200000n);
  });
  it("loss when proceeds < book value", () => {
    expect(computeDisposalGainLoss(100000n, 500000n)).toBe(-400000n);
  });
  it("zero when proceeds = book value", () => {
    expect(computeDisposalGainLoss(300000n, 300000n)).toBe(0n);
  });
  it("full loss when proceeds are zero (scrap)", () => {
    expect(computeDisposalGainLoss(0n, 1000000n)).toBe(-1000000n);
  });
});

// ═══ Validators ═══

describe("transferBody — asset transfer validation", () => {
  const valid = { fromLocation: "Building A", toLocation: "Building B", transferDate: "2026-08-01" };

  it("accepts valid transfer", () => expect(transferBody.safeParse(valid).success).toBe(true));
  it("rejects empty fromLocation", () => expect(transferBody.safeParse({ ...valid, fromLocation: "" }).success).toBe(false));
  it("rejects empty toLocation", () => expect(transferBody.safeParse({ ...valid, toLocation: "" }).success).toBe(false));
  it("rejects invalid date", () => expect(transferBody.safeParse({ ...valid, transferDate: "bad" }).success).toBe(false));
  it("notes are optional", () => expect(transferBody.safeParse(valid).success).toBe(true));
});

describe("disposeBody — asset disposal validation", () => {
  const valid = { disposalDate: "2026-08-15" };

  it("accepts minimal disposal", () => expect(disposeBody.safeParse(valid).success).toBe(true));
  it("rejects invalid date", () => expect(disposeBody.safeParse({ disposalDate: "bad" }).success).toBe(false));
  it("rejects negative proceeds", () => expect(disposeBody.safeParse({ ...valid, proceedsMinor: -1 }).success).toBe(false));
  it("rejects non-3-char currency", () => expect(disposeBody.safeParse({ ...valid, currency: "IN" }).success).toBe(false));
  it("defaults: method=sale, proceeds=0, currency=INR", () => {
    const result = disposeBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disposalMethod).toBe("sale");
      expect(result.data.proceedsMinor).toBe(0);
      expect(result.data.currency).toBe("INR");
    }
  });
});

describe("idParam", () => {
  it("accepts UUID", () => expect(idParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true));
  it("rejects non-UUID", () => expect(idParam.safeParse({ id: "bad" }).success).toBe(false));
});
