/**
 * Phase 3 exit criterion + DoD (g): non-municipal packs compose from the same
 * 8 blocks as the municipal pilot and clear the same publish gates.
 *
 * These assert the *universality* claim rather than the packs' contents: whatever
 * a pack's sector or pattern, it must satisfy assertDefinitionPublishable and
 * carry the block wiring FN-13's runtime needs. If a future pack is added that
 * only works because it is municipal, one of these fails.
 */
import { describe, it, expect } from "vitest";
import { assertDefinitionPublishable } from "../../catalogue/domain.js";
import { blocksFromManifest } from "../manifest-apply.js";
import { tradeLicenseManifestBlocks } from "./trade-license.js";
import { hallBookingManifestBlocks } from "./hall-booking.js";
import { eventPermissionManifestBlocks } from "./event-permission.js";

/** Every pack under test, with the Service Pattern it is authored against. */
const PACKS = [
  { key: "pack:trade-license", pattern: "certificate" as const, sector: "municipal", blocks: tradeLicenseManifestBlocks() },
  { key: "pack:hall-booking", pattern: "booking" as const, sector: "general-admin", blocks: hallBookingManifestBlocks() },
  { key: "pack:event-permission", pattern: "certificate" as const, sector: "police", blocks: eventPermissionManifestBlocks() },
];

const NON_MUNICIPAL = PACKS.filter((p) => p.sector !== "municipal");

describe("non-municipal packs — Phase 3 exit / DoD (g)", () => {
  it("ships at least two non-municipal packs across at least two sectors", () => {
    expect(NON_MUNICIPAL.length).toBeGreaterThanOrEqual(2);
    expect(new Set(NON_MUNICIPAL.map((p) => p.sector)).size).toBeGreaterThanOrEqual(2);
  });

  it("resolves every pack through the shared manifest resolver (no per-pack code path)", () => {
    for (const p of PACKS) {
      expect(blocksFromManifest(p.key, null), p.key).not.toBeNull();
    }
    // An unknown pack key must resolve to null rather than silently falling back
    // to the municipal pilot's wiring.
    expect(blocksFromManifest("pack:does-not-exist", null)).toBeNull();
  });

  describe.each(PACKS)("$key ($sector / $pattern)", (p) => {
    it("clears the same publish gates as the municipal pilot", () => {
      expect(() =>
        assertDefinitionPublishable({
          name: p.key,
          channels: p.blocks.channels as never,
          requiredDocuments: p.blocks.requiredDocuments ?? [],
          servicePattern: p.pattern,
          feeModel: p.blocks.feeModel,
          hoaCode: p.blocks.hoaCode,
        }),
      ).not.toThrow();
    });

    it("carries an HOA code — fee-bearing patterns cannot publish without one (FN-14)", () => {
      expect(p.blocks.hoaCode).toBeTruthy();
      expect(String(p.blocks.hoaCode).trim().length).toBeGreaterThan(0);
    });

    it("embeds a form design so FN-13 renders with no per-service frontend", () => {
      const forms = p.blocks.forms as Array<{ formDesign?: { sections?: unknown[]; fields?: object } }>;
      expect(forms?.length).toBeGreaterThan(0);
      const design = forms[0]?.formDesign;
      expect(design?.sections?.length).toBeGreaterThan(0);
      expect(Object.keys(design?.fields ?? {}).length).toBeGreaterThan(0);
    });

    it("declares at least one channel and one output", () => {
      expect((p.blocks.channels ?? []).length).toBeGreaterThan(0);
      expect((p.blocks.outputs ?? []).length).toBeGreaterThan(0);
    });

    it("gives every lane an SLA and an escalation designation (FN-25)", () => {
      const lanes = p.blocks.laneBindings ?? [];
      expect(lanes.length).toBeGreaterThan(0);
      for (const lane of lanes) {
        expect(lane.slaDays, `${lane.key} slaDays`).toBeGreaterThan(0);
        expect(lane.escalationDesignationId, `${lane.key} escalation`).toBeTruthy();
      }
    });

    it("verifies every mandatory document at a real workflow lane (FN-26)", () => {
      const laneKeys = new Set((p.blocks.laneBindings ?? []).map((l) => l.key));
      for (const doc of p.blocks.requiredDocuments ?? []) {
        if (!doc.mandatory) continue;
        expect(doc.verifiedAtLane, `${doc.docType} verifiedAtLane`).toBeTruthy();
        expect(laneKeys, `${doc.docType} -> unknown lane ${doc.verifiedAtLane}`).toContain(doc.verifiedAtLane);
      }
    });
  });

  it("hall booking omits eligibility — B3 is hidden for the Booking pattern", () => {
    // Not an oversight: hiddenBlocksForPattern("booking") hides b3, so wiring an
    // eligibility rule set would create a block the designer can never reach.
    // Assert the key is absent outright, not merely undefined.
    expect(Object.hasOwn(hallBookingManifestBlocks(), "eligibilityRuleSetId")).toBe(false);
  });

  it("keeps pack identifiers distinct so imports cannot collide", () => {
    const formIds = PACKS.map((p) => p.blocks.formId);
    expect(new Set(formIds).size).toBe(PACKS.length);
    const numbering = PACKS.map((p) => (p.blocks.outputs?.[0] as { numberingFormat?: string })?.numberingFormat);
    expect(new Set(numbering).size).toBe(PACKS.length);
  });
});
