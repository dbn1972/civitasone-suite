/**
 * Comprehensive domain logic tests covering:
 * - visit-request/domain.ts
 * - check-in/domain.ts
 * - digital-pass/domain.ts
 * - material-pass/domain.ts
 * - recurring-pass/domain.ts
 * - document-scan/domain.ts
 * - group-visit/domain.ts
 * - analytics/domain.ts
 */
import { describe, expect, it } from "vitest";

// ── Visit Request Domain ──────────────────────────────────────────────────

import {
  isValidScheduledDate,
  assertValidScheduledDate,
  findMissingRequiredFields,
  assertRequiredFields,
  assertTransitionAllowed,
  approve,
  reject,
  resolveInitialStatus,
  isAutoRejectDue,
  isReminderDue,
  generateTrackingRef,
  ValidationError,
  DomainError as VRDomainError,
  MIN_SCHEDULE_LEAD_MS,
  MAX_SCHEDULE_LEAD_MS,
  ALLOWED_TRANSITIONS,
} from "../src/modules/visit-request/domain.js";

describe("visit-request/domain", () => {
  describe("isValidScheduledDate", () => {
    const now = new Date("2025-06-15T10:00:00Z");

    it("accepts date 2 hours ahead", () => {
      const scheduled = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      expect(isValidScheduledDate(scheduled, now)).toBe(true);
    });

    it("rejects date less than 1 hour ahead", () => {
      const scheduled = new Date(now.getTime() + 30 * 60 * 1000);
      expect(isValidScheduledDate(scheduled, now)).toBe(false);
    });

    it("rejects date more than 30 days ahead", () => {
      const scheduled = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
      expect(isValidScheduledDate(scheduled, now)).toBe(false);
    });

    it("rejects past dates", () => {
      const scheduled = new Date(now.getTime() - 60 * 1000);
      expect(isValidScheduledDate(scheduled, now)).toBe(false);
    });

    it("accepts exactly at 1 hour boundary", () => {
      const scheduled = new Date(now.getTime() + MIN_SCHEDULE_LEAD_MS);
      expect(isValidScheduledDate(scheduled, now)).toBe(true);
    });

    it("accepts exactly at 30 day boundary", () => {
      const scheduled = new Date(now.getTime() + MAX_SCHEDULE_LEAD_MS);
      expect(isValidScheduledDate(scheduled, now)).toBe(true);
    });

    it("uses custom bounds when provided", () => {
      const scheduled = new Date(now.getTime() + 10 * 60 * 1000); // 10 min
      expect(isValidScheduledDate(scheduled, now, { minLeadMs: 5 * 60 * 1000 })).toBe(true);
    });
  });

  describe("assertValidScheduledDate", () => {
    it("throws DomainError on invalid date", () => {
      const now = new Date("2025-06-15T10:00:00Z");
      const past = new Date(now.getTime() - 1000);
      expect(() => assertValidScheduledDate(past, now)).toThrow(VRDomainError);
    });
  });

  describe("findMissingRequiredFields", () => {
    it("returns empty array when all fields present", () => {
      const input = {
        visitorName: "John",
        visitorPhone: "9876543210",
        purpose: "meeting",
        hostEmployeeId: "host-1",
        scheduledAt: new Date(),
        identityDocRef: "ABC123",
      };
      expect(findMissingRequiredFields(input)).toEqual([]);
    });

    it("returns missing field names", () => {
      const input = { visitorName: null, visitorPhone: "", purpose: "meeting" };
      const missing = findMissingRequiredFields(input);
      expect(missing).toContain("visitorName");
      expect(missing).toContain("visitorPhone");
      expect(missing).toContain("hostEmployeeId");
      expect(missing).toContain("scheduledAt");
      expect(missing).toContain("identityDocRef");
    });

    it("treats whitespace-only strings as missing", () => {
      const input = { visitorName: "  ", visitorPhone: "123", purpose: "x", hostEmployeeId: "h", scheduledAt: new Date(), identityDocRef: "ref" };
      const missing = findMissingRequiredFields(input);
      expect(missing).toContain("visitorName");
    });
  });

  describe("assertRequiredFields", () => {
    it("throws ValidationError with missing fields", () => {
      expect(() => assertRequiredFields({})).toThrow(ValidationError);
    });

    it("does not throw when all fields present", () => {
      expect(() => assertRequiredFields({
        visitorName: "John", visitorPhone: "123", purpose: "x",
        hostEmployeeId: "h", scheduledAt: new Date(), identityDocRef: "ref",
      })).not.toThrow();
    });
  });

  describe("assertTransitionAllowed", () => {
    it("allows pending_approval -> approved", () => {
      expect(() => assertTransitionAllowed("pending_approval", "approved")).not.toThrow();
    });

    it("allows pending_approval -> rejected", () => {
      expect(() => assertTransitionAllowed("pending_approval", "rejected")).not.toThrow();
    });

    it("allows approved -> cancelled", () => {
      expect(() => assertTransitionAllowed("approved", "cancelled")).not.toThrow();
    });

    it("allows approved -> no_show", () => {
      expect(() => assertTransitionAllowed("approved", "no_show")).not.toThrow();
    });

    it("rejects rejected -> approved", () => {
      expect(() => assertTransitionAllowed("rejected", "approved")).toThrow(VRDomainError);
    });

    it("rejects cancelled -> approved", () => {
      expect(() => assertTransitionAllowed("cancelled", "approved")).toThrow(VRDomainError);
    });

    it("rejects unknown status", () => {
      expect(() => assertTransitionAllowed("bogus", "approved")).toThrow(VRDomainError);
    });
  });

  describe("approve", () => {
    it("returns approved from pending_approval", () => {
      expect(approve("pending_approval")).toBe("approved");
    });
    it("returns approved from pre_approved", () => {
      expect(approve("pre_approved")).toBe("approved");
    });
    it("throws from rejected", () => {
      expect(() => approve("rejected")).toThrow();
    });
  });

  describe("reject", () => {
    it("returns rejected with reason", () => {
      const result = reject("pending_approval", "Not authorized");
      expect(result.status).toBe("rejected");
      expect(result.rejectionReason).toBe("Not authorized");
    });
    it("throws on blank reason", () => {
      expect(() => reject("pending_approval", "")).toThrow(VRDomainError);
    });
    it("throws on invalid transition", () => {
      expect(() => reject("rejected", "Already rejected")).toThrow(VRDomainError);
    });
  });

  describe("resolveInitialStatus", () => {
    it("returns approved for VIP category (default auto-approve set)", () => {
      expect(resolveInitialStatus("portal", "vip")).toBe("approved");
    });
    it("returns pre_approved for host_preregister source", () => {
      expect(resolveInitialStatus("host_preregister", "standard")).toBe("pre_approved");
    });
    it("returns pending_approval for standard portal submission", () => {
      expect(resolveInitialStatus("portal", "standard")).toBe("pending_approval");
    });
    it("uses custom auto-approve categories", () => {
      expect(resolveInitialStatus("portal", "contractor", new Set(["contractor"]))).toBe("approved");
    });
    it("auto-approve takes priority over source", () => {
      expect(resolveInitialStatus("host_preregister", "vip")).toBe("approved");
    });
  });

  describe("isAutoRejectDue", () => {
    it("returns true after 24 hours", () => {
      const createdAt = new Date("2025-06-14T09:00:00Z");
      const now = new Date("2025-06-15T10:00:00Z"); // > 24h
      expect(isAutoRejectDue(createdAt, now)).toBe(true);
    });
    it("returns false before 24 hours", () => {
      const createdAt = new Date("2025-06-15T09:00:00Z");
      const now = new Date("2025-06-15T10:00:00Z"); // 1h
      expect(isAutoRejectDue(createdAt, now)).toBe(false);
    });
    it("returns false at exactly 24 hours", () => {
      const createdAt = new Date("2025-06-14T10:00:00Z");
      const now = new Date("2025-06-15T10:00:00Z"); // exactly 24h
      expect(isAutoRejectDue(createdAt, now)).toBe(false);
    });
  });

  describe("isReminderDue", () => {
    it("returns true after 4 hours", () => {
      const createdAt = new Date("2025-06-15T06:00:00Z");
      const now = new Date("2025-06-15T10:01:00Z");
      expect(isReminderDue(createdAt, now)).toBe(true);
    });
    it("returns false before 4 hours", () => {
      const createdAt = new Date("2025-06-15T09:00:00Z");
      const now = new Date("2025-06-15T10:00:00Z");
      expect(isReminderDue(createdAt, now)).toBe(false);
    });
  });

  describe("generateTrackingRef", () => {
    it("returns 8-character alphanumeric string", () => {
      const ref = generateTrackingRef();
      expect(ref).toHaveLength(8);
      expect(ref).toMatch(/^[A-Z0-9]+$/);
    });
    it("excludes ambiguous characters", () => {
      for (let i = 0; i < 100; i++) {
        const ref = generateTrackingRef();
        expect(ref).not.toMatch(/[0OIL1]/);
      }
    });
  });
});

// ── Check-In Domain ───────────────────────────────────────────────────────

import {
  checkIn,
  checkOut,
  computeVisitDurationMs,
  computeVisitDuration,
  isOverstayed,
  isLocationScopeValid,
  isAreaPermitted,
  DomainError as CIDomainError,
} from "../src/modules/check-in/domain.js";

describe("check-in/domain", () => {
  describe("checkIn", () => {
    it("transitions active to checked_in", () => {
      expect(checkIn("active", { passType: "single" })).toBe("checked_in");
    });
    it("transitions issued to checked_in", () => {
      expect(checkIn("issued", { passType: "single" })).toBe("checked_in");
    });
    it("throws on already checked_in (non-recurring)", () => {
      expect(() => checkIn("checked_in", { passType: "single" })).toThrow(CIDomainError);
    });
    it("allows re-entry from checked_in for multi-entry recurring", () => {
      expect(checkIn("checked_in", { passType: "recurring", multiEntryRecurring: true })).toBe("checked_in");
    });
    it("allows re-entry from checked_out for multi-day pass", () => {
      expect(checkIn("checked_out", { passType: "multi_day" })).toBe("checked_in");
    });
    it("throws on revoked status", () => {
      expect(() => checkIn("revoked", { passType: "single" })).toThrow(CIDomainError);
    });
    it("throws on expired status", () => {
      expect(() => checkIn("expired", { passType: "single" })).toThrow(CIDomainError);
    });
  });

  describe("checkOut", () => {
    it("transitions checked_in to checked_out", () => {
      expect(checkOut("checked_in")).toBe("checked_out");
    });
    it("throws on active (not checked in)", () => {
      expect(() => checkOut("active")).toThrow(CIDomainError);
    });
    it("throws on already checked_out", () => {
      expect(() => checkOut("checked_out")).toThrow(CIDomainError);
    });
  });

  describe("computeVisitDurationMs", () => {
    it("computes duration in milliseconds", () => {
      const checkInAt = new Date("2025-06-15T09:00:00Z");
      const checkOutAt = new Date("2025-06-15T11:30:00Z");
      expect(computeVisitDurationMs(checkInAt, checkOutAt)).toBe(2.5 * 60 * 60 * 1000);
    });
  });

  describe("computeVisitDuration", () => {
    it("computes duration in minutes", () => {
      const checkInAt = new Date("2025-06-15T09:00:00Z");
      const checkOutAt = new Date("2025-06-15T11:30:00Z");
      expect(computeVisitDuration(checkInAt, checkOutAt)).toBe(150);
    });
  });

  describe("isOverstayed", () => {
    it("returns true when now > validUntil", () => {
      const now = new Date("2025-06-15T18:00:00Z");
      const validUntil = new Date("2025-06-15T17:00:00Z");
      expect(isOverstayed(now, validUntil)).toBe(true);
    });
    it("returns false when now <= validUntil", () => {
      const now = new Date("2025-06-15T16:00:00Z");
      const validUntil = new Date("2025-06-15T17:00:00Z");
      expect(isOverstayed(now, validUntil)).toBe(false);
    });
    it("respects grace period", () => {
      const now = new Date("2025-06-15T17:05:00Z"); // 5 min past
      const validUntil = new Date("2025-06-15T17:00:00Z");
      expect(isOverstayed(now, validUntil, 10 * 60 * 1000)).toBe(false); // 10 min grace
    });
  });

  describe("isLocationScopeValid", () => {
    it("returns true for matching locations", () => {
      expect(isLocationScopeValid("loc-1", "loc-1")).toBe(true);
    });
    it("returns false for mismatched locations", () => {
      expect(isLocationScopeValid("loc-1", "loc-2")).toBe(false);
    });
  });

  describe("isAreaPermitted", () => {
    it("returns true when area is in permitted list", () => {
      expect(isAreaPermitted("area-1", ["area-1", "area-2"])).toBe(true);
    });
    it("returns false when area not in permitted list", () => {
      expect(isAreaPermitted("area-3", ["area-1", "area-2"])).toBe(false);
    });
    it("returns true when areaId is null (no area restriction)", () => {
      expect(isAreaPermitted(null, ["area-1"])).toBe(true);
    });
    it("returns false with empty permitted areas (area restricted)", () => {
      expect(isAreaPermitted("area-1", [])).toBe(false);
    });
  });
});

// ── Digital Pass Domain ───────────────────────────────────────────────────

import {
  generatePassNumber,
  computeValidityWindow,
  assertNotRevoked,
  revokePass,
  assertPassTransition,
  DomainError as DPDomainError,
  MULTI_DAY_MAX_MS,
  RECURRING_MAX_MS,
} from "../src/modules/digital-pass/domain.js";

describe("digital-pass/domain", () => {
  describe("generatePassNumber", () => {
    it("returns a 10-character string", () => {
      const num = generatePassNumber();
      expect(num).toHaveLength(10);
    });
    it("uses only uppercase alphanumeric chars", () => {
      for (let i = 0; i < 50; i++) {
        expect(generatePassNumber()).toMatch(/^[A-Z0-9]+$/);
      }
    });
    it("excludes ambiguous characters (0, O, 1, I)", () => {
      for (let i = 0; i < 100; i++) {
        expect(generatePassNumber()).not.toMatch(/[0O1I]/);
      }
    });
  });

  describe("computeValidityWindow", () => {
    const baseFrom = new Date("2025-06-15T09:00:00Z");

    it("single: valid through end of calendar day", () => {
      const { validFrom, validUntil } = computeValidityWindow("single", baseFrom);
      expect(validFrom).toEqual(baseFrom);
      expect(validUntil.getDate()).toBe(baseFrom.getDate());
      expect(validUntil.getHours()).toBe(23);
      expect(validUntil.getMinutes()).toBe(59);
    });

    it("multi_day: caps at 7 days", () => {
      const requestedUntil = new Date(baseFrom.getTime() + 10 * 24 * 60 * 60 * 1000);
      const { validUntil } = computeValidityWindow("multi_day", baseFrom, requestedUntil);
      const maxUntil = new Date(baseFrom.getTime() + MULTI_DAY_MAX_MS);
      expect(validUntil.getTime()).toBe(maxUntil.getTime());
    });

    it("multi_day: uses requestedUntil when within cap", () => {
      const requestedUntil = new Date(baseFrom.getTime() + 3 * 24 * 60 * 60 * 1000);
      const { validUntil } = computeValidityWindow("multi_day", baseFrom, requestedUntil);
      expect(validUntil.getTime()).toBe(requestedUntil.getTime());
    });

    it("recurring: caps at 90 days", () => {
      const requestedUntil = new Date(baseFrom.getTime() + 100 * 24 * 60 * 60 * 1000);
      const { validUntil } = computeValidityWindow("recurring", baseFrom, requestedUntil);
      const maxUntil = new Date(baseFrom.getTime() + RECURRING_MAX_MS);
      expect(validUntil.getTime()).toBe(maxUntil.getTime());
    });

    it("event: passes through as-is", () => {
      const requestedUntil = new Date(baseFrom.getTime() + 365 * 24 * 60 * 60 * 1000);
      const { validUntil } = computeValidityWindow("event", baseFrom, requestedUntil);
      expect(validUntil.getTime()).toBe(requestedUntil.getTime());
    });

    it("throws when requestedUntil missing for multi_day", () => {
      expect(() => computeValidityWindow("multi_day", baseFrom)).toThrow(DPDomainError);
    });

    it("throws when requestedUntil <= requestedFrom", () => {
      const past = new Date(baseFrom.getTime() - 1000);
      expect(() => computeValidityWindow("multi_day", baseFrom, past)).toThrow(DPDomainError);
    });

    it("uses custom caps", () => {
      const requestedUntil = new Date(baseFrom.getTime() + 5 * 24 * 60 * 60 * 1000);
      const { validUntil } = computeValidityWindow("multi_day", baseFrom, requestedUntil, { multiDayMaxMs: 3 * 24 * 60 * 60 * 1000 });
      expect(validUntil.getTime()).toBe(baseFrom.getTime() + 3 * 24 * 60 * 60 * 1000);
    });
  });

  describe("assertNotRevoked", () => {
    it("does not throw for non-revoked pass", () => {
      expect(() => assertNotRevoked({ revoked: false })).not.toThrow();
    });
    it("throws for revoked pass", () => {
      expect(() => assertNotRevoked({ revoked: true })).toThrow(DPDomainError);
    });
  });

  describe("revokePass", () => {
    it("returns revocation fields", () => {
      const result = revokePass({ revoked: false }, "lost pass");
      expect(result.revoked).toBe(true);
      expect(result.revokeReason).toBe("lost pass");
      expect(result.revokedAt).toBeInstanceOf(Date);
    });
    it("throws if already revoked", () => {
      expect(() => revokePass({ revoked: true }, "reason")).toThrow(DPDomainError);
    });
  });

  describe("assertPassTransition", () => {
    it("allows active -> checked_in", () => {
      expect(() => assertPassTransition("active", "checked_in")).not.toThrow();
    });
    it("allows checked_in -> checked_out", () => {
      expect(() => assertPassTransition("checked_in", "checked_out")).not.toThrow();
    });
    it("allows checked_out -> checked_in (re-entry)", () => {
      expect(() => assertPassTransition("checked_out", "checked_in")).not.toThrow();
    });
    it("rejects revoked -> any", () => {
      expect(() => assertPassTransition("revoked", "active")).toThrow(DPDomainError);
    });
    it("rejects expired -> any", () => {
      expect(() => assertPassTransition("expired", "active")).toThrow(DPDomainError);
    });
  });
});

// ── Material Pass Domain ──────────────────────────────────────────────────

import {
  declareItems,
  reconcileOnExit,
  handleUndeclaredItemOnExit,
  DomainError as MPDomainError,
} from "../src/modules/material-pass/domain.js";

describe("material-pass/domain", () => {
  describe("declareItems", () => {
    it("normalizes valid items", () => {
      const result = declareItems([
        { description: " Laptop ", quantity: 1, serialNumber: "SN001" },
        { description: "Camera", quantity: 2 },
      ]);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ description: "Laptop", quantity: 1, serialNumber: "SN001" });
      expect(result[1]).toEqual({ description: "Camera", quantity: 2, serialNumber: null });
    });

    it("throws on empty description", () => {
      expect(() => declareItems([{ description: "", quantity: 1 }])).toThrow(MPDomainError);
    });

    it("throws on zero quantity", () => {
      expect(() => declareItems([{ description: "Item", quantity: 0 }])).toThrow(MPDomainError);
    });

    it("throws on negative quantity", () => {
      expect(() => declareItems([{ description: "Item", quantity: -1 }])).toThrow(MPDomainError);
    });

    it("throws on non-integer quantity", () => {
      expect(() => declareItems([{ description: "Item", quantity: 1.5 }])).toThrow(MPDomainError);
    });

    it("normalizes blank serial to null", () => {
      const result = declareItems([{ description: "Item", quantity: 1, serialNumber: "  " }]);
      expect(result[0]!.serialNumber).toBeNull();
    });
  });

  describe("reconcileOnExit", () => {
    it("no discrepancy when all items accounted", () => {
      const declared = [{ description: "Laptop", quantity: 1, serialNumber: "SN001" }];
      const present = [{ description: "Laptop", quantity: 1, serialNumber: "SN001" }];
      const result = reconcileOnExit(declared, present);
      expect(result.discrepancy).toBe(false);
      expect(result.missingItems).toHaveLength(0);
      expect(result.accountedItems).toHaveLength(1);
    });

    it("discrepancy when item missing", () => {
      const declared = [{ description: "Laptop", quantity: 2, serialNumber: null }];
      const present = [{ description: "Laptop", quantity: 1 }];
      const result = reconcileOnExit(declared, present);
      expect(result.discrepancy).toBe(true);
      expect(result.missingItems[0]!.quantity).toBe(1);
    });

    it("discrepancy when item completely missing", () => {
      const declared = [{ description: "Camera", quantity: 1, serialNumber: "CAM1" }];
      const result = reconcileOnExit(declared, []);
      expect(result.discrepancy).toBe(true);
      expect(result.missingItems).toHaveLength(1);
    });

    it("matches by serial number case-insensitively", () => {
      const declared = [{ description: "Laptop", quantity: 1, serialNumber: "SN001" }];
      const present = [{ description: "Laptop", quantity: 1, serialNumber: "sn001" }];
      const result = reconcileOnExit(declared, present);
      expect(result.discrepancy).toBe(false);
    });

    it("matches by description when no serial", () => {
      const declared = [{ description: "USB Drive", quantity: 3, serialNumber: null }];
      const present = [{ description: "usb drive", quantity: 3 }];
      const result = reconcileOnExit(declared, present);
      expect(result.discrepancy).toBe(false);
    });

    it("extra items at exit do not cause discrepancy", () => {
      const declared = [{ description: "Laptop", quantity: 1, serialNumber: null }];
      const present = [{ description: "Laptop", quantity: 2 }];
      const result = reconcileOnExit(declared, present);
      expect(result.discrepancy).toBe(false);
    });
  });

  describe("handleUndeclaredItemOnExit", () => {
    it("detects items never declared", () => {
      const declared = [{ description: "Laptop", quantity: 1, serialNumber: null }];
      const present = [
        { description: "Laptop", quantity: 1 },
        { description: "Server", quantity: 1 },
      ];
      const result = handleUndeclaredItemOnExit(present, declared);
      expect(result.undeclaredItems).toHaveLength(1);
      expect(result.undeclaredItems[0]!.description).toBe("Server");
    });

    it("detects excess quantity beyond declared", () => {
      const declared = [{ description: "USB", quantity: 2, serialNumber: null }];
      const present = [{ description: "USB", quantity: 5 }];
      const result = handleUndeclaredItemOnExit(present, declared);
      expect(result.undeclaredItems[0]!.quantity).toBe(3);
    });

    it("returns empty when all items accounted", () => {
      const declared = [{ description: "Laptop", quantity: 1, serialNumber: null }];
      const present = [{ description: "Laptop", quantity: 1 }];
      const result = handleUndeclaredItemOnExit(present, declared);
      expect(result.undeclaredItems).toHaveLength(0);
    });
  });
});

// ── Recurring Pass Domain ─────────────────────────────────────────────────

import {
  validateValidityWindow,
  isEligibleForCheckIn,
  suspend,
  revoke,
  reactivate,
  aggregateAttendance,
  DomainError as RPDomainError,
} from "../src/modules/recurring-pass/domain.js";

describe("recurring-pass/domain", () => {
  describe("validateValidityWindow", () => {
    it("accepts valid 30-day window", () => {
      const start = new Date("2025-06-01");
      const end = new Date("2025-07-01");
      expect(() => validateValidityWindow(start, end)).not.toThrow();
    });

    it("throws when endDate <= startDate", () => {
      const start = new Date("2025-06-15");
      const end = new Date("2025-06-14");
      expect(() => validateValidityWindow(start, end)).toThrow(RPDomainError);
    });

    it("throws when window exceeds 90 days", () => {
      const start = new Date("2025-01-01");
      const end = new Date("2025-05-01"); // > 90 days
      expect(() => validateValidityWindow(start, end)).toThrow(RPDomainError);
    });

    it("accepts exactly 90 days", () => {
      const start = new Date("2025-01-01T00:00:00Z");
      const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
      expect(() => validateValidityWindow(start, end)).not.toThrow();
    });
  });

  describe("isEligibleForCheckIn", () => {
    // Wednesday = day 3
    const wednesday10am = new Date("2025-06-18T10:00:00");

    it("eligible on permitted day within time window", () => {
      const result = isEligibleForCheckIn(wednesday10am, [3], { startTime: "09:00", endTime: "18:00" }, "active");
      expect(result.eligible).toBe(true);
    });

    it("ineligible when suspended", () => {
      const result = isEligibleForCheckIn(wednesday10am, [3], null, "suspended");
      expect(result).toEqual({ eligible: false, reason: "PASS_SUSPENDED" });
    });

    it("ineligible when revoked", () => {
      const result = isEligibleForCheckIn(wednesday10am, [3], null, "revoked");
      expect(result).toEqual({ eligible: false, reason: "PASS_REVOKED" });
    });

    it("ineligible when expired", () => {
      const result = isEligibleForCheckIn(wednesday10am, [3], null, "expired");
      expect(result).toEqual({ eligible: false, reason: "PASS_EXPIRED" });
    });

    it("ineligible on non-permitted day", () => {
      const result = isEligibleForCheckIn(wednesday10am, [1, 2, 4, 5], null, "active");
      expect(result).toEqual({ eligible: false, reason: "OUTSIDE_PERMITTED_DAY" });
    });

    it("ineligible outside time window (before start)", () => {
      const early = new Date("2025-06-18T07:00:00");
      const result = isEligibleForCheckIn(early, [3], { startTime: "09:00", endTime: "18:00" }, "active");
      expect(result).toEqual({ eligible: false, reason: "OUTSIDE_PERMITTED_TIME_WINDOW" });
    });

    it("ineligible outside time window (after end)", () => {
      const late = new Date("2025-06-18T19:00:00");
      const result = isEligibleForCheckIn(late, [3], { startTime: "09:00", endTime: "18:00" }, "active");
      expect(result).toEqual({ eligible: false, reason: "OUTSIDE_PERMITTED_TIME_WINDOW" });
    });

    it("eligible when no time window (null)", () => {
      const result = isEligibleForCheckIn(wednesday10am, [3], null, "active");
      expect(result.eligible).toBe(true);
    });
  });

  describe("suspend / revoke / reactivate", () => {
    it("suspend from active", () => { expect(suspend("active")).toBe("suspended"); });
    it("suspend throws from revoked", () => { expect(() => suspend("revoked")).toThrow(RPDomainError); });
    it("revoke from active", () => { expect(revoke("active")).toBe("revoked"); });
    it("revoke from suspended", () => { expect(revoke("suspended")).toBe("revoked"); });
    it("revoke throws from expired", () => { expect(() => revoke("expired")).toThrow(RPDomainError); });
    it("reactivate from suspended", () => { expect(reactivate("suspended")).toBe("active"); });
    it("reactivate throws from active", () => { expect(() => reactivate("active")).toThrow(RPDomainError); });
  });

  describe("aggregateAttendance", () => {
    it("aggregates check-ins by day", () => {
      const records = [
        { checkInAt: new Date("2025-06-15T09:00:00"), checkOutAt: new Date("2025-06-15T12:00:00") },
        { checkInAt: new Date("2025-06-15T14:00:00"), checkOutAt: new Date("2025-06-15T17:00:00") },
        { checkInAt: new Date("2025-06-16T09:00:00"), checkOutAt: new Date("2025-06-16T11:00:00") },
      ];
      const result = aggregateAttendance(records);
      expect(result).toHaveLength(2);
      expect(result[0]!.date).toBe("2025-06-15");
      expect(result[0]!.checkInCount).toBe(2);
      expect(result[0]!.totalDurationMinutes).toBe(360); // 3h + 3h
      expect(result[1]!.date).toBe("2025-06-16");
      expect(result[1]!.checkInCount).toBe(1);
      expect(result[1]!.totalDurationMinutes).toBe(120);
    });

    it("handles null checkOutAt (still checked in)", () => {
      const records = [
        { checkInAt: new Date("2025-06-15T09:00:00"), checkOutAt: null },
      ];
      const result = aggregateAttendance(records);
      expect(result[0]!.totalDurationMinutes).toBe(0);
    });

    it("returns empty array for no records", () => {
      expect(aggregateAttendance([])).toEqual([]);
    });

    it("sorts by date ascending", () => {
      const records = [
        { checkInAt: new Date("2025-06-17T09:00:00"), checkOutAt: new Date("2025-06-17T10:00:00") },
        { checkInAt: new Date("2025-06-15T09:00:00"), checkOutAt: new Date("2025-06-15T10:00:00") },
      ];
      const result = aggregateAttendance(records);
      expect(result[0]!.date).toBe("2025-06-15");
      expect(result[1]!.date).toBe("2025-06-17");
    });
  });
});

// ── Document Scan Domain ──────────────────────────────────────────────────

import {
  validateImage,
  isLowConfidence,
  detectDocumentType,
  mapOcrFields,
  shouldScreenBlacklist,
} from "../src/modules/document-scan/domain.js";

describe("document-scan/domain", () => {
  describe("validateImage", () => {
    it("accepts JPEG", () => { expect(validateImage("image/jpeg", 1024).valid).toBe(true); });
    it("accepts PNG", () => { expect(validateImage("image/png", 1024).valid).toBe(true); });
    it("rejects unsupported MIME type", () => {
      const r = validateImage("image/gif", 1024);
      expect(r.valid).toBe(false);
      expect(r.error).toContain("unsupported");
    });
    it("rejects empty file", () => {
      expect(validateImage("image/jpeg", 0).valid).toBe(false);
    });
    it("rejects file over 10 MB", () => {
      expect(validateImage("image/jpeg", 11 * 1024 * 1024).valid).toBe(false);
    });
    it("accepts exactly 10 MB", () => {
      expect(validateImage("image/jpeg", 10 * 1024 * 1024).valid).toBe(true);
    });
  });

  describe("isLowConfidence", () => {
    it("returns true when full_name below threshold", () => {
      expect(isLowConfidence({ full_name: 50 })).toBe(true);
    });
    it("returns true when id_document_number below threshold", () => {
      expect(isLowConfidence({ id_document_number: 70 })).toBe(true);
    });
    it("returns false when all scores above threshold", () => {
      expect(isLowConfidence({ full_name: 90, id_document_number: 85 })).toBe(false);
    });
    it("returns false when no critical scores present", () => {
      expect(isLowConfidence({ address: 50 })).toBe(false);
    });
  });

  describe("detectDocumentType", () => {
    it("detects Aadhaar (12 digits)", () => {
      expect(detectDocumentType("123456789012")).toBe("aadhaar");
    });
    it("detects PAN (XXXXX1234X)", () => {
      expect(detectDocumentType("ABCDE1234F")).toBe("pan");
    });
    it("detects driving license", () => {
      expect(detectDocumentType("DL0420110012345")).toBe("driving_license");
    });
    it("detects voter ID (3 alpha + 7 digits)", () => {
      expect(detectDocumentType("ABC1234567")).toBe("voter_id");
    });
    it("returns null for unrecognized", () => {
      expect(detectDocumentType("XYZ")).toBeNull();
    });
    it("returns null for empty string", () => {
      expect(detectDocumentType("")).toBeNull();
    });
    it("handles spaces and dashes in Aadhaar", () => {
      expect(detectDocumentType("1234 5678 9012")).toBe("aadhaar");
    });
  });

  describe("mapOcrFields", () => {
    it("maps standard field names", () => {
      const raw = {
        full_name: "John Doe",
        date_of_birth: "1990-01-01",
        id_document_number: "123456789012",
        address: "123 Main St",
        confidence_scores: { full_name: 95, id_document_number: 90 },
      };
      const result = mapOcrFields(raw);
      expect(result.fullName).toBe("John Doe");
      expect(result.dateOfBirth).toBe("1990-01-01");
      expect(result.idDocumentNumber).toBe("123456789012");
      expect(result.idDocumentType).toBe("aadhaar");
      expect(result.address).toBe("123 Main St");
    });

    it("handles nested fields object", () => {
      const raw = { fields: { fullName: "Jane", document_number: "ABCDE1234F" } };
      const result = mapOcrFields(raw);
      expect(result.fullName).toBe("Jane");
      expect(result.idDocumentNumber).toBe("ABCDE1234F");
    });

    it("returns nulls for empty/null input", () => {
      const result = mapOcrFields(null);
      expect(result.fullName).toBeNull();
      expect(result.idDocumentNumber).toBeNull();
      expect(result.confidenceScores).toEqual({});
    });

    it("returns nulls for non-object input", () => {
      const result = mapOcrFields("not an object");
      expect(result.fullName).toBeNull();
    });
  });

  describe("shouldScreenBlacklist", () => {
    it("returns true when idDocumentNumber present", () => {
      expect(shouldScreenBlacklist({ idDocumentNumber: "123", fullName: null, dateOfBirth: null, idDocumentType: null, address: null, photoRegionKey: null, confidenceScores: {} })).toBe(true);
    });
    it("returns false when idDocumentNumber is null", () => {
      expect(shouldScreenBlacklist({ idDocumentNumber: null, fullName: null, dateOfBirth: null, idDocumentType: null, address: null, photoRegionKey: null, confidenceScores: {} })).toBe(false);
    });
    it("returns false when idDocumentNumber is empty string", () => {
      expect(shouldScreenBlacklist({ idDocumentNumber: "", fullName: null, dateOfBirth: null, idDocumentType: null, address: null, photoRegionKey: null, confidenceScores: {} })).toBe(false);
    });
  });
});

// ── Group Visit Domain ────────────────────────────────────────────────────

import {
  isValidGroupSize,
  validateGroupSize,
  screenGroupMembers,
  confirmBulkCheckIn,
  MIN_GROUP_SIZE,
  MAX_GROUP_SIZE,
  DomainError as GVDomainError,
} from "../src/modules/group-visit/domain.js";

describe("group-visit/domain", () => {
  describe("isValidGroupSize", () => {
    it("accepts 2 (minimum)", () => { expect(isValidGroupSize(2)).toBe(true); });
    it("accepts 200 (maximum)", () => { expect(isValidGroupSize(200)).toBe(true); });
    it("accepts 50 (mid-range)", () => { expect(isValidGroupSize(50)).toBe(true); });
    it("rejects 1", () => { expect(isValidGroupSize(1)).toBe(false); });
    it("rejects 0", () => { expect(isValidGroupSize(0)).toBe(false); });
    it("rejects 201", () => { expect(isValidGroupSize(201)).toBe(false); });
    it("rejects negative", () => { expect(isValidGroupSize(-5)).toBe(false); });
    it("rejects non-integer", () => { expect(isValidGroupSize(2.5)).toBe(false); });
  });

  describe("validateGroupSize", () => {
    it("does not throw for valid size", () => {
      expect(() => validateGroupSize(10)).not.toThrow();
    });
    it("throws for invalid size", () => {
      expect(() => validateGroupSize(0)).toThrow(GVDomainError);
    });
  });

  describe("screenGroupMembers", () => {
    const blacklist = new Set(["hash-bad-1", "hash-bad-2"]);
    const watchlist = new Set(["hash-watch-1"]);

    it("flags only blacklisted members", () => {
      const members = [
        { memberId: "m1", identityDocHash: "hash-bad-1" },
        { memberId: "m2", identityDocHash: "hash-clean" },
        { memberId: "m3", identityDocHash: "hash-bad-2" },
      ];
      const results = screenGroupMembers(members, blacklist, watchlist);
      expect(results[0]).toEqual({ memberId: "m1", flagged: true, reason: "BLACKLIST_MATCH" });
      expect(results[1]).toEqual({ memberId: "m2", flagged: false });
      expect(results[2]).toEqual({ memberId: "m3", flagged: true, reason: "BLACKLIST_MATCH" });
    });

    it("does not flag watchlist-only matches", () => {
      const members = [{ memberId: "m1", identityDocHash: "hash-watch-1" }];
      const results = screenGroupMembers(members, blacklist, watchlist);
      expect(results[0]!.flagged).toBe(false);
    });

    it("does not flag members with null identityDocHash", () => {
      const members = [{ memberId: "m1", identityDocHash: null }];
      const results = screenGroupMembers(members, blacklist, watchlist);
      expect(results[0]!.flagged).toBe(false);
    });
  });

  describe("confirmBulkCheckIn", () => {
    it("matched when headcount equals scanned", () => {
      const result = confirmBulkCheckIn(10, 10);
      expect(result.matched).toBe(true);
      expect(result.discrepancyCount).toBe(0);
    });
    it("not matched with discrepancy", () => {
      const result = confirmBulkCheckIn(10, 8);
      expect(result.matched).toBe(false);
      expect(result.discrepancyCount).toBe(2);
    });
    it("throws on negative expected", () => {
      expect(() => confirmBulkCheckIn(-1, 5)).toThrow(GVDomainError);
    });
    it("throws on negative scanned", () => {
      expect(() => confirmBulkCheckIn(5, -1)).toThrow(GVDomainError);
    });
  });
});

// ── Analytics Domain ──────────────────────────────────────────────────────

import {
  computeDailyMetrics,
  computeTrends,
  type VisitRecord,
  type DailyMetric,
} from "../src/modules/analytics/domain.js";

describe("analytics/domain", () => {
  describe("computeDailyMetrics", () => {
    it("computes metrics for a set of visits", () => {
      const visits: VisitRecord[] = [
        { visitId: "1", visitorId: "v1", status: "checked_out", createdAt: new Date("2025-06-15T08:00:00Z"), approvedAt: new Date("2025-06-15T08:30:00Z"), checkedInAt: new Date("2025-06-15T09:00:00Z"), checkedOutAt: new Date("2025-06-15T10:30:00Z") },
        { visitId: "2", visitorId: "v2", status: "checked_in", createdAt: new Date("2025-06-15T10:00:00Z"), approvedAt: new Date("2025-06-15T10:15:00Z"), checkedInAt: new Date("2025-06-15T11:00:00Z"), checkedOutAt: null },
        { visitId: "3", visitorId: "v3", status: "no_show", createdAt: new Date("2025-06-15T07:00:00Z"), approvedAt: new Date("2025-06-15T07:30:00Z"), checkedInAt: null, checkedOutAt: null },
      ];
      const metrics = computeDailyMetrics(visits);
      expect(metrics.totalVisits).toBe(3);
      expect(metrics.uniqueVisitors).toBe(3);
      expect(metrics.noShowRate).toBeGreaterThan(0);
    });

    it("handles empty visits array", () => {
      const metrics = computeDailyMetrics([]);
      expect(metrics.totalVisits).toBe(0);
      expect(metrics.uniqueVisitors).toBe(0);
      expect(metrics.avgApprovalTurnaroundMs).toBeNull();
      expect(metrics.avgVisitDurationMs).toBeNull();
      expect(metrics.noShowRate).toBe(0);
    });

    it("computes average duration from completed visits", () => {
      const visits: VisitRecord[] = [
        { visitId: "1", visitorId: "v1", status: "checked_out", createdAt: new Date("2025-06-15T08:00:00Z"), approvedAt: new Date("2025-06-15T08:30:00Z"), checkedInAt: new Date("2025-06-15T09:00:00Z"), checkedOutAt: new Date("2025-06-15T10:00:00Z") },
        { visitId: "2", visitorId: "v2", status: "checked_out", createdAt: new Date("2025-06-15T10:00:00Z"), approvedAt: new Date("2025-06-15T10:30:00Z"), checkedInAt: new Date("2025-06-15T11:00:00Z"), checkedOutAt: new Date("2025-06-15T13:00:00Z") },
      ];
      const metrics = computeDailyMetrics(visits);
      // Average: (60min + 120min) / 2 = 90 minutes = 5_400_000 ms
      expect(metrics.avgVisitDurationMs).toBe(5_400_000);
    });

    it("computes unique visitors count", () => {
      const visits: VisitRecord[] = [
        { visitId: "1", visitorId: "v1", status: "checked_in", createdAt: new Date(), approvedAt: new Date(), checkedInAt: new Date(), checkedOutAt: null },
        { visitId: "2", visitorId: "v1", status: "checked_out", createdAt: new Date(), approvedAt: new Date(), checkedInAt: new Date(), checkedOutAt: new Date() },
        { visitId: "3", visitorId: "v2", status: "checked_in", createdAt: new Date(), approvedAt: new Date(), checkedInAt: new Date(), checkedOutAt: null },
      ];
      const metrics = computeDailyMetrics(visits);
      expect(metrics.uniqueVisitors).toBe(2);
    });

    it("computes no-show rate", () => {
      const visits: VisitRecord[] = [
        { visitId: "1", visitorId: "v1", status: "no_show", createdAt: new Date(), approvedAt: new Date(), checkedInAt: null, checkedOutAt: null },
        { visitId: "2", visitorId: "v2", status: "checked_in", createdAt: new Date(), approvedAt: new Date(), checkedInAt: new Date(), checkedOutAt: null },
      ];
      const metrics = computeDailyMetrics(visits);
      expect(metrics.noShowRate).toBe(0.5);
    });
  });

  describe("computeTrends", () => {
    it("aggregates daily metrics into weekly buckets", () => {
      const dailyMetrics: DailyMetric[] = [
        { date: new Date("2025-06-16T00:00:00Z"), totalVisits: 10, uniqueVisitors: 8, avgApprovalTimeMs: 1000, avgVisitDurationMs: 3600000, peakHour: 10, noShowCount: 2 },
        { date: new Date("2025-06-17T00:00:00Z"), totalVisits: 15, uniqueVisitors: 12, avgApprovalTimeMs: 1500, avgVisitDurationMs: 4500000, peakHour: 11, noShowCount: 1 },
      ];
      const trends = computeTrends(dailyMetrics, "weekly");
      expect(trends.period).toBe("weekly");
      expect(trends.buckets.length).toBeGreaterThan(0);
      expect(trends.buckets[0]!.totalVisits).toBe(25);
    });

    it("aggregates daily metrics into monthly buckets", () => {
      const dailyMetrics: DailyMetric[] = [
        { date: new Date("2025-06-16T00:00:00Z"), totalVisits: 10, uniqueVisitors: 8, avgApprovalTimeMs: null, avgVisitDurationMs: null, peakHour: null, noShowCount: 0 },
      ];
      const trends = computeTrends(dailyMetrics, "monthly");
      expect(trends.period).toBe("monthly");
      expect(trends.buckets.length).toBe(1);
    });

    it("returns empty trends for empty input", () => {
      const trends = computeTrends([], "weekly");
      expect(trends.buckets).toEqual([]);
    });
  });
});
