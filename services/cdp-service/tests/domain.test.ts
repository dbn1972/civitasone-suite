/**
 * CDP Service — Domain logic unit tests.
 * Covers all pure functions across profiles, identity, events, and segments modules.
 */
import { describe, it, expect } from "vitest";

import {
  mergeProfiles,
  validateMerge,
  computeMatchConfidence,
} from "../src/modules/profiles/domain.js";

import {
  normalizeIdentifier,
  hashIdentifier,
  deterministicConfidence,
  fuzzyNameConfidence,
} from "../src/modules/identity/domain.js";

import {
  requiredConsent,
  validateConsent,
  validateBatchConsent,
  MAX_BATCH_SIZE,
} from "../src/modules/events/domain.js";

import { validateCriteria } from "../src/modules/segments/domain.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const TENANT_2 = "aaaaaaaa-0002-4000-8000-000000000002";

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bbbbbbbb-1111-4000-8000-000000000001",
    tenantId: TENANT,
    profileType: "individual",
    attributes: { name: "Rajesh Kumar", email: "raj@example.com" } as Record<string, unknown>,
    sourceLineage: [{ source: "crm", sourceId: "c1", timestamp: "2025-01-01T00:00:00Z" }],
    mergedFromIds: [] as string[],
    version: 1,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    createdBy: "user-1",
    updatedBy: "user-1",
    ...overrides,
  };
}

// ── PROFILES DOMAIN ───────────────────────────────────────────────────────────

describe("profiles/domain", () => {
  describe("mergeProfiles()", () => {
    it("default config (newest wins) — winner attributes override loser", () => {
      const winner = makeProfileRow({
        attributes: { name: "Winner Name", email: "winner@test.com" },
        sourceLineage: [{ source: "crm", sourceId: "w1", timestamp: "2025-06-01T00:00:00Z" }],
      });
      const loser = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        attributes: { name: "Loser Name", email: "loser@test.com", phone: "9876543210" },
        sourceLineage: [{ source: "web", sourceId: "l1", timestamp: "2025-05-01T00:00:00Z" }],
      });

      const result = mergeProfiles(winner as any, loser as any);

      // Winner's attributes take precedence on overlapping keys
      expect(result.attributes.name).toBe("Winner Name");
      expect(result.attributes.email).toBe("winner@test.com");
      // Loser's unique attributes are preserved
      expect(result.attributes.phone).toBe("9876543210");
    });

    it("default config — combines source lineage (deduplicates by sourceId)", () => {
      const winner = makeProfileRow({
        sourceLineage: [
          { source: "crm", sourceId: "shared", timestamp: "2025-06-01T00:00:00Z" },
          { source: "crm", sourceId: "w-only", timestamp: "2025-06-01T00:00:00Z" },
        ],
      });
      const loser = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        sourceLineage: [
          { source: "web", sourceId: "shared", timestamp: "2025-05-01T00:00:00Z" },
          { source: "web", sourceId: "l-only", timestamp: "2025-05-01T00:00:00Z" },
        ],
      });

      const result = mergeProfiles(winner as any, loser as any);

      // Shared sourceId not duplicated
      const sourceIds = result.sourceLineage.map((s) => s.sourceId);
      expect(sourceIds).toContain("shared");
      expect(sourceIds).toContain("w-only");
      expect(sourceIds).toContain("l-only");
      expect(sourceIds.filter((id) => id === "shared")).toHaveLength(1);
    });

    it("most_complete strategy — fills gaps from loser when winner has null/empty", () => {
      const winner = makeProfileRow({
        attributes: { name: "Winner", email: "", phone: null, city: "Delhi" },
      });
      const loser = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        attributes: { name: "Loser", email: "loser@test.com", phone: "9876543210", city: "Mumbai" },
      });

      const result = mergeProfiles(winner as any, loser as any, { strategy: "most_complete" });

      // Winner's non-empty values win
      expect(result.attributes.name).toBe("Winner");
      expect(result.attributes.city).toBe("Delhi");
      // Loser fills gaps for empty/null winner attributes
      expect(result.attributes.email).toBe("loser@test.com");
      expect(result.attributes.phone).toBe("9876543210");
    });

    it("most_complete strategy — does not overwrite good winner values", () => {
      const winner = makeProfileRow({
        attributes: { name: "Winner Name", email: "winner@test.com" },
      });
      const loser = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        attributes: { name: "Loser Name", email: "loser@test.com" },
      });

      const result = mergeProfiles(winner as any, loser as any, { strategy: "most_complete" });

      expect(result.attributes.name).toBe("Winner Name");
      expect(result.attributes.email).toBe("winner@test.com");
    });

    it("winner with empty attributes — takes all from loser", () => {
      const winner = makeProfileRow({ attributes: {} });
      const loser = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        attributes: { name: "Loser", email: "loser@test.com" },
      });

      const result = mergeProfiles(winner as any, loser as any);

      expect(result.attributes.name).toBe("Loser");
      expect(result.attributes.email).toBe("loser@test.com");
    });

    it("loser with empty attributes — keeps winner intact", () => {
      const winner = makeProfileRow({
        attributes: { name: "Winner", email: "w@t.com" },
      });
      const loser = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        attributes: {},
        sourceLineage: [{ source: "web", sourceId: "l1", timestamp: "2025-01-01T00:00:00Z" }],
      });

      const result = mergeProfiles(winner as any, loser as any);

      expect(result.attributes.name).toBe("Winner");
      expect(result.attributes.email).toBe("w@t.com");
    });
  });

  describe("validateMerge()", () => {
    it("returns error when merging profile with itself", () => {
      const profile = makeProfileRow();
      expect(validateMerge(profile as any, profile as any)).toBe(
        "cannot merge a profile with itself",
      );
    });

    it("returns error when profiles are from different tenants", () => {
      const a = makeProfileRow();
      const b = makeProfileRow({ id: "bbbbbbbb-2222-4000-8000-000000000002", tenantId: TENANT_2 });
      expect(validateMerge(a as any, b as any)).toBe(
        "cannot merge profiles from different tenants",
      );
    });

    it("returns error when profiles have different types", () => {
      const a = makeProfileRow({ profileType: "individual" });
      const b = makeProfileRow({
        id: "bbbbbbbb-2222-4000-8000-000000000002",
        profileType: "organization",
      });
      expect(validateMerge(a as any, b as any)).toBe(
        "cannot merge profiles of different types",
      );
    });

    it("returns null for valid merge (same tenant, same type, different ids)", () => {
      const a = makeProfileRow();
      const b = makeProfileRow({ id: "bbbbbbbb-2222-4000-8000-000000000002" });
      expect(validateMerge(a as any, b as any)).toBeNull();
    });
  });

  describe("computeMatchConfidence()", () => {
    it("returns 1.0 for full match on all present weighted keys", () => {
      const attrs = { email: "a@b.com", phone: "123", name: "Test" };
      expect(computeMatchConfidence(attrs, attrs)).toBe(1);
    });

    it("returns partial confidence for partial match", () => {
      const a = { email: "a@b.com", phone: "111", name: "Test" };
      const b = { email: "a@b.com", phone: "222", name: "Test" };
      const confidence = computeMatchConfidence(a, b);
      // email matches (0.4), phone differs (0), name matches (0.2) → 0.6 / 0.9
      expect(confidence).toBeCloseTo(0.6 / 0.9, 4);
    });

    it("returns 0 for no matching values on overlapping keys", () => {
      const a = { email: "a@b.com", phone: "111" };
      const b = { email: "x@y.com", phone: "222" };
      expect(computeMatchConfidence(a, b)).toBe(0);
    });

    it("returns 0 when no overlapping keys exist", () => {
      const a = { city: "Delhi" };
      const b = { country: "India" };
      expect(computeMatchConfidence(a, b)).toBe(0);
    });

    it("returns 0 for zero-weight keys (custom weights with 0)", () => {
      const a = { email: "a@b.com" };
      const b = { email: "a@b.com" };
      const weights = { email: 0 };
      // totalWeight will be 0, so result is 0
      expect(computeMatchConfidence(a, b, weights)).toBe(0);
    });

    it("respects custom weight configuration", () => {
      const a = { email: "a@b.com", externalId: "ext-1" };
      const b = { email: "a@b.com", externalId: "ext-2" };
      const weights = { email: 1.0, externalId: 1.0 };
      // email matches (1.0), externalId differs (0) → 1.0 / 2.0 = 0.5
      expect(computeMatchConfidence(a, b, weights)).toBe(0.5);
    });

    it("only counts keys that exist in both objects", () => {
      const a = { email: "a@b.com" };
      const b = { email: "a@b.com", phone: "123" };
      // Only email overlaps — totalWeight=0.4, matched=0.4 → 1.0
      expect(computeMatchConfidence(a, b)).toBe(1);
    });
  });
});

// ── IDENTITY DOMAIN ───────────────────────────────────────────────────────────

describe("identity/domain", () => {
  describe("normalizeIdentifier()", () => {
    it("email — lowercases and trims", () => {
      expect(normalizeIdentifier("email", "  Raj@Example.COM  ")).toBe("raj@example.com");
    });

    it("email — handles already normalized input", () => {
      expect(normalizeIdentifier("email", "test@test.com")).toBe("test@test.com");
    });

    it("phone — strips non-digits and keeps last 10", () => {
      expect(normalizeIdentifier("phone", "+91-98765-43210")).toBe("9876543210");
    });

    it("phone — short number stays as-is (less than 10 digits)", () => {
      expect(normalizeIdentifier("phone", "12345")).toBe("12345");
    });

    it("phone — exactly 10 digits stays unchanged", () => {
      expect(normalizeIdentifier("phone", "9876543210")).toBe("9876543210");
    });

    it("phone — strips spaces and parentheses", () => {
      expect(normalizeIdentifier("phone", "(091) 9988 776655")).toBe("9988776655");
    });

    it("default type — trims and lowercases", () => {
      expect(normalizeIdentifier("externalId", "  ABC-123  ")).toBe("abc-123");
    });

    it("unknown type — trims and lowercases", () => {
      expect(normalizeIdentifier("custom", "  Hello World  ")).toBe("hello world");
    });
  });

  describe("hashIdentifier()", () => {
    it("same type and value produce the same hash", () => {
      const h1 = hashIdentifier("email", "test@test.com");
      const h2 = hashIdentifier("email", "test@test.com");
      expect(h1).toBe(h2);
    });

    it("normalization applied before hashing (case insensitive email)", () => {
      const h1 = hashIdentifier("email", "Test@Test.COM");
      const h2 = hashIdentifier("email", "test@test.com");
      expect(h1).toBe(h2);
    });

    it("different types produce different hashes for same value", () => {
      const emailHash = hashIdentifier("email", "12345");
      const phoneHash = hashIdentifier("phone", "12345");
      expect(emailHash).not.toBe(phoneHash);
    });

    it("different values produce different hashes", () => {
      const h1 = hashIdentifier("email", "a@b.com");
      const h2 = hashIdentifier("email", "x@y.com");
      expect(h1).not.toBe(h2);
    });

    it("returns a 64-character hex string (SHA-256)", () => {
      const hash = hashIdentifier("email", "test@test.com");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("deterministicConfidence()", () => {
    it("email returns 1.0", () => {
      expect(deterministicConfidence("email")).toBe(1.0);
    });

    it("externalId returns 1.0", () => {
      expect(deterministicConfidence("externalId")).toBe(1.0);
    });

    it("phone returns 0.95", () => {
      expect(deterministicConfidence("phone")).toBe(0.95);
    });

    it("unknown type returns 0.9", () => {
      expect(deterministicConfidence("custom")).toBe(0.9);
    });

    it("empty string returns 0.9 (default)", () => {
      expect(deterministicConfidence("")).toBe(0.9);
    });
  });

  describe("fuzzyNameConfidence()", () => {
    it("exact match returns 0.9", () => {
      expect(fuzzyNameConfidence("Rajesh Kumar", "Rajesh Kumar")).toBe(0.9);
    });

    it("case-insensitive exact match returns 0.9", () => {
      expect(fuzzyNameConfidence("RAJESH KUMAR", "rajesh kumar")).toBe(0.9);
    });

    it("exact match with extra whitespace returns 0.9", () => {
      expect(fuzzyNameConfidence("  Rajesh Kumar  ", "Rajesh Kumar")).toBe(0.9);
    });

    it("partial token overlap returns intermediate score", () => {
      // "rajesh kumar" vs "rajesh singh" → tokens: {rajesh, kumar} ∩ {rajesh, singh} = {rajesh}
      // jaccard = 1/3, confidence = (1/3) * 0.8 = 0.2667
      const score = fuzzyNameConfidence("Rajesh Kumar", "Rajesh Singh");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.9);
      expect(score).toBeCloseTo(0.2667, 3);
    });

    it("no overlap returns 0", () => {
      // {alice} ∩ {bob} = empty → jaccard=0 → 0
      const score = fuzzyNameConfidence("Alice", "Bob");
      expect(score).toBe(0);
    });

    it("empty strings return 0.9 (both normalize to same empty string)", () => {
      // Both trim to "", split on whitespace gives [""], sets are equal
      // Actually: "".split(/\s+/) = [""] so tokensA = {""}, tokensB = {""}
      // intersection = [""], union.size = 1, jaccard = 1 → but a === b → 0.9
      expect(fuzzyNameConfidence("", "")).toBe(0.9);
    });

    it("one empty string vs non-empty", () => {
      // a="" trim="", b="test" trim="test" → not equal
      // tokensA = {""}, tokensB = {"test"} → intersection empty
      // union = {"", "test"}, jaccard = 0/2 = 0
      const score = fuzzyNameConfidence("", "Test");
      expect(score).toBe(0);
    });

    it("multi-token overlap", () => {
      // "A B C" vs "A B D" → {a,b,c} ∩ {a,b,d} = {a,b}, union={a,b,c,d}
      // jaccard = 2/4 = 0.5, confidence = 0.5 * 0.8 = 0.4
      const score = fuzzyNameConfidence("A B C", "A B D");
      expect(score).toBeCloseTo(0.4, 4);
    });
  });
});

// ── EVENTS DOMAIN ─────────────────────────────────────────────────────────────

describe("events/domain", () => {
  describe("requiredConsent()", () => {
    it("marketing.* events require marketing consent", () => {
      expect(requiredConsent("marketing.email_sent")).toBe("marketing");
      expect(requiredConsent("marketing.sms_blast")).toBe("marketing");
    });

    it("campaign.* events require marketing consent", () => {
      expect(requiredConsent("campaign.clicked")).toBe("marketing");
    });

    it("analytics.* events require analytics consent", () => {
      expect(requiredConsent("analytics.page_view")).toBe("analytics");
      expect(requiredConsent("analytics.funnel_step")).toBe("analytics");
    });

    it("tracking.* events require analytics consent", () => {
      expect(requiredConsent("tracking.location")).toBe("analytics");
    });

    it("notification.* events require communication consent", () => {
      expect(requiredConsent("notification.push")).toBe("communication");
      expect(requiredConsent("notification.email")).toBe("communication");
    });

    it("comm.* events require communication consent", () => {
      expect(requiredConsent("comm.sms")).toBe("communication");
    });

    it("transactional events (order, payment, login) return null (no consent needed)", () => {
      expect(requiredConsent("order.placed")).toBeNull();
      expect(requiredConsent("payment.received")).toBeNull();
      expect(requiredConsent("login.success")).toBeNull();
      expect(requiredConsent("account.created")).toBeNull();
    });
  });

  describe("validateConsent()", () => {
    it("allowed — profile has consented to the required category", () => {
      const result = validateConsent("marketing.email", { marketing: true });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("allowed — analytics consent granted", () => {
      const result = validateConsent("analytics.page_view", { analytics: true, marketing: false });
      expect(result.allowed).toBe(true);
    });

    it("denied — consent flags are undefined (no consent record)", () => {
      const result = validateConsent("marketing.email", undefined);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("consent record missing");
      expect(result.reason).toContain("marketing");
    });

    it("denied — consent flag is false", () => {
      const result = validateConsent("marketing.sms", { marketing: false });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("has not consented to marketing");
    });

    it("denied — consent flag is missing for the required category", () => {
      const result = validateConsent("analytics.track", { marketing: true });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("has not consented to analytics");
    });

    it("transactional events are always allowed (no consent needed)", () => {
      const result = validateConsent("order.placed", undefined);
      expect(result.allowed).toBe(true);
    });

    it("transactional events allowed even with empty consent flags", () => {
      const result = validateConsent("payment.success", {});
      expect(result.allowed).toBe(true);
    });

    it("communication consent required for notification events", () => {
      const result = validateConsent("notification.push", { communication: true });
      expect(result.allowed).toBe(true);
    });

    it("communication consent denied for notification events", () => {
      const result = validateConsent("notification.push", { communication: false });
      expect(result.allowed).toBe(false);
    });
  });

  describe("validateBatchConsent()", () => {
    it("returns empty array when all events are allowed", () => {
      const events = [
        { eventType: "order.placed", profileConsent: undefined },
        { eventType: "marketing.email", profileConsent: { marketing: true } },
        { eventType: "analytics.view", profileConsent: { analytics: true } },
      ];
      const rejections = validateBatchConsent(events);
      expect(rejections).toHaveLength(0);
    });

    it("returns rejections for denied events with correct indices", () => {
      const events = [
        { eventType: "order.placed", profileConsent: undefined }, // allowed
        { eventType: "marketing.email", profileConsent: { marketing: false } }, // denied
        { eventType: "analytics.view", profileConsent: { analytics: true } }, // allowed
        { eventType: "notification.push", profileConsent: undefined }, // denied
      ];
      const rejections = validateBatchConsent(events);
      expect(rejections).toHaveLength(2);
      expect(rejections[0]!.index).toBe(1);
      expect(rejections[0]!.reason).toContain("marketing");
      expect(rejections[1]!.index).toBe(3);
      expect(rejections[1]!.reason).toContain("communication");
    });

    it("handles empty batch", () => {
      const rejections = validateBatchConsent([]);
      expect(rejections).toHaveLength(0);
    });

    it("all events rejected when no consent", () => {
      const events = [
        { eventType: "marketing.a", profileConsent: undefined },
        { eventType: "analytics.b", profileConsent: undefined },
        { eventType: "notification.c", profileConsent: undefined },
      ];
      const rejections = validateBatchConsent(events);
      expect(rejections).toHaveLength(3);
    });
  });

  describe("MAX_BATCH_SIZE", () => {
    it("is 100", () => {
      expect(MAX_BATCH_SIZE).toBe(100);
    });
  });
});

// ── SEGMENTS DOMAIN ───────────────────────────────────────────────────────────

describe("segments/domain", () => {
  describe("validateCriteria()", () => {
    it("returns null for valid criteria", () => {
      const criteria = {
        conditions: [
          { field: "attributes.city", operator: "eq", value: "Delhi" },
          { field: "attributes.age", operator: "gte", value: 18 },
        ],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBeNull();
    });

    it("returns null for valid criteria with 'or' logic", () => {
      const criteria = {
        conditions: [{ field: "profileType", operator: "eq", value: "individual" }],
        logic: "or",
      };
      expect(validateCriteria(criteria)).toBeNull();
    });

    it("returns error when conditions is missing", () => {
      const criteria = { logic: "and" };
      expect(validateCriteria(criteria)).toBe("criteria.conditions must be an array");
    });

    it("returns error when conditions is not an array", () => {
      const criteria = { conditions: "invalid", logic: "and" };
      expect(validateCriteria(criteria)).toBe("criteria.conditions must be an array");
    });

    it("returns error when conditions is null", () => {
      const criteria = { conditions: null, logic: "and" };
      expect(validateCriteria(criteria)).toBe("criteria.conditions must be an array");
    });

    it("returns error when logic is invalid", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "eq", value: 1 }],
        logic: "xor",
      };
      expect(validateCriteria(criteria)).toBe("criteria.logic must be 'and' or 'or'");
    });

    it("returns error when logic is missing", () => {
      const criteria = { conditions: [] };
      expect(validateCriteria(criteria)).toBe("criteria.logic must be 'and' or 'or'");
    });

    it("returns error when condition has invalid operator", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "like", value: "test" }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBe("invalid operator: like");
    });

    it("returns error when condition is missing field", () => {
      const criteria = {
        conditions: [{ operator: "eq", value: "test" }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBe("each condition must have a string 'field'");
    });

    it("returns error when field is not a string", () => {
      const criteria = {
        conditions: [{ field: 123, operator: "eq", value: "test" }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBe("each condition must have a string 'field'");
    });

    it("returns error when condition is missing operator", () => {
      const criteria = {
        conditions: [{ field: "x", value: "test" }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBe("each condition must have a string 'operator'");
    });

    it("returns error when condition is missing value", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "eq" }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBe("each condition must have a 'value'");
    });

    it("allows value of 0 (falsy but defined)", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "eq", value: 0 }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBeNull();
    });

    it("allows value of empty string", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "eq", value: "" }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBeNull();
    });

    it("allows value of false (boolean)", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "eq", value: false }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBeNull();
    });

    it("allows value of null", () => {
      const criteria = {
        conditions: [{ field: "x", operator: "eq", value: null }],
        logic: "and",
      };
      expect(validateCriteria(criteria)).toBeNull();
    });

    it("validates all supported operators", () => {
      const validOps = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"];
      for (const op of validOps) {
        const criteria = {
          conditions: [{ field: "x", operator: op, value: "v" }],
          logic: "and",
        };
        expect(validateCriteria(criteria)).toBeNull();
      }
    });

    it("returns null for empty conditions array (valid structure)", () => {
      const criteria = { conditions: [], logic: "and" };
      expect(validateCriteria(criteria)).toBeNull();
    });
  });
});
