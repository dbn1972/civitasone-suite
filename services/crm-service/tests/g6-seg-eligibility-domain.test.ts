/**
 * G6 — Segment eligibility domain unit tests.
 *
 * These are pure-function tests covering the three domain functions:
 * - isProductEligible: check whether a product is allowed in a segment
 * - resolveChannels: determine delivery channels with override priority
 * - filterRecommendations: prune ineligible products from a recommendation set
 *
 * No DB, no network — these exercise the decision logic in isolation.
 */
import { describe, it, expect } from "vitest";
import {
  isProductEligible,
  resolveChannels,
  filterRecommendations,
  type EligibilityRule,
  type SegmentDefinition,
  type Recommendation,
} from "../src/modules/segment-eligibility/domain.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

const PRODUCT_A = "aaaa0001-0000-4000-8000-000000000001";
const PRODUCT_B = "aaaa0002-0000-4000-8000-000000000002";
const PRODUCT_C = "aaaa0003-0000-4000-8000-000000000003";
const PRODUCT_D = "aaaa0004-0000-4000-8000-000000000004";

const rulesFixture: EligibilityRule[] = [
  { segmentCode: "premium", productId: PRODUCT_A, eligible: true, channelOverride: ["sms", "whatsapp"] },
  { segmentCode: "premium", productId: PRODUCT_B, eligible: false, channelOverride: null },
  { segmentCode: "standard", productId: PRODUCT_A, eligible: true, channelOverride: null },
  { segmentCode: "standard", productId: PRODUCT_C, eligible: false, channelOverride: ["email"] },
];

const premiumSegment: SegmentDefinition = {
  segmentCode: "premium",
  priorityProducts: [PRODUCT_A, PRODUCT_C],
  primaryChannels: ["email", "push"],
};

const standardSegment: SegmentDefinition = {
  segmentCode: "standard",
  priorityProducts: [PRODUCT_A],
  primaryChannels: ["sms"],
};

// ── isProductEligible ──────────────────────────────────────────────────────────

describe("isProductEligible", () => {
  it("returns true when a rule explicitly marks the product eligible", () => {
    expect(isProductEligible("premium", PRODUCT_A, rulesFixture)).toBe(true);
  });

  it("returns false when a rule explicitly marks the product ineligible", () => {
    expect(isProductEligible("premium", PRODUCT_B, rulesFixture)).toBe(false);
  });

  it("defaults to true when no rule exists for the segment×product pair", () => {
    expect(isProductEligible("premium", PRODUCT_D, rulesFixture)).toBe(true);
  });

  it("defaults to true when no rules exist at all", () => {
    expect(isProductEligible("premium", PRODUCT_A, [])).toBe(true);
  });

  it("respects segment scope — same product can be eligible in one segment but not another", () => {
    // PRODUCT_C: no rule in premium (defaults true), explicitly blocked in standard
    expect(isProductEligible("premium", PRODUCT_C, rulesFixture)).toBe(true);
    expect(isProductEligible("standard", PRODUCT_C, rulesFixture)).toBe(false);
  });

  it("handles unknown segment codes gracefully (no rule → true)", () => {
    expect(isProductEligible("nonexistent_segment", PRODUCT_A, rulesFixture)).toBe(true);
  });
});

// ── resolveChannels ────────────────────────────────────────────────────────────

describe("resolveChannels", () => {
  it("returns channel_override when the rule has one", () => {
    const channels = resolveChannels("premium", PRODUCT_A, rulesFixture, premiumSegment);
    expect(channels).toEqual(["sms", "whatsapp"]);
  });

  it("falls back to segment primaryChannels when no channel_override", () => {
    const channels = resolveChannels("standard", PRODUCT_A, rulesFixture, standardSegment);
    expect(channels).toEqual(["sms"]);
  });

  it("falls back to segment primaryChannels when channel_override is null", () => {
    const channels = resolveChannels("premium", PRODUCT_B, rulesFixture, premiumSegment);
    expect(channels).toEqual(["email", "push"]);
  });

  it("returns empty array when both rule override and segment channels are empty", () => {
    const emptySegment: SegmentDefinition = {
      segmentCode: "bare",
      priorityProducts: [],
      primaryChannels: [],
    };
    const channels = resolveChannels("bare", PRODUCT_D, [], emptySegment);
    expect(channels).toEqual([]);
  });

  it("returns empty array when segmentDefinition is null and no rule override", () => {
    const channels = resolveChannels("premium", PRODUCT_D, rulesFixture, null);
    expect(channels).toEqual([]);
  });

  it("prefers a non-empty channel_override over segment primaryChannels", () => {
    // standard + PRODUCT_C has channelOverride ["email"] — that beats the segment's ["sms"]
    const channels = resolveChannels("standard", PRODUCT_C, rulesFixture, standardSegment);
    expect(channels).toEqual(["email"]);
  });

  it("returns segment channels for unknown segment×product when no rule exists", () => {
    const channels = resolveChannels("premium", PRODUCT_D, rulesFixture, premiumSegment);
    expect(channels).toEqual(["email", "push"]);
  });
});

// ── filterRecommendations ──────────────────────────────────────────────────────

describe("filterRecommendations", () => {
  const recommendations: Recommendation[] = [
    { id: "rec-1", productId: PRODUCT_A, score: 0.9 },
    { id: "rec-2", productId: PRODUCT_B, score: 0.8 },
    { id: "rec-3", productId: PRODUCT_C, score: 0.7 },
    { id: "rec-4", productId: PRODUCT_D, score: 0.6 },
  ];

  it("removes ineligible products from the list", () => {
    const filtered = filterRecommendations(recommendations, "premium", rulesFixture);
    // PRODUCT_B is ineligible in premium, the rest are either explicitly eligible or default-eligible
    expect(filtered.map((r) => r.id)).toEqual(["rec-1", "rec-3", "rec-4"]);
  });

  it("preserves all recommendations when all products are eligible", () => {
    const filtered = filterRecommendations(recommendations, "premium", []);
    expect(filtered).toHaveLength(4);
  });

  it("preserves order of remaining recommendations", () => {
    const filtered = filterRecommendations(recommendations, "standard", rulesFixture);
    // PRODUCT_C is ineligible in standard
    const ids = filtered.map((r) => r.id);
    expect(ids).toEqual(["rec-1", "rec-2", "rec-4"]);
  });

  it("returns empty array when all products are blocked", () => {
    const allBlocked: EligibilityRule[] = [
      { segmentCode: "locked", productId: PRODUCT_A, eligible: false, channelOverride: null },
      { segmentCode: "locked", productId: PRODUCT_B, eligible: false, channelOverride: null },
      { segmentCode: "locked", productId: PRODUCT_C, eligible: false, channelOverride: null },
      { segmentCode: "locked", productId: PRODUCT_D, eligible: false, channelOverride: null },
    ];
    const filtered = filterRecommendations(recommendations, "locked", allBlocked);
    expect(filtered).toEqual([]);
  });

  it("handles empty recommendations input", () => {
    const filtered = filterRecommendations([], "premium", rulesFixture);
    expect(filtered).toEqual([]);
  });

  it("handles empty rules (all pass through)", () => {
    const filtered = filterRecommendations(recommendations, "any_segment", []);
    expect(filtered).toHaveLength(4);
  });

  it("correctly handles a contact with a segment that has no rules at all", () => {
    const filtered = filterRecommendations(recommendations, "new_segment_no_rules", rulesFixture);
    // No rules match "new_segment_no_rules" so all products default to eligible
    expect(filtered).toHaveLength(4);
  });
});
