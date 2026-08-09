/**
 * The wider citizen-facing catalogue — the services a ULB issues in volume
 * beyond the six municipal reference services.
 *
 * The shared-invariant block below is the point of this file: every pack in the
 * whole catalogue is held to the same standard, so a new pack cannot ship with a
 * document pinned to a lane that does not exist, a lane that escalates to
 * itself, or a form that fails the accessibility gate. Those are exactly the
 * defects that are invisible in review and obvious in production.
 */
import { describe, it, expect } from "vitest";
import { blocksFromManifest } from "../manifest-apply.js";
import { assertDefinitionPublishable } from "../../catalogue/domain.js";
import { previewAccessibility } from "../a11y-preview.js";
import { renewalEligibility } from "../renewal.js";
import { shopsEstablishmentsManifestBlocks, shopsEstablishmentsFormDesign } from "./shops-establishments.js";
import { streetVendorManifestBlocks, streetVendorFormDesign } from "./street-vendor.js";
import { advertisementManifestBlocks, advertisementFormDesign } from "./advertisement-hoarding.js";
import { roadCuttingManifestBlocks, roadCuttingFormDesign } from "./road-cutting.js";
import { crematoriumManifestBlocks, crematoriumFormDesign } from "./crematorium-booking.js";
import { parkingPassManifestBlocks, parkingPassFormDesign } from "./parking-pass.js";
import { marketStallManifestBlocks, marketStallFormDesign } from "./market-stall.js";
import { municipalPropertyRentManifestBlocks, municipalPropertyRentFormDesign } from "./municipal-property-rent.js";
import { generalNocManifestBlocks, generalNocFormDesign } from "./general-noc.js";
import { pgrFormDesign } from "./pgr.js";

type Pattern = "certificate" | "booking" | "collection" | "grievance";

const CATALOGUE: readonly [string, Record<string, unknown>, Pattern][] = [
  ["pack:shops-establishments", shopsEstablishmentsManifestBlocks(), "certificate"],
  ["pack:street-vendor", streetVendorManifestBlocks(), "certificate"],
  ["pack:advertisement-hoarding", advertisementManifestBlocks(), "certificate"],
  ["pack:road-cutting", roadCuttingManifestBlocks(), "certificate"],
  ["pack:crematorium-booking", crematoriumManifestBlocks(), "booking"],
  ["pack:parking-pass", parkingPassManifestBlocks(), "booking"],
  ["pack:market-stall", marketStallManifestBlocks(), "certificate"],
  ["pack:municipal-property-rent", municipalPropertyRentManifestBlocks(), "collection"],
  ["pack:general-noc", generalNocManifestBlocks(), "certificate"],
];

const FORMS: readonly [string, ReturnType<typeof generalNocFormDesign>][] = [
  ["shops-establishments", shopsEstablishmentsFormDesign()],
  ["street-vendor", streetVendorFormDesign()],
  ["advertisement-hoarding", advertisementFormDesign()],
  ["road-cutting", roadCuttingFormDesign()],
  ["crematorium-booking", crematoriumFormDesign()],
  ["parking-pass", parkingPassFormDesign()],
  ["market-stall", marketStallFormDesign()],
  ["municipal-property-rent", municipalPropertyRentFormDesign()],
  ["general-noc", generalNocFormDesign()],
];

interface Lane { key: string; designationId?: string; escalationDesignationId?: string; slaDays?: number }
const lanesOf = (b: unknown): Lane[] => {
  const l = (b as { laneBindings?: Lane[] }).laneBindings;
  return Array.isArray(l) ? l : [];
};
const get = <T,>(b: unknown, k: string): T | undefined => (b as Record<string, T>)[k];

describe("catalogue packs — every one resolves", () => {
  it.each(CATALOGUE)("%s is registered in the dispatcher", (key) => {
    // A manifest nobody can import is dead code.
    expect(blocksFromManifest(key, null), key).not.toBeNull();
  });

  it("registers nine distinct packs", () => {
    expect(new Set(CATALOGUE.map(([k]) => k)).size).toBe(9);
  });
});

describe("catalogue packs — shared invariants", () => {
  it.each(CATALOGUE)("%s numbering carries year and sequence", (key, blocks) => {
    const outputs = get<{ type: string; templateKey: string; numberingFormat: string }[]>(blocks, "outputs") ?? [];
    expect(outputs.length, key).toBeGreaterThan(0);
    for (const o of outputs) {
      expect(o.templateKey, key).toBeTruthy();
      expect(o.numberingFormat, key).toMatch(/\{year\}/);
      expect(o.numberingFormat, key).toMatch(/\{seq:\d\}/);
    }
  });

  it.each(CATALOGUE)("%s declares channels and an SLA", (key, blocks) => {
    expect((get<string[]>(blocks, "channels") ?? []).length, key).toBeGreaterThan(0);
    expect(get<number>(blocks, "slaDays"), key).toBeGreaterThan(0);
  });

  it.each(CATALOGUE)("%s documents are verified at a lane that exists", (key, blocks) => {
    const laneKeys = new Set(lanesOf(blocks).map((l) => l.key));
    const docs = get<{ docType: string; verifiedAtLane?: string }[]>(blocks, "requiredDocuments") ?? [];
    for (const d of docs) {
      if (!d.verifiedAtLane) continue;
      expect(laneKeys, `${key}/${d.docType}`).toContain(d.verifiedAtLane);
    }
  });

  it.each(CATALOGUE)("%s has no lane escalating to itself", (key, blocks) => {
    for (const lane of lanesOf(blocks)) {
      if (!lane.escalationDesignationId) continue;
      expect(lane.escalationDesignationId, `${key}/${lane.key}`).not.toBe(lane.designationId);
    }
  });

  it.each(CATALOGUE)("%s lane SLAs fit inside the service SLA", (key, blocks) => {
    // A promise the lanes cannot keep is worse than a longer honest promise.
    const lanes = lanesOf(blocks);
    if (lanes.length === 0) return;
    const sum = lanes.reduce((a, l) => a + (l.slaDays ?? 0), 0);
    expect(sum, key).toBeLessThanOrEqual(get<number>(blocks, "slaDays")!);
  });

  it.each(CATALOGUE)("%s fees are whole paise and never negative", (key, blocks) => {
    const fee = get<number>(blocks, "feeFromMinor");
    if (fee === undefined) return;
    expect(Number.isInteger(fee), key).toBe(true);
    expect(fee, key).toBeGreaterThanOrEqual(0);
  });

  it.each(CATALOGUE)("%s satisfies the publish gate", (key, blocks, pattern) => {
    expect(() =>
      assertDefinitionPublishable({
        name: key,
        channels: (get<string[]>(blocks, "channels") ?? []) as never,
        requiredDocuments: (get<unknown[]>(blocks, "requiredDocuments") ?? []) as never,
        servicePattern: pattern,
        feeModel: get<"flat" | "slab">(blocks, "feeModel") ?? null,
        hoaCode: get<string>(blocks, "hoaCode") ?? null,
        appealLinkage: get<unknown>(blocks, "appealLinkage"),
      }),
    ).not.toThrow();
  });

  it.each(FORMS)("%s form passes the FN-32 accessibility preview", (name, form) => {
    const r = previewAccessibility({ sections: form.sections, fields: form.fields } as never, {
      locales: ["en", "or"],
    });
    expect(r.issues.filter((i) => i.severity === "error"), name).toEqual([]);
    expect(r.passed, name).toBe(true);
  });
});

describe("collection pattern — municipal property rent", () => {
  const mp = municipalPropertyRentManifestBlocks();

  it("wires no approval chain or documents", () => {
    // B4 and B6 are hidden for collection; an approver on a rent payment would
    // delay money the municipality has already earned.
    expect(lanesOf(mp)).toEqual([]);
    expect(mp.requiredDocuments).toEqual([]);
    expect(mp).not.toHaveProperty("workflowDefinitionId");
  });

  it("issues a receipt, not a certificate", () => {
    expect(mp.issuanceType).toBe("receipt");
    expect(mp.outputs[0]?.type).toBe("receipt");
  });

  it("still declares an HOA, because money must land somewhere", () => {
    expect(mp.hoaCode).toBeTruthy();
  });
});

describe("street vendor — the Act's constraints are honoured", () => {
  const sv = streetVendorManifestBlocks();

  it("costs nothing to apply", () => {
    // The Act entitles an identified vendor to a certificate; a fee to apply is
    // a barrier in front of the people it protects.
    expect(sv.feeFromMinor).toBe(0);
  });

  it("asks for identity and nothing else", () => {
    // Vendors frequently lack address proof; a documentary burden defeats the Act.
    expect(sv.requiredDocuments).toHaveLength(1);
    expect(sv.requiredDocuments[0]?.docType).toBe("id_proof");
  });

  it("cites the Act as the appeal basis", () => {
    expect(sv.appealLinkage?.statutoryReference).toMatch(/Street Vendors/i);
  });

  it("offers assisted and counter channels", () => {
    expect(sv.channels).toContain("assisted");
    expect(sv.channels).toContain("counter");
  });
});

describe("crematorium — designed for a bereaved family", () => {
  const cr = crematoriumManifestBlocks();

  it("requires no documents at all", () => {
    // The death certificate is issued AFTER the cremation; requiring one here
    // would make the service impossible to use.
    expect(cr.requiredDocuments).toEqual([]);
  });

  it("confirms within a day through a single lane", () => {
    expect(cr.slaDays).toBe(1);
    expect(lanesOf(cr)).toHaveLength(1);
  });

  it("is free to book", () => {
    expect(cr.feeFromMinor).toBe(0);
  });

  it("reaches families who will not use a portal", () => {
    expect(cr.channels).toEqual(expect.arrayContaining(["counter", "assisted", "whatsapp"]));
  });
});

describe("road cutting — the road gets put back", () => {
  const rc = roadCuttingManifestBlocks();

  it("closes on restoration, not on the dig", () => {
    const keys = lanesOf(rc).map((l) => l.key);
    expect(keys[keys.length - 1]).toBe("restoration");
  });

  it("is deliberately not renewable", () => {
    // An overrunning dig needs a fresh permission with fresh restoration
    // charges, not an extension of the original.
    expect(rc.renewalPolicy?.renewable).toBe(false);
  });
});

describe("advertisement — structural safety is verified before the decision", () => {
  const ad = advertisementManifestBlocks();

  it("makes the structural certificate mandatory", () => {
    const doc = ad.requiredDocuments.find((d) => d.docType === "structural_certificate");
    expect(doc?.mandatory).toBe(true);
  });

  it("reviews structure before deciding", () => {
    const keys = lanesOf(ad).map((l) => l.key);
    expect(keys.indexOf("structural_review")).toBeLessThan(keys.indexOf("decision"));
  });
});

describe("renewal policies behave at runtime", () => {
  const RENEWABLE = CATALOGUE
    .map(([key, blocks]) => [key, get<{ renewable: boolean; renewalWindowDays: number; validityMode: string; validityYears?: number }>(blocks, "renewalPolicy")] as const)
    .filter(([, p]) => p?.renewable);

  it("every renewable pack opens a window before expiry", () => {
    expect(RENEWABLE.length).toBeGreaterThan(0);
    for (const [key, policy] of RENEWABLE) {
      const issued = new Date("2026-01-15T00:00:00Z");
      // A day inside the window must be renewable; a day well before must not.
      const years = policy!.validityYears ?? 1;
      const expiry = new Date(issued);
      expiry.setUTCFullYear(expiry.getUTCFullYear() + years);
      const insideWindow = new Date(expiry.getTime() - (policy!.renewalWindowDays - 1) * 86_400_000);

      expect(renewalEligibility(policy as never, issued, insideWindow).state, key).toBe("open");
      expect(renewalEligibility(policy as never, issued, issued).state, key).toBe("too_early");
    }
  });
});

describe("PGR complaint categories cover the common civic complaints", () => {
  // The category field is the only one carrying `choices`; the inferred field
  // type is the narrow common shape, so read it through unknown.
  const categories = (pgrFormDesign().fields["pgr-f1"] as unknown as { choices: string[] }).choices;

  it.each([
    ["public toilets", /toilet|sanitation/i],
    ["parks and trees", /park|tree/i],
    ["encroachment", /encroach/i],
    ["unauthorised construction", /unauthoris|illegal construction/i],
  ])("offers a category for %s", (_name, pattern) => {
    // Without its own category a complaint falls into "Other" and loses the
    // category-based auto-assignment that routes it to the right crew.
    expect(categories.some((c) => pattern.test(c))).toBe(true);
  });

  it("keeps Other as the last resort", () => {
    expect(categories[categories.length - 1]).toBe("Other");
  });

  it("has no duplicate categories", () => {
    expect(new Set(categories).size).toBe(categories.length);
  });
});
