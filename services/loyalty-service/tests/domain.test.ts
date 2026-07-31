/**
 * Domain logic unit tests for loyalty-service.
 * Covers programs, enrolments, accruals, redemptions, and tiers domain functions.
 */
import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRAMS DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════
import {
  isValidTransition as programTransition,
  canEdit,
  validateProgram,
  validateTierThresholds,
} from "../src/modules/programs/domain.js";

describe("programs/domain", () => {
  describe("isValidTransition", () => {
    it("allows draft → active", () => {
      expect(programTransition("draft", "active")).toBe(true);
    });
    it("allows draft → archived", () => {
      expect(programTransition("draft", "archived")).toBe(true);
    });
    it("allows active → suspended", () => {
      expect(programTransition("active", "suspended")).toBe(true);
    });
    it("allows active → archived", () => {
      expect(programTransition("active", "archived")).toBe(true);
    });
    it("allows suspended → active", () => {
      expect(programTransition("suspended", "active")).toBe(true);
    });
    it("allows suspended → archived", () => {
      expect(programTransition("suspended", "archived")).toBe(true);
    });
    it("disallows archived → active", () => {
      expect(programTransition("archived", "active")).toBe(false);
    });
    it("disallows draft → suspended", () => {
      expect(programTransition("draft", "suspended")).toBe(false);
    });
    it("disallows archived → draft", () => {
      expect(programTransition("archived", "draft")).toBe(false);
    });
  });

  describe("canEdit", () => {
    it("returns true for draft", () => {
      expect(canEdit("draft")).toBe(true);
    });
    it("returns true for active", () => {
      expect(canEdit("active")).toBe(true);
    });
    it("returns false for suspended", () => {
      expect(canEdit("suspended")).toBe(false);
    });
    it("returns false for archived", () => {
      expect(canEdit("archived")).toBe(false);
    });
  });

  describe("validateProgram", () => {
    it("validates valid program", () => {
      const result = validateProgram({ name: "Test Program", earnRatio: BigInt(100) });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("rejects empty name", () => {
      const result = validateProgram({ name: "", earnRatio: BigInt(100) });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("name is required");
    });
    it("rejects too long name", () => {
      const result = validateProgram({ name: "x".repeat(201), earnRatio: BigInt(100) });
      expect(result.valid).toBe(false);
    });
    it("rejects zero earn ratio", () => {
      const result = validateProgram({ name: "Test", earnRatio: BigInt(0) });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("earnRatio must be positive");
    });
    it("rejects negative earn ratio", () => {
      const result = validateProgram({ name: "Test", earnRatio: BigInt(-5) });
      expect(result.valid).toBe(false);
    });
    it("rejects zero expiryDays", () => {
      const result = validateProgram({ name: "Test", expiryDays: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("expiryDays must be at least 1 if set");
    });
    it("accepts null expiryDays", () => {
      const result = validateProgram({ name: "Test", expiryDays: null });
      expect(result.valid).toBe(true);
    });
  });

  describe("validateTierThresholds", () => {
    it("validates ascending thresholds", () => {
      const result = validateTierThresholds([
        { level: 1, minPoints: BigInt(100) },
        { level: 2, minPoints: BigInt(500) },
        { level: 3, minPoints: BigInt(1000) },
      ]);
      expect(result.valid).toBe(true);
    });
    it("rejects non-ascending thresholds", () => {
      const result = validateTierThresholds([
        { level: 1, minPoints: BigInt(500) },
        { level: 2, minPoints: BigInt(100) },
      ]);
      expect(result.valid).toBe(false);
    });
    it("rejects equal thresholds", () => {
      const result = validateTierThresholds([
        { level: 1, minPoints: BigInt(100) },
        { level: 2, minPoints: BigInt(100) },
      ]);
      expect(result.valid).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENROLMENTS DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════
import {
  isValidTransition as enrolmentTransition,
  canEnrol,
  validateEnrolment,
  canAccrue,
  canRedeem,
} from "../src/modules/enrolments/domain.js";

describe("enrolments/domain", () => {
  describe("isValidTransition", () => {
    it("allows active → suspended", () => {
      expect(enrolmentTransition("active", "suspended")).toBe(true);
    });
    it("allows active → cancelled", () => {
      expect(enrolmentTransition("active", "cancelled")).toBe(true);
    });
    it("allows suspended → active", () => {
      expect(enrolmentTransition("suspended", "active")).toBe(true);
    });
    it("allows suspended → cancelled", () => {
      expect(enrolmentTransition("suspended", "cancelled")).toBe(true);
    });
    it("disallows cancelled → active", () => {
      expect(enrolmentTransition("cancelled", "active")).toBe(false);
    });
    it("disallows cancelled → suspended", () => {
      expect(enrolmentTransition("cancelled", "suspended")).toBe(false);
    });
  });

  describe("canEnrol", () => {
    it("returns true for active program", () => {
      expect(canEnrol("active")).toBe(true);
    });
    it("returns false for draft program", () => {
      expect(canEnrol("draft")).toBe(false);
    });
    it("returns false for suspended program", () => {
      expect(canEnrol("suspended")).toBe(false);
    });
    it("returns false for archived program", () => {
      expect(canEnrol("archived")).toBe(false);
    });
  });

  describe("validateEnrolment", () => {
    it("allows valid enrolment", () => {
      const result = validateEnrolment({ programStatus: "active", existingEnrolment: false });
      expect(result.valid).toBe(true);
    });
    it("rejects inactive program", () => {
      const result = validateEnrolment({ programStatus: "draft", existingEnrolment: false });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("program is not active");
    });
    it("rejects duplicate enrolment", () => {
      const result = validateEnrolment({ programStatus: "active", existingEnrolment: true });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("profile is already enrolled in this program");
    });
  });

  describe("canAccrue", () => {
    it("returns true for active", () => expect(canAccrue("active")).toBe(true));
    it("returns false for suspended", () => expect(canAccrue("suspended")).toBe(false));
    it("returns false for cancelled", () => expect(canAccrue("cancelled")).toBe(false));
  });

  describe("canRedeem", () => {
    it("returns true for active", () => expect(canRedeem("active")).toBe(true));
    it("returns false for suspended", () => expect(canRedeem("suspended")).toBe(false));
    it("returns false for cancelled", () => expect(canRedeem("cancelled")).toBe(false));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACCRUALS DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════
import {
  calculatePoints,
  computeExpiryDate,
  recalculateBalance,
  validateAccrual,
  isExpired,
} from "../src/modules/accruals/domain.js";

describe("accruals/domain", () => {
  describe("calculatePoints", () => {
    it("calculates points from purchase amount", () => {
      // 10000 paise (₹100) at ratio 100 (1 point per ₹1) = 100 points
      expect(calculatePoints(BigInt(10000), BigInt(100))).toBe(BigInt(100));
    });
    it("returns zero for zero amount", () => {
      expect(calculatePoints(BigInt(0), BigInt(100))).toBe(BigInt(0));
    });
    it("returns zero for negative amount", () => {
      expect(calculatePoints(BigInt(-100), BigInt(100))).toBe(BigInt(0));
    });
    it("returns zero for zero earn ratio", () => {
      expect(calculatePoints(BigInt(10000), BigInt(0))).toBe(BigInt(0));
    });
    it("handles high earn ratio correctly", () => {
      // 10000 paise at 200 ratio = 200 points
      expect(calculatePoints(BigInt(10000), BigInt(200))).toBe(BigInt(200));
    });
  });

  describe("computeExpiryDate", () => {
    it("returns null when expiryDays is null", () => {
      expect(computeExpiryDate(new Date(), null)).toBeNull();
    });
    it("returns null when expiryDays is 0", () => {
      expect(computeExpiryDate(new Date(), 0)).toBeNull();
    });
    it("computes correct expiry date", () => {
      const base = new Date("2025-01-01T00:00:00Z");
      const expiry = computeExpiryDate(base, 30);
      expect(expiry).not.toBeNull();
      expect(expiry!.toISOString()).toBe("2025-01-31T00:00:00.000Z");
    });
    it("handles 365-day expiry", () => {
      const base = new Date("2025-01-01T00:00:00Z");
      const expiry = computeExpiryDate(base, 365);
      expect(expiry!.getFullYear()).toBe(2026);
    });
  });

  describe("recalculateBalance", () => {
    it("calculates positive balance", () => {
      expect(recalculateBalance(BigInt(1000), BigInt(300))).toBe(BigInt(700));
    });
    it("returns zero when redeemed exceeds accrued", () => {
      expect(recalculateBalance(BigInt(100), BigInt(500))).toBe(BigInt(0));
    });
    it("returns zero when equal", () => {
      expect(recalculateBalance(BigInt(500), BigInt(500))).toBe(BigInt(0));
    });
  });

  describe("validateAccrual", () => {
    it("validates valid accrual", () => {
      const result = validateAccrual({ points: BigInt(100), source: "purchase", txType: "purchase" });
      expect(result.valid).toBe(true);
    });
    it("rejects zero points", () => {
      const result = validateAccrual({ points: BigInt(0), source: "purchase", txType: "purchase" });
      expect(result.valid).toBe(false);
    });
    it("rejects empty source", () => {
      const result = validateAccrual({ points: BigInt(100), source: "", txType: "purchase" });
      expect(result.valid).toBe(false);
    });
    it("rejects invalid txType", () => {
      const result = validateAccrual({ points: BigInt(100), source: "test", txType: "invalid" });
      expect(result.valid).toBe(false);
    });
    it("accepts all valid tx types", () => {
      for (const t of ["purchase", "bonus", "referral", "promotion", "adjustment"]) {
        const result = validateAccrual({ points: BigInt(10), source: "test", txType: t });
        expect(result.valid).toBe(true);
      }
    });
  });

  describe("isExpired", () => {
    it("returns false when no expiry", () => {
      expect(isExpired(null)).toBe(false);
    });
    it("returns false when expiry is in the future", () => {
      const future = new Date(Date.now() + 86_400_000);
      expect(isExpired(future)).toBe(false);
    });
    it("returns true when expiry is in the past", () => {
      const past = new Date(Date.now() - 86_400_000);
      expect(isExpired(past)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REDEMPTIONS DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════
import {
  validateRedemption,
  canVoid,
  balanceAfterRedemption,
  balanceAfterVoid,
  isFullRedemption,
} from "../src/modules/redemptions/domain.js";

describe("redemptions/domain", () => {
  describe("validateRedemption", () => {
    it("allows valid redemption", () => {
      const result = validateRedemption({
        requestedPoints: BigInt(100),
        availableBalance: BigInt(500),
        enrolmentStatus: "active",
      });
      expect(result.valid).toBe(true);
    });
    it("rejects when enrolment not active", () => {
      const result = validateRedemption({
        requestedPoints: BigInt(100),
        availableBalance: BigInt(500),
        enrolmentStatus: "suspended",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not active");
    });
    it("rejects zero points", () => {
      const result = validateRedemption({
        requestedPoints: BigInt(0),
        availableBalance: BigInt(500),
        enrolmentStatus: "active",
      });
      expect(result.valid).toBe(false);
    });
    it("rejects insufficient balance", () => {
      const result = validateRedemption({
        requestedPoints: BigInt(600),
        availableBalance: BigInt(500),
        enrolmentStatus: "active",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("insufficient");
    });
    it("rejects below minimum threshold", () => {
      const result = validateRedemption({
        requestedPoints: BigInt(50),
        availableBalance: BigInt(500),
        minRedemptionThreshold: BigInt(100),
        enrolmentStatus: "active",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("minimum");
    });
    it("allows exact minimum threshold", () => {
      const result = validateRedemption({
        requestedPoints: BigInt(100),
        availableBalance: BigInt(500),
        minRedemptionThreshold: BigInt(100),
        enrolmentStatus: "active",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("canVoid", () => {
    it("returns true for pending", () => expect(canVoid("pending")).toBe(true));
    it("returns true for fulfilled", () => expect(canVoid("fulfilled")).toBe(true));
    it("returns false for cancelled", () => expect(canVoid("cancelled")).toBe(false));
    it("returns false for voided", () => expect(canVoid("voided")).toBe(false));
  });

  describe("balanceAfterRedemption", () => {
    it("deducts correctly", () => {
      expect(balanceAfterRedemption(BigInt(500), BigInt(200))).toBe(BigInt(300));
    });
    it("floors at zero", () => {
      expect(balanceAfterRedemption(BigInt(100), BigInt(200))).toBe(BigInt(0));
    });
  });

  describe("balanceAfterVoid", () => {
    it("adds back points", () => {
      expect(balanceAfterVoid(BigInt(300), BigInt(200))).toBe(BigInt(500));
    });
  });

  describe("isFullRedemption", () => {
    it("returns true for exact balance", () => {
      expect(isFullRedemption(BigInt(500), BigInt(500))).toBe(true);
    });
    it("returns false for partial", () => {
      expect(isFullRedemption(BigInt(200), BigInt(500))).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIERS DOMAIN
// ═══════════════════════════════════════════════════════════════════════════════
import { evaluateTier, isInGracePeriod, isTierExpired } from "../src/modules/tiers/domain.js";

describe("tiers/domain", () => {
  const tierDefs = [
    { id: "t1", name: "Bronze", level: 1, minPointsThreshold: BigInt(0) },
    { id: "t2", name: "Silver", level: 2, minPointsThreshold: BigInt(500) },
    { id: "t3", name: "Gold", level: 3, minPointsThreshold: BigInt(2000) },
  ];

  describe("evaluateTier", () => {
    it("assigns lowest tier when points are zero", () => {
      const result = evaluateTier(BigInt(0), tierDefs, null);
      expect(result.newTierId).toBe("t1");
      expect(result.newTierName).toBe("Bronze");
    });
    it("upgrades to Silver at 500 points", () => {
      const result = evaluateTier(BigInt(500), tierDefs, "t1");
      expect(result.newTierId).toBe("t2");
      expect(result.changed).toBe(true);
      expect(result.direction).toBe("upgrade");
    });
    it("upgrades to Gold at 2000 points", () => {
      const result = evaluateTier(BigInt(2000), tierDefs, "t2");
      expect(result.newTierId).toBe("t3");
      expect(result.changed).toBe(true);
      expect(result.direction).toBe("upgrade");
    });
    it("stays at current tier when no change", () => {
      const result = evaluateTier(BigInt(1000), tierDefs, "t2");
      expect(result.newTierId).toBe("t2");
      expect(result.changed).toBe(false);
      expect(result.direction).toBe("none");
    });
    it("downgrades when points drop below threshold", () => {
      const result = evaluateTier(BigInt(100), tierDefs, "t2");
      expect(result.newTierId).toBe("t1");
      expect(result.changed).toBe(true);
      expect(result.direction).toBe("downgrade");
    });
    it("returns base when no tier definitions exist", () => {
      const result = evaluateTier(BigInt(1000), [], null);
      expect(result.newTierName).toBe("base");
      expect(result.changed).toBe(false);
    });
    it("handles first-time assignment as upgrade", () => {
      const result = evaluateTier(BigInt(600), tierDefs, null);
      expect(result.direction).toBe("upgrade");
      expect(result.changed).toBe(true);
    });
  });

  describe("isInGracePeriod", () => {
    it("returns false when no upgrade date", () => {
      expect(isInGracePeriod(null, 30)).toBe(false);
    });
    it("returns false when grace days is 0", () => {
      expect(isInGracePeriod(new Date(), 0)).toBe(false);
    });
    it("returns true when within grace period", () => {
      const recent = new Date(Date.now() - 86_400_000); // 1 day ago
      expect(isInGracePeriod(recent, 30)).toBe(true);
    });
    it("returns false when past grace period", () => {
      const old = new Date(Date.now() - 90 * 86_400_000); // 90 days ago
      expect(isInGracePeriod(old, 30)).toBe(false);
    });
  });

  describe("isTierExpired", () => {
    it("returns false when no expiry", () => {
      expect(isTierExpired(null)).toBe(false);
    });
    it("returns false when not expired", () => {
      const future = new Date(Date.now() + 86_400_000);
      expect(isTierExpired(future)).toBe(false);
    });
    it("returns true when expired", () => {
      const past = new Date(Date.now() - 86_400_000);
      expect(isTierExpired(past)).toBe(true);
    });
  });
});
