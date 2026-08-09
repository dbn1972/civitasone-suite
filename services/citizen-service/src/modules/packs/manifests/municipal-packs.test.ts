/**
 * municipal-in-v1 — the six reference services of BRD §8.1.
 *
 * These tests exist to make two DoD items provable rather than asserted:
 *   (b) a structurally different service (PGR or Water) is built the same way
 *   (f) municipal-in-v1 activates producing >= 3 editable drafts (TL, PGR, Water)
 *
 * "Editable draft" is read strictly: a draft with no form and no workflow is a
 * row, not a service, so the activation test checks the wiring, not the count.
 */
import { describe, it, expect } from "vitest";
import { blocksFromManifest } from "../manifest-apply.js";
import { MUNICIPAL_ONBOARDING_PACK_KEYS } from "../domain.js";
import { assertDefinitionPublishable } from "../../catalogue/domain.js";
import { previewAccessibility } from "../a11y-preview.js";
import { ENGINE_KEYS } from "../../engine-bindings/domain.js";
import { tradeLicenseManifestBlocks } from "./trade-license.js";
import { pgrManifestBlocks, pgrFormDesign, pgrPackManifest } from "./pgr.js";
import { waterConnectionManifestBlocks, waterConnectionFormDesign } from "./water-connection.js";
import { fireNocManifestBlocks, fireNocFormDesign } from "./fire-noc.js";
import { propertyTaxManifestBlocks, propertyTaxFormDesign } from "./property-tax.js";
import { birthDeathManifestBlocks, birthDeathFormDesign } from "./birth-death.js";

const MUNICIPAL = [
  ["pack:trade-license", tradeLicenseManifestBlocks()],
  ["pack:pgr", pgrManifestBlocks()],
  ["pack:water-connection", waterConnectionManifestBlocks()],
  ["pack:fire-noc", fireNocManifestBlocks()],
  ["pack:property-tax", propertyTaxManifestBlocks()],
  ["pack:birth-death", birthDeathManifestBlocks()],
] as const;

const FORMS = [
  ["pgr", pgrFormDesign()],
  ["water-connection", waterConnectionFormDesign()],
  ["fire-noc", fireNocFormDesign()],
  ["property-tax", propertyTaxFormDesign()],
  ["birth-death", birthDeathFormDesign()],
] as const;

describe("DoD (f) — municipal-in-v1 activation produces working drafts", () => {
  it("every pack the onboarding activates resolves to real block wiring", () => {
    // This is the defect this file was written to close: PGR and Water were
    // listed for activation but had no manifest, so they imported as empty rows.
    for (const key of MUNICIPAL_ONBOARDING_PACK_KEYS) {
      const blocks = blocksFromManifest(key, null);
      expect(blocks, key).not.toBeNull();
      expect(blocks!.formId, key).toBeTruthy();
      expect((blocks!.forms ?? []).length, key).toBeGreaterThan(0);
      expect(blocks!.description, key).toBeTruthy();
    }
  });

  it("activates at least the three DoD pilot services", () => {
    expect(MUNICIPAL_ONBOARDING_PACK_KEYS.length).toBeGreaterThanOrEqual(3);
    expect(MUNICIPAL_ONBOARDING_PACK_KEYS).toContain("pack:trade-license");
    expect(MUNICIPAL_ONBOARDING_PACK_KEYS).toContain("pack:pgr");
    expect(MUNICIPAL_ONBOARDING_PACK_KEYS).toContain("pack:water-connection");
  });

  it("resolves all six BRD §8.1 reference services", () => {
    for (const [key] of MUNICIPAL) {
      expect(blocksFromManifest(key, null), key).not.toBeNull();
    }
  });

  it("still returns null for a key with no manifest", () => {
    expect(blocksFromManifest("pack:not-a-service", null)).toBeNull();
  });
});

describe("municipal packs — shared invariants", () => {
  it.each(MUNICIPAL)("%s has an output with a numbering format", (key, blocks) => {
    const outputs = blocks.outputs ?? [];
    expect(outputs.length, key).toBeGreaterThan(0);
    for (const o of outputs) {
      expect(o.templateKey, key).toBeTruthy();
      expect(o.numberingFormat, key).toMatch(/\{year\}/);
      expect(o.numberingFormat, key).toMatch(/\{seq:\d\}/);
    }
  });

  it.each(MUNICIPAL)("%s offers at least one intake channel", (key, blocks) => {
    expect((blocks.channels ?? []).length, key).toBeGreaterThan(0);
  });

  it.each(MUNICIPAL)("%s declares an SLA", (key, blocks) => {
    expect(blocks.slaDays, key).toBeGreaterThan(0);
  });

  it.each(FORMS)("%s form passes the FN-32 accessibility preview", (name, form) => {
    // A pack we ship that fails our own a11y gate would be indefensible.
    const r = previewAccessibility({ sections: form.sections, fields: form.fields } as never, {
      locales: ["en", "or"],
    });
    expect(r.issues.filter((i) => i.severity === "error"), name).toEqual([]);
    expect(r.passed, name).toBe(true);
  });

  it.each(MUNICIPAL)("%s documents are verified at a lane that exists", (key, blocks) => {
    const laneKeys = new Set(lanesOf(blocks).map((l) => l.key));
    for (const doc of blocks.requiredDocuments ?? []) {
      if (!doc.verifiedAtLane) continue;
      expect(laneKeys, `${key}/${doc.docType}`).toContain(doc.verifiedAtLane);
    }
  });

  it.each(MUNICIPAL)("%s lanes escalate to someone other than the lane owner", (key, blocks) => {
    for (const lane of lanesOf(blocks)) {
      if (!lane.escalationDesignationId) continue;
      // Escalating to yourself is not an escalation.
      expect(lane.escalationDesignationId, `${key}/${lane.key}`).not.toBe(lane.designationId);
    }
  });
});

describe("FN-14 — fee-bearing packs declare a head of account", () => {
  it.each(MUNICIPAL)("%s satisfies the publish gate", (key, blocks) => {
    expect(() =>
      assertDefinitionPublishable({
        name: key,
        channels: (blocks.channels ?? []) as never,
        requiredDocuments: (blocks.requiredDocuments ?? []) as never,
        servicePattern: patternFor(key),
        // PGR omits both keys entirely (B5 hidden), so the union of manifest
        // literals has no such member — read them tolerantly.
        feeModel: (blocks as { feeModel?: "flat" | "slab" }).feeModel ?? null,
        hoaCode: (blocks as { hoaCode?: string }).hoaCode ?? null,
        appealLinkage: (blocks as { appealLinkage?: unknown }).appealLinkage,
      }),
    ).not.toThrow();
  });
});

describe("BRD §8.1.3 — PGR is a grievance, and charges nothing", () => {
  const pgr = pgrManifestBlocks();

  it("carries no fee wiring at all", () => {
    // B5 is hidden for the grievance pattern; a grievance that charged the
    // citizen to complain would be the wrong service.
    expect(pgr).not.toHaveProperty("feeModel");
    expect(pgr).not.toHaveProperty("feeScheduleId");
    expect(pgr).not.toHaveProperty("hoaCode");
    expect(pgr).not.toHaveProperty("feeFromMinor");
  });

  it("issues a closure note, not a certificate", () => {
    expect(pgr.issuanceType).toBe("closure_note");
    expect(pgr.outputs?.[0]?.type).toBe("closure_note");
  });

  it("requires no documents to report a problem", () => {
    // Demanding proof would suppress the reports the service exists to collect.
    expect(pgr.requiredDocuments).toEqual([]);
  });

  it("declares that it wraps the existing grievance module", () => {
    expect(pgrPackManifest().wrapsExistingModule).toBe("citizen-service/grievance");
  });

  it("publishes without an HOA because it is not fee-bearing", () => {
    expect(() =>
      assertDefinitionPublishable({
        name: "PGR",
        channels: pgr.channels as never,
        requiredDocuments: [],
        servicePattern: "grievance",
        hoaCode: null,
      }),
    ).not.toThrow();
  });
});

describe("BRD §8.1.2 — Water Connection is structurally different (DoD (b))", () => {
  const ws = waterConnectionManifestBlocks();
  const tl = tradeLicenseManifestBlocks();

  it("has the BRD's longer chain, including execution after approval", () => {
    const keys = lanesOf(ws).map((l) => l.key);
    expect(keys).toEqual(["document_verification", "field_inspection", "decision", "execution"]);
    // The point of DoD (b): more lanes than the canonical certificate pilot.
    expect(keys.length).toBeGreaterThan(lanesOf(tl).length);
  });

  it("charges a slab fee, not the flat fee Trade License uses", () => {
    expect(ws.feeModel).toBe("slab");
    expect(tl.feeModel).toBe("flat");
  });

  it("lane SLAs sum to no more than the service SLA", () => {
    const sum = lanesOf(ws).reduce((a, l) => a + (l.slaDays ?? 0), 0);
    expect(sum).toBeLessThanOrEqual(ws.slaDays!);
  });
});

describe("BRD §8.1.4 — Fire NOC renewal is mandatory", () => {
  const fn = fireNocManifestBlocks();

  it("wires FN-15 rather than leaving renewal as prose", () => {
    expect(fn.renewalPolicy?.renewable).toBe(true);
    expect(fn.renewalPolicy?.validityMode).toBe("duration");
    expect(fn.renewalPolicy?.validityYears).toBe(1);
  });

  it("opens the renewal window early enough to re-inspect", () => {
    expect(fn.renewalPolicy?.renewalWindowDays).toBeGreaterThanOrEqual(60);
  });
});

describe("BRD §8.1.5 — Property Tax is parameter-only, not Studio-pure", () => {
  const pt = propertyTaxManifestBlocks();

  it("binds the assessment engine instead of declaring a fee schedule", () => {
    // A flat/slab fee here would look configurable and compute the wrong tax.
    expect(pt).not.toHaveProperty("feeModel");
    expect(pt).not.toHaveProperty("feeScheduleId");
    const binding = pt.engineBindings?.[0];
    expect(binding?.engineKey).toBe("revenue.assessment");
    expect(binding?.block).toBe("assessment");
    expect(binding?.requiredForPublish).toBe(true);
  });

  it("exposes exactly the parameters the BRD allows Studio to edit", () => {
    const cfg = pt.engineBindings![0]!.config;
    expect(cfg.exemptionCategories.length).toBeGreaterThan(0);
    expect(cfg.penaltyPercentBps).toBeGreaterThan(0);
    expect(cfg.rebatePercentBps).toBeGreaterThan(0);
    expect(cfg.hoaCode).toBeTruthy();
  });

  it("wires no approval lanes — assessment is a machine step", () => {
    // B4 is hidden for the collection pattern; inventing an approver would add
    // a queue nobody works.
    expect(lanesOf(pt)).toEqual([]);
    expect(pt.requiredDocuments).toEqual([]);
  });

  it("binds an engine that is actually available", () => {
    expect(ENGINE_KEYS).toContain("revenue.assessment");
  });
});

describe("BRD §8.1.6 — Birth & Death is honest about its unavailable engine", () => {
  const bd = birthDeathManifestBlocks();

  it("binds the CRS engine and requires it for publish", () => {
    const binding = bd.engineBindings?.[0];
    expect(binding?.engineKey).toBe("crs.birth-death");
    // A statutory register that does not reach CRS is worse than a service that
    // refuses to publish, so this stays required even though it blocks today.
    expect(binding?.requiredForPublish).toBe(true);
  });

  it("registration is free inside the statutory window", () => {
    expect(bd.feeFromMinor).toBe(0);
    expect(bd.engineBindings?.[0]?.config.penaltyGraceDays).toBe(21);
  });

  it("does not require a hospital certificate for a home birth", () => {
    const inst = bd.requiredDocuments?.find((d) => d.docType === "institution_certificate");
    expect(inst?.mandatory).toBe(false);
  });
});

interface Lane {
  key: string;
  designationId?: string;
  escalationDesignationId?: string;
  slaDays?: number;
}

/**
 * Lanes of a pack, tolerant of packs that declare none.
 * Property Tax omits the key entirely (B4 is hidden for the collection
 * pattern), so the union of manifest literals has no laneBindings member.
 */
function lanesOf(blocks: unknown): Lane[] {
  const lanes = (blocks as { laneBindings?: Lane[] }).laneBindings;
  return Array.isArray(lanes) ? lanes : [];
}

/** Pattern per pack, mirroring what B1 would carry. */
function patternFor(key: string): "certificate" | "booking" | "collection" | "grievance" {
  if (key === "pack:pgr") return "grievance";
  if (key === "pack:property-tax") return "collection";
  return "certificate";
}
