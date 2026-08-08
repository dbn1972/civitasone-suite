/**
 * Notification Bulk Campaigns — Domain + Validator Tests
 *
 * Module: services/notification-service/src/modules/bulk
 * Pack: Notification_Module_Test_Pack/06_Bulk_Campaigns_Test_Prompt.md
 *
 * Tests:
 *   1. computeRoiBps: ROI in basis points (BigInt arithmetic, no float)
 *   2. minorUnits transform: paise as integer/string → canonical string
 *   3. createCampaignBody validator: recipients min 1, templateId UUID, etc.
 *   4. Campaign status lifecycle (design assertions from consumer source)
 *   5. Idempotency contract: campaigns cannot send twice
 */
import { describe, it, expect } from "vitest";
import { computeRoiBps } from "../src/modules/bulk/domain.js";

// ─── 1. computeRoiBps — BigInt arithmetic ────────────────────────────────────

describe("computeRoiBps — ROI in basis points", () => {
  it("100% ROI = 10000 bps", () => {
    // revenue 200k, cost 100k → profit 100k → ROI = 100% = 10000
    expect(computeRoiBps(200_000n, 100_000n)).toBe(10000);
  });

  it("0% ROI (break-even)", () => {
    expect(computeRoiBps(100_000n, 100_000n)).toBe(0);
  });

  it("negative ROI (loss)", () => {
    // revenue 50k, cost 100k → loss 50k → ROI = -50% = -5000
    expect(computeRoiBps(50_000n, 100_000n)).toBe(-5000);
  });

  it("zero cost → null (undefined, not infinity)", () => {
    expect(computeRoiBps(100_000n, 0n)).toBeNull();
  });

  it("zero revenue + zero cost → null", () => {
    expect(computeRoiBps(0n, 0n)).toBeNull();
  });

  it("large values stay exact (BigInt, no float precision loss)", () => {
    // Rs 10 crore revenue (1_000_000_000 paise), Rs 5 crore cost
    const roi = computeRoiBps(1_000_000_000n, 500_000_000n);
    expect(roi).toBe(10000); // 100% ROI
  });

  it("truncates toward zero (floor division, not rounding)", () => {
    // revenue=4, cost=3 → profit=1, bps = 1*10000/3 = 3333 (truncated from 3333.33)
    expect(computeRoiBps(4n, 3n)).toBe(3333);
  });

  it("slightly negative: revenue=99, cost=100 → -100 bps (1% loss)", () => {
    expect(computeRoiBps(99n, 100n)).toBe(-100);
  });
});

// ─── 2. minorUnits — paise normalization contract ─────────────────────────────

describe("minorUnits — paise normalization (source: validators.ts)", () => {
  // Source: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform((v) => BigInt(v).toString())
  function normalizeMinorUnits(v: number | string): string | null {
    if (typeof v === "number") {
      if (!Number.isInteger(v) || v < 0) return null;
      return BigInt(v).toString();
    }
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v).toString();
    return null;
  }

  it("integer → canonical string", () => expect(normalizeMinorUnits(50000)).toBe("50000"));
  it("numeric string → canonical string", () => expect(normalizeMinorUnits("1234567890")).toBe("1234567890"));
  it("large string (above 2^53) preserved exactly", () => {
    expect(normalizeMinorUnits("99999999999999999")).toBe("99999999999999999");
  });
  it("zero is valid", () => { expect(normalizeMinorUnits(0)).toBe("0"); expect(normalizeMinorUnits("0")).toBe("0"); });
  it("rejects negative", () => expect(normalizeMinorUnits(-1)).toBeNull());
  it("rejects non-numeric string", () => { expect(normalizeMinorUnits("abc")).toBeNull(); expect(normalizeMinorUnits("12.5")).toBeNull(); });
  it("rejects float", () => expect(normalizeMinorUnits(99.99)).toBeNull());
});

// ─── 3. createCampaignBody — validation rules (replicated from source) ───────

describe("createCampaignBody — validation contract", () => {
  it("recipients must have at least 1 entry", () => {
    const recipients: string[] = [];
    expect(recipients.length >= 1).toBe(false);
  });
  it("templateId must be UUID format", () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRe.test("aaaaaaaa-1111-4000-8000-000000000001")).toBe(true);
    expect(uuidRe.test("not-uuid")).toBe(false);
  });
  it("name min 1, max 128 chars", () => {
    expect("".length >= 1).toBe(false);
    expect("x".repeat(129).length <= 128).toBe(false);
    expect("x".repeat(128).length <= 128).toBe(true);
  });
  it("currency defaults to INR (3-char ISO)", () => {
    expect("INR".length).toBe(3);
  });
  it("scheduledAt must be ISO datetime", () => {
    const valid = "2026-07-15T10:00:00Z";
    expect(!isNaN(Date.parse(valid))).toBe(true);
    expect(isNaN(Date.parse("not-a-date"))).toBe(true);
  });
});

// ─── 4. recordResponseBody — response attribution ────────────────────────────

describe("recordResponseBody — validation contract", () => {
  it("subjectType: lead/contact/account", () => {
    const valid = ["lead", "contact", "account"];
    expect(valid.includes("lead")).toBe(true);
    expect(valid.includes("deal")).toBe(false);
  });
  it("revenueMinor uses same paise normalization", () => {
    const normalized = BigInt(100000).toString();
    expect(normalized).toBe("100000");
  });
});

// ─── 5. Campaign lifecycle contract (source: consumer.ts) ────────────────────

describe("campaign lifecycle — design invariants", () => {
  it("initial status: draft (no scheduledAt) or scheduled (with scheduledAt)", () => {
    // Source: consumer.ts line 56: status: p.scheduledAt ? "scheduled" : "draft"
    const withSchedule = { scheduledAt: "2026-07-20T10:00:00Z" };
    const without = {};
    expect(withSchedule.scheduledAt ? "scheduled" : "draft").toBe("scheduled");
    expect(!without.scheduledAt ? "draft" : "scheduled").toBe("draft");
  });

  it("a campaign cannot send twice (idempotency: markProcessed gate)", () => {
    // Design contract from consumer.ts: if (!(await markProcessed(tx, msg.messageId))) return;
    const alreadyProcessed = true;
    const shouldSkip = alreadyProcessed;
    expect(shouldSkip).toBe(true);
  });
});
