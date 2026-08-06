/**
 * G5 — segment taxonomy domain logic, exercised on every branch without a database.
 *
 * The interesting decisions all live here: which transitions are legal, that canonical
 * rows are immutable whoever asks, that the channel vocabulary is the service's one
 * list, and — the guarantee this item hinges on — that with enforcement OFF the answer
 * is always "allowed", no matter what the value or the catalogue is.
 */
import { describe, it, expect } from "vitest";
import {
  SEGMENT_CODE_PATTERN,
  PRODUCT_CODE_PATTERN,
  SEGMENT_ERROR_CODES,
  isSegmentStatus,
  isMutable,
  unknownChannels,
  knownChannels,
  duplicateProducts,
  canPublish,
  canDeprecate,
  isEligible,
  toEligibility,
  decideSegmentValue,
} from "../src/modules/segments/domain.js";
import { LEAD_CHANNELS, isLeadChannel } from "../src/modules/leads/channels.js";
import type { SegmentDefinitionView } from "../src/modules/segments/schema.js";

function view(over: Partial<SegmentDefinitionView> = {}): SegmentDefinitionView {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    segmentCode: "SMALL_BUSINESS",
    displayName: "Small Business",
    description: null,
    governance: "tenant",
    priorityProducts: ["PARCEL_EXPRESS", "LOGISTICS_POST"],
    primaryChannels: ["email", "telephony"],
    status: "published",
    versionNumber: 2,
    publishedAt: "2026-07-05T09:00:00.000Z",
    deprecatedAt: null,
    version: 3,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-05T09:00:00.000Z",
    ...over,
  };
}

describe("segment code / product code patterns", () => {
  it.each(["AB", "SMALL_BUSINESS", "seg-1", "A1_b-2", "a".repeat(64)])("accepts %s", (code) => {
    expect(SEGMENT_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each(["", "A", "_LEADING", "-leading", "has space", "has!bang", "a".repeat(65)])(
    "rejects %s",
    (code) => {
      expect(SEGMENT_CODE_PATTERN.test(code)).toBe(false);
    },
  );

  it("accepts a one-character product code but not an empty one", () => {
    expect(PRODUCT_CODE_PATTERN.test("P")).toBe(true);
    expect(PRODUCT_CODE_PATTERN.test("")).toBe(false);
  });

  it("accepts dots in a product code (versioned SKUs) but not spaces", () => {
    expect(PRODUCT_CODE_PATTERN.test("PARCEL.EXPRESS-2")).toBe(true);
    expect(PRODUCT_CODE_PATTERN.test("PARCEL EXPRESS")).toBe(false);
  });
});

describe("isSegmentStatus", () => {
  it.each(["draft", "published", "deprecated"])("recognises %s", (s) => {
    expect(isSegmentStatus(s)).toBe(true);
  });

  it.each([["retired"], [null], [undefined], [3], [{}]])("rejects %s", (s) => {
    expect(isSegmentStatus(s)).toBe(false);
  });
});

describe("isMutable — canonical rows are immutable regardless of role", () => {
  it("refuses canonical", () => {
    expect(isMutable("canonical")).toBe(false);
  });

  it("allows tenant", () => {
    expect(isMutable("tenant")).toBe(true);
  });

  it("treats an unrecognised governance value as mutable (only canonical is locked)", () => {
    expect(isMutable("something-else")).toBe(true);
  });
});

describe("channel vocabulary is the service's single list", () => {
  it("reuses the inbound lead-capture channels verbatim", () => {
    expect(knownChannels()).toEqual([...LEAD_CHANNELS]);
  });

  it("accepts every known channel", () => {
    expect(unknownChannels([...LEAD_CHANNELS])).toEqual([]);
  });

  it("reports channels outside the closed set", () => {
    expect(unknownChannels(["email", "sms", "pigeon"])).toEqual(["sms", "pigeon"]);
  });

  it("treats an empty list as valid — a segment need not declare channels", () => {
    expect(unknownChannels([])).toEqual([]);
  });

  it("isLeadChannel guards non-strings", () => {
    expect(isLeadChannel("email")).toBe(true);
    expect(isLeadChannel("EMAIL")).toBe(false);
    expect(isLeadChannel(undefined)).toBe(false);
    expect(isLeadChannel(7)).toBe(false);
  });
});

describe("duplicateProducts — priority order must be unambiguous", () => {
  it("finds nothing in a clean ordered list", () => {
    expect(duplicateProducts(["A", "B", "C"])).toEqual([]);
  });

  it("reports each repeated code once", () => {
    expect(duplicateProducts(["A", "B", "A", "B", "A"])).toEqual(["A", "B"]);
  });

  it("handles an empty list", () => {
    expect(duplicateProducts([])).toEqual([]);
  });
});

describe("lifecycle transitions", () => {
  it("publishes a draft", () => {
    expect(canPublish("draft")).toBe(true);
  });

  it("re-publishes a deprecated segment — that is how a taxonomy entry is reinstated", () => {
    expect(canPublish("deprecated")).toBe(true);
  });

  it("refuses to publish an already published segment rather than inflating its revision", () => {
    expect(canPublish("published")).toBe(false);
  });

  it("deprecates only a published segment", () => {
    expect(canDeprecate("published")).toBe(true);
    expect(canDeprecate("draft")).toBe(false);
    expect(canDeprecate("deprecated")).toBe(false);
  });

  it("treats only published as eligible", () => {
    expect(isEligible("published")).toBe(true);
    expect(isEligible("draft")).toBe(false);
    expect(isEligible("deprecated")).toBe(false);
  });
});

describe("toEligibility — the stable contract", () => {
  it("carries the code, revision, ordered products and ordered channels", () => {
    expect(toEligibility(view())).toEqual({
      segmentCode: "SMALL_BUSINESS",
      displayName: "Small Business",
      status: "published",
      versionNumber: 2,
      priorityProducts: ["PARCEL_EXPRESS", "LOGISTICS_POST"],
      primaryChannels: ["email", "telephony"],
      publishedAt: "2026-07-05T09:00:00.000Z",
    });
  });

  it("preserves configured order exactly — nothing re-sorts priority", () => {
    const products = ["Z_LAST_ALPHABETICALLY", "A_FIRST_ALPHABETICALLY", "M_MIDDLE"];
    expect(toEligibility(view({ priorityProducts: products })).priorityProducts).toEqual(products);
  });

  it("copies the arrays so a consumer cannot mutate the cached definition", () => {
    const source = view();
    const projected = toEligibility(source);
    projected.priorityProducts.push("INJECTED");
    expect(source.priorityProducts).toEqual(["PARCEL_EXPRESS", "LOGISTICS_POST"]);
  });

  it("tolerates a segment with no products or channels configured yet", () => {
    const projected = toEligibility(view({ priorityProducts: [], primaryChannels: [] }));
    expect(projected.priorityProducts).toEqual([]);
    expect(projected.primaryChannels).toEqual([]);
  });
});

describe("decideSegmentValue — the backward-compatibility guarantee", () => {
  const codes = ["ENTERPRISE", "SMALL_BUSINESS"];

  it("allows ANY free-text value when enforcement is off", () => {
    for (const value of ["enterprise", "ENT", "entrprise", "🚚", "x".repeat(64)]) {
      expect(decideSegmentValue(value, false, codes)).toEqual({ allowed: true });
    }
  });

  it("allows a value with enforcement off even when the catalogue is empty", () => {
    expect(decideSegmentValue("anything", false, [])).toEqual({ allowed: true });
  });

  it("allows a published code when enforcement is on", () => {
    expect(decideSegmentValue("ENTERPRISE", true, codes)).toEqual({ allowed: true });
  });

  it("refuses an unpublished code when enforcement is on, and lists the valid codes", () => {
    const decision = decideSegmentValue("enterprise", true, codes);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe(SEGMENT_ERROR_CODES.notInCatalogue);
    expect(decision.validCodes).toEqual(["ENTERPRISE", "SMALL_BUSINESS"]);
  });

  it("is case sensitive — a code is a machine key, not a label", () => {
    expect(decideSegmentValue("Enterprise", true, codes).allowed).toBe(false);
  });

  it("returns the valid codes sorted, whatever order they arrive in", () => {
    expect(decideSegmentValue("nope", true, ["ZED", "ALPHA", "MID"]).validCodes).toEqual([
      "ALPHA",
      "MID",
      "ZED",
    ]);
  });

  it("refuses everything when enforcement is on and nothing is published", () => {
    const decision = decideSegmentValue("ENTERPRISE", true, []);
    expect(decision.allowed).toBe(false);
    expect(decision.validCodes).toEqual([]);
  });

  it.each([[null], [undefined], [""], ["   "]])(
    "always allows a cleared segment (%s) — enforcement governs vocabulary, not presence",
    (value) => {
      expect(decideSegmentValue(value as string | null | undefined, true, codes)).toEqual({
        allowed: true,
      });
      expect(decideSegmentValue(value as string | null | undefined, false, codes)).toEqual({
        allowed: true,
      });
    },
  );
});
