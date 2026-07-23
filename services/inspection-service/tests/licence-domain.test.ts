/**
 * Unit tests for Licence Compliance domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: SVC-108
 */
import { describe, it, expect } from "vitest";
import {
  LICENCE_STATES,
  LICENCE_TRANSITIONS,
  COMPLIANCE_STATUSES,
  assertValidLicenceTransition,
  isExpiringSoon,
  isExpired,
  assertRenewalAllowed,
  DomainError,
} from "../src/modules/licence/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("LICENCE_STATES", () => {
  it("contains exactly 5 states", () => {
    expect(LICENCE_STATES).toHaveLength(5);
  });

  it("includes all expected states", () => {
    expect(LICENCE_STATES).toContain("active");
    expect(LICENCE_STATES).toContain("expired");
    expect(LICENCE_STATES).toContain("suspended");
    expect(LICENCE_STATES).toContain("revoked");
    expect(LICENCE_STATES).toContain("pending_renewal");
  });
});

describe("COMPLIANCE_STATUSES", () => {
  it("contains met, not_met, pending", () => {
    expect(COMPLIANCE_STATUSES).toContain("met");
    expect(COMPLIANCE_STATUSES).toContain("not_met");
    expect(COMPLIANCE_STATUSES).toContain("pending");
  });
});

describe("LICENCE_TRANSITIONS", () => {
  it("active can go to expired, suspended, revoked, pending_renewal", () => {
    expect(LICENCE_TRANSITIONS.active).toContain("expired");
    expect(LICENCE_TRANSITIONS.active).toContain("suspended");
    expect(LICENCE_TRANSITIONS.active).toContain("revoked");
    expect(LICENCE_TRANSITIONS.active).toContain("pending_renewal");
  });

  it("expired can go to pending_renewal", () => {
    expect(LICENCE_TRANSITIONS.expired).toContain("pending_renewal");
  });

  it("suspended can go to active or revoked", () => {
    expect(LICENCE_TRANSITIONS.suspended).toContain("active");
    expect(LICENCE_TRANSITIONS.suspended).toContain("revoked");
  });

  it("revoked is terminal", () => {
    expect(LICENCE_TRANSITIONS.revoked).toHaveLength(0);
  });

  it("pending_renewal can go to active", () => {
    expect(LICENCE_TRANSITIONS.pending_renewal).toContain("active");
  });
});

// ── assertValidLicenceTransition ──────────────────────────────────────────────

describe("assertValidLicenceTransition", () => {
  it("allows active → suspended", () => {
    expect(() => assertValidLicenceTransition("active", "suspended"))
      .not.toThrow();
  });

  it("allows active → revoked", () => {
    expect(() => assertValidLicenceTransition("active", "revoked"))
      .not.toThrow();
  });

  it("allows active → pending_renewal", () => {
    expect(() => assertValidLicenceTransition("active", "pending_renewal"))
      .not.toThrow();
  });

  it("allows expired → pending_renewal", () => {
    expect(() => assertValidLicenceTransition("expired", "pending_renewal"))
      .not.toThrow();
  });

  it("allows pending_renewal → active", () => {
    expect(() => assertValidLicenceTransition("pending_renewal", "active"))
      .not.toThrow();
  });

  it("allows suspended → active", () => {
    expect(() => assertValidLicenceTransition("suspended", "active"))
      .not.toThrow();
  });

  it("throws for revoked → active (terminal)", () => {
    expect(() => assertValidLicenceTransition("revoked", "active"))
      .toThrow(DomainError);
  });

  it("throws for expired → active (must go through pending_renewal)", () => {
    expect(() => assertValidLicenceTransition("expired", "active"))
      .toThrow(DomainError);
  });

  it("error code is INVALID_TRANSITION", () => {
    try {
      assertValidLicenceTransition("revoked", "active");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });
});

// ── isExpiringSoon ────────────────────────────────────────────────────────────

describe("isExpiringSoon", () => {
  it("returns true when expiry is within threshold days from now", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const dateStr = futureDate.toISOString().split("T")[0]!;
    expect(isExpiringSoon(dateStr, 30)).toBe(true);
  });

  it("returns false when expiry is beyond threshold days", () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 100);
    const dateStr = farFuture.toISOString().split("T")[0]!;
    expect(isExpiringSoon(dateStr, 30)).toBe(false);
  });

  it("returns false when already expired (negative diff)", () => {
    expect(isExpiringSoon("2020-01-01", 30)).toBe(false);
  });

  it("returns true for today (0 days remaining, within threshold)", () => {
    const today = new Date().toISOString().split("T")[0]!;
    expect(isExpiringSoon(today, 30)).toBe(true);
  });
});

// ── isExpired ─────────────────────────────────────────────────────────────────

describe("isExpired", () => {
  it("returns true for past date", () => {
    expect(isExpired("2020-01-01")).toBe(true);
  });

  it("returns false for future date", () => {
    expect(isExpired("2099-12-31")).toBe(false);
  });
});

// ── assertRenewalAllowed ──────────────────────────────────────────────────────

describe("assertRenewalAllowed", () => {
  it("does not throw for active status", () => {
    expect(() => assertRenewalAllowed("active")).not.toThrow();
  });

  it("does not throw for expired status", () => {
    expect(() => assertRenewalAllowed("expired")).not.toThrow();
  });

  it("throws RENEWAL_NOT_ALLOWED for suspended", () => {
    try {
      assertRenewalAllowed("suspended");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("RENEWAL_NOT_ALLOWED");
    }
  });

  it("throws RENEWAL_NOT_ALLOWED for revoked", () => {
    expect(() => assertRenewalAllowed("revoked")).toThrow(DomainError);
  });

  it("throws RENEWAL_NOT_ALLOWED for pending_renewal", () => {
    expect(() => assertRenewalAllowed("pending_renewal")).toThrow(DomainError);
  });

  it("error message mentions the current state", () => {
    expect(() => assertRenewalAllowed("revoked"))
      .toThrow("revoked");
  });
});
