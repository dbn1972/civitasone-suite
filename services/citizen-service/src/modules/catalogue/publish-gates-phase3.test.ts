/**
 * Phase 3 wiring — the publish gates are actually enforced.
 *
 * #561 shipped the gate functions; this asserts they are reachable from the one
 * place a definition is refused publication. Without these, a malformed override
 * or a webhook aimed at an internal host would publish cleanly and fail (or leak)
 * only at runtime.
 */
import { describe, it, expect } from "vitest";
import { assertDefinitionPublishable } from "./domain.js";

const ZONE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ZONE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const SECRET = "x".repeat(24);

/** Minimal definition that already satisfies every pre-Phase-3 rule. */
function base(over: Record<string, unknown> = {}) {
  return {
    name: "Hall Booking",
    channels: ["portal"] as never,
    requiredDocuments: [{ docType: "id_proof", label: "Identity proof", mandatory: true }],
    servicePattern: "booking" as never,
    feeModel: "flat" as never,
    hoaCode: "1601",
    ...over,
  };
}

describe("Phase 3 gates reachable from assertDefinitionPublishable", () => {
  it("publishes a definition with no Phase 3 config at all", () => {
    // Every Phase 3 block is optional; existing definitions must be unaffected.
    expect(() => assertDefinitionPublishable(base())).not.toThrow();
  });

  it("publishes a definition with well-formed Phase 3 config", () => {
    expect(() =>
      assertDefinitionPublishable(base({
        offeringOfficeIds: [ZONE_A, ZONE_B],
        officeOverrides: [{ officeId: ZONE_A, feeFromMinor: 50000 }],
        webhookSubscriptions: [{
          id: "police", url: "https://police.odisha.gov.in/hook",
          events: ["application.issued"], secret: SECRET, active: true,
        }],
        appealLinkage: { appealable: true, appellateDesignationId: "dsg-appellate" },
        rtiLinkage: { published: true, pioDesignationId: "dsg-pio" },
      })),
    ).not.toThrow();
  });

  describe("FN-22 office overrides", () => {
    it("blocks an override for an office not offering the service", () => {
      expect(() =>
        assertDefinitionPublishable(base({
          offeringOfficeIds: [ZONE_A],
          officeOverrides: [{ officeId: ZONE_B, feeFromMinor: 1 }],
        })),
      ).toThrow(/OVERRIDE_OFFICE_NOT_OFFERING/);
    });

    it("blocks a local document that shadows a pack document", () => {
      // Otherwise an office could quietly re-declare a mandatory document as optional.
      expect(() =>
        assertDefinitionPublishable(base({
          officeOverrides: [{
            officeId: ZONE_A,
            additionalDocuments: [{ docType: "id_proof", label: "ID", mandatory: false }],
          }],
        })),
      ).toThrow(/OVERRIDE_DOCUMENT_SHADOWS_PACK/);
    });

    it("blocks a negative fee", () => {
      expect(() =>
        assertDefinitionPublishable(base({ officeOverrides: [{ officeId: ZONE_A, feeFromMinor: -1 }] })),
      ).toThrow(/OVERRIDE_BAD_FEE/);
    });
  });

  describe("FN-30 webhooks", () => {
    it("blocks an endpoint pointing into the platform's own network", () => {
      // The SSRF check has to run at publish; that is where the URL enters.
      expect(() =>
        assertDefinitionPublishable(base({
          webhookSubscriptions: [{
            id: "evil", url: "https://169.254.169.254/latest/meta-data/",
            events: ["application.issued"], secret: SECRET, active: true,
          }],
        })),
      ).toThrow(/WEBHOOK_FORBIDDEN_HOST/);
    });

    it("blocks a plaintext endpoint", () => {
      expect(() =>
        assertDefinitionPublishable(base({
          webhookSubscriptions: [{
            id: "plain", url: "http://police.gov.in/hook",
            events: ["application.issued"], secret: SECRET, active: true,
          }],
        })),
      ).toThrow(/WEBHOOK_NOT_HTTPS/);
    });

    it("blocks an event the system will never emit", () => {
      expect(() =>
        assertDefinitionPublishable(base({
          webhookSubscriptions: [{
            id: "ghost", url: "https://police.gov.in/hook",
            events: ["application.deleted"], secret: SECRET, active: true,
          }],
        })),
      ).toThrow(/WEBHOOK_UNKNOWN_EVENT/);
    });
  });

  describe("FN-27 / FN-28 linkage", () => {
    it("blocks an appealable service with no appellate authority", () => {
      // An appeal right with nobody to hear it is a dead end for the citizen.
      expect(() =>
        assertDefinitionPublishable(base({ appealLinkage: { appealable: true } })),
      ).toThrow(/APPEAL_MISSING_APPELLATE_DESIGNATION/);
    });

    it("allows appeals to be explicitly switched off", () => {
      expect(() =>
        assertDefinitionPublishable(base({ appealLinkage: { appealable: false } })),
      ).not.toThrow();
    });

    it("blocks RTI publication with no PIO to receive requests", () => {
      expect(() =>
        assertDefinitionPublishable(base({ rtiLinkage: { published: true } })),
      ).toThrow(/RTI_MISSING_PIO_DESIGNATION/);
    });

    it("allows a service that is simply not published to RTI", () => {
      expect(() =>
        assertDefinitionPublishable(base({ rtiLinkage: { published: false } })),
      ).not.toThrow();
    });
  });

  it("still enforces the pre-existing rules", () => {
    // Guard against the Phase 3 additions displacing what was already checked.
    expect(() => assertDefinitionPublishable(base({ hoaCode: null }))).toThrow(/DEF_MISSING_HOA/);
    expect(() => assertDefinitionPublishable(base({ channels: [] }))).toThrow(/DEF_NO_CHANNELS/);
    expect(() => assertDefinitionPublishable(base({ name: "  " }))).toThrow(/DEF_MISSING_NAME/);
  });
});
