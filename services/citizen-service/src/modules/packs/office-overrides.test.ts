/**
 * FN-22 — Cross-Office Fee & Form Variants.
 *
 * BRD acceptance: "Zone A fee differs from Zone B; same pack version."
 * The negative cases matter as much as that one: an override that could change
 * the form, the workflow or the head of account would be a pack fork wearing a
 * config costume, which is precisely what this FN exists to prevent.
 */
import { describe, it, expect } from "vitest";
import {
  assertOfficeOverrides,
  officesWithOverrides,
  resolveBlocksForOffice,
  OfficeOverrideError,
  type OfficeOverride,
} from "./office-overrides.js";
import { hallBookingManifestBlocks } from "./manifests/hall-booking.js";

const ZONE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ZONE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ZONE_C = "cccccccc-0000-4000-8000-00000000000c";

function blocks() {
  return hallBookingManifestBlocks();
}

describe("FN-22 resolveBlocksForOffice", () => {
  it("BRD acceptance: Zone A fee differs from Zone B on the same pack version", () => {
    const base = blocks();
    const overrides: OfficeOverride[] = [
      { officeId: ZONE_A, feeFromMinor: 500_00 },
      { officeId: ZONE_B, feeFromMinor: 900_00 },
    ];

    const a = resolveBlocksForOffice(base, overrides, ZONE_A);
    const b = resolveBlocksForOffice(base, overrides, ZONE_B);

    expect(a.feeFromMinor).toBe(500_00);
    expect(b.feeFromMinor).toBe(900_00);
    // Same pack version — everything that identifies the service is untouched.
    expect(a.formId).toBe(base.formId);
    expect(b.formId).toBe(base.formId);
    expect(a.workflowDefinitionId).toBe(base.workflowDefinitionId);
    expect(b.workflowDefinitionId).toBe(base.workflowDefinitionId);
    expect(a.hoaCode).toBe(base.hoaCode);
    expect(b.hoaCode).toBe(base.hoaCode);
  });

  it("returns the pack unchanged for an office with no override", () => {
    const base = blocks();
    const resolved = resolveBlocksForOffice(base, [{ officeId: ZONE_A, feeFromMinor: 1 }], ZONE_C);
    // Same reference: "runs the pack as published" is detectable without a diff.
    expect(resolved).toBe(base);
  });

  it("returns the pack unchanged when there are no overrides or no office", () => {
    const base = blocks();
    expect(resolveBlocksForOffice(base, [], ZONE_A)).toBe(base);
    expect(resolveBlocksForOffice(base, null, ZONE_A)).toBe(base);
    expect(resolveBlocksForOffice(base, [{ officeId: ZONE_A, feeFromMinor: 1 }], null)).toBe(base);
  });

  it("never mutates the pack blocks it was given", () => {
    const base = blocks();
    const beforeFee = base.feeFromMinor;
    const beforeDocs = (base.requiredDocuments ?? []).length;

    resolveBlocksForOffice(base, [
      { officeId: ZONE_A, feeFromMinor: 1, additionalDocuments: [{ docType: "noc", label: "NOC", mandatory: true }] },
    ], ZONE_A);

    expect(base.feeFromMinor).toBe(beforeFee);
    expect((base.requiredDocuments ?? []).length).toBe(beforeDocs);
  });

  it("appends local documents without disturbing the pack's own", () => {
    const base = blocks();
    const packDocs = base.requiredDocuments ?? [];
    const resolved = resolveBlocksForOffice(base, [
      {
        officeId: ZONE_A,
        additionalDocuments: [{ docType: "fire_noc", label: "Fire NOC", mandatory: true, verifiedAtLane: "availability" }],
      },
    ], ZONE_A);

    expect(resolved.requiredDocuments).toHaveLength(packDocs.length + 1);
    // Pack documents keep their order and flags.
    expect(resolved.requiredDocuments?.slice(0, packDocs.length)).toEqual(packDocs);
    expect(resolved.requiredDocuments?.at(-1)?.docType).toBe("fire_noc");
  });

  it("applies a local SLA promise", () => {
    const base = blocks();
    const resolved = resolveBlocksForOffice(base, [{ officeId: ZONE_A, slaDays: 1 }], ZONE_A);
    expect(resolved.slaDays).toBe(1);
    expect(base.slaDays).not.toBe(1);
  });

  it("lists which offices diverge from the published pack", () => {
    expect(officesWithOverrides([{ officeId: ZONE_A }, { officeId: ZONE_B }])).toEqual([ZONE_A, ZONE_B]);
    expect(officesWithOverrides(null)).toEqual([]);
  });
});

describe("FN-22 assertOfficeOverrides — publish gate", () => {
  const packDocuments = [{ docType: "id_proof", label: "Identity proof", mandatory: true }];

  it("accepts an absent or empty override list", () => {
    expect(() => assertOfficeOverrides(null)).not.toThrow();
    expect(() => assertOfficeOverrides([])).not.toThrow();
  });

  it("rejects a non-list", () => {
    expect(() => assertOfficeOverrides({} as unknown)).toThrow(OfficeOverrideError);
  });

  it("rejects an override with no office", () => {
    expect(() => assertOfficeOverrides([{ feeFromMinor: 1 }])).toThrow(/OVERRIDE_MISSING_OFFICE/);
  });

  it("rejects two overrides for the same office", () => {
    expect(() =>
      assertOfficeOverrides([{ officeId: ZONE_A }, { officeId: ZONE_A }]),
    ).toThrow(/OVERRIDE_DUPLICATE_OFFICE/);
  });

  it("rejects an override for an office that is not offering the service", () => {
    // Dead config that would silently never apply at runtime.
    expect(() =>
      assertOfficeOverrides([{ officeId: ZONE_C }], { offeringOfficeIds: [ZONE_A, ZONE_B] }),
    ).toThrow(/OVERRIDE_OFFICE_NOT_OFFERING/);
  });

  it("allows any office when the pack offers to all offices under the owner", () => {
    // Empty offering list is B1's "all under owner" default, so membership is unknowable.
    expect(() => assertOfficeOverrides([{ officeId: ZONE_C }], { offeringOfficeIds: [] })).not.toThrow();
    expect(() => assertOfficeOverrides([{ officeId: ZONE_C }], {})).not.toThrow();
  });

  it("rejects a negative or fractional fee", () => {
    expect(() => assertOfficeOverrides([{ officeId: ZONE_A, feeFromMinor: -1 }])).toThrow(/OVERRIDE_BAD_FEE/);
    expect(() => assertOfficeOverrides([{ officeId: ZONE_A, feeFromMinor: 10.5 }])).toThrow(/OVERRIDE_BAD_FEE/);
  });

  it("accepts a zero fee — a free zone is legitimate", () => {
    expect(() => assertOfficeOverrides([{ officeId: ZONE_A, feeFromMinor: 0 }])).not.toThrow();
  });

  it("rejects a non-positive SLA", () => {
    expect(() => assertOfficeOverrides([{ officeId: ZONE_A, slaDays: 0 }])).toThrow(/OVERRIDE_BAD_SLA/);
  });

  it("rejects a local document that shadows a pack document", () => {
    // Otherwise an office could re-declare a mandatory pack document as optional.
    expect(() =>
      assertOfficeOverrides(
        [{ officeId: ZONE_A, additionalDocuments: [{ docType: "id_proof", label: "ID", mandatory: false }] }],
        { packDocuments },
      ),
    ).toThrow(/OVERRIDE_DOCUMENT_SHADOWS_PACK/);
  });

  it("rejects the same local document twice", () => {
    expect(() =>
      assertOfficeOverrides([
        {
          officeId: ZONE_A,
          additionalDocuments: [
            { docType: "noc", label: "NOC", mandatory: true },
            { docType: "noc", label: "NOC again", mandatory: false },
          ],
        },
      ]),
    ).toThrow(/OVERRIDE_DUPLICATE_DOCUMENT/);
  });

  it("accepts a well-formed override set", () => {
    expect(() =>
      assertOfficeOverrides(
        [
          { officeId: ZONE_A, feeFromMinor: 500_00, note: "Higher demand in the central zone" },
          {
            officeId: ZONE_B,
            slaDays: 2,
            additionalDocuments: [{ docType: "fire_noc", label: "Fire NOC", mandatory: true }],
          },
        ],
        { offeringOfficeIds: [ZONE_A, ZONE_B], packDocuments },
      ),
    ).not.toThrow();
  });
});
