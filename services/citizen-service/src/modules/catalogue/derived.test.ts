/**
 * Phase 3 wiring — derived views over a stored service definition.
 *
 * These cover the adapter layer specifically: that a DB row is mapped onto the
 * pure modules correctly, and that missing/unset blocks produce an honest answer
 * rather than a plausible-looking default.
 */
import { describe, it, expect } from "vitest";
import {
  a11yPreviewFor,
  analyticsFor,
  localizationFor,
  rtiEntryFor,
  rtiExport,
} from "./derived.js";
import { hallBookingFormDesign, hallBookingManifestBlocks } from "../packs/manifests/hall-booking.js";

/** A definition row as the DB would hand it back, narrowed to what's read. */
function def(over: Record<string, unknown> = {}) {
  const form = hallBookingFormDesign();
  const blocks = hallBookingManifestBlocks();
  return {
    id: "dddddddd-0001-4000-8000-000000000001",
    serviceKey: "pack:hall-booking",
    name: "Hall Booking",
    status: "published",
    servicePattern: "booking",
    slaDays: blocks.slaDays,
    feeModel: blocks.feeModel,
    issuanceType: blocks.issuanceType,
    channels: blocks.channels,
    requiredDocuments: blocks.requiredDocuments,
    outputs: blocks.outputs,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields } }],
    locales: ["en", "or"],
    rtiLinkage: null,
    ...over,
  };
}

describe("FN-32 a11yPreviewFor", () => {
  it("passes a real published pack's form", () => {
    const r = a11yPreviewFor(def());
    expect(r.formAuthored).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("fails and names the field when a label is missing", () => {
    const d = def();
    const fields = (d.forms[0]!.formDesign as { fields: Record<string, { label?: string }> }).fields;
    const firstKey = Object.keys(fields)[0]!;
    fields[firstKey]!.label = "";

    const r = a11yPreviewFor(d);
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.code === "FIELD_MISSING_LABEL")).toBe(true);
  });

  it("reports 'no form authored' distinctly from an empty form", () => {
    // A designer who has not built a form yet has a different problem from one
    // whose form has no fields; collapsing them would misdirect the fix.
    for (const forms of [[], undefined, [{}]]) {
      const r = a11yPreviewFor(def({ forms }));
      expect(r.formAuthored).toBe(false);
      expect(r.issues).toEqual([]);
      expect(r).toHaveProperty("reason");
    }
  });

  it("raises the GIGW warning when the definition declares one locale", () => {
    const r = a11yPreviewFor(def({ locales: ["en"] }));
    expect(r.issues.some((i) => i.code === "GIGW_SECONDARY_LOCALE_MISSING")).toBe(true);
    // A rollout obligation must not block an otherwise-correct form.
    expect(r.passed).toBe(true);
  });
});

describe("FN-16 + FN-31 analyticsFor", () => {
  it("attaches the pattern's reports and KPI tiles", () => {
    const r = analyticsFor(def());
    expect(r.pattern).toBe("booking");
    expect(r.reports.map((x) => x.key)).toContain("booking_register");
    expect(r.tiles.map((x) => x.key)).toContain("volume");
  });

  it("refuses to guess when the service pattern is unset", () => {
    // Defaulting to 'certificate' would hand a department head a plausible but
    // wrong report set, which is harder to spot than an explicit gap.
    for (const servicePattern of [null, undefined, "nonsense"]) {
      const r = analyticsFor(def({ servicePattern }));
      expect(r.pattern).toBeNull();
      expect(r.reports).toEqual([]);
      expect(r.tiles).toEqual([]);
      expect(r).toHaveProperty("reason");
    }
  });

  it("treats a definition with a fee model as charging", () => {
    // The row has no feeFromMinor column; feeModel is the signal that survives.
    expect(analyticsFor(def()).tiles.map((t) => t.key)).toContain("fee_collection_rate");
  });

  it("omits fee and SLA views when the definition has neither", () => {
    const r = analyticsFor(def({ feeModel: null, slaDays: null }));
    expect(r.tiles.map((t) => t.key)).not.toContain("fee_collection_rate");
    expect(r.tiles.map((t) => t.key)).not.toContain("sla_compliance");
    expect(r.reports.map((x) => x.key)).not.toContain("revenue_vs_demand");
  });
});

describe("FN-28 rtiEntryFor / rtiExport", () => {
  const published = { published: true, pioDesignationId: "dsg-pio", pioDesignationLabel: "PIO" };

  it("returns null when the service is not opted in to RTI", () => {
    expect(rtiEntryFor(def())).toBeNull();
    expect(rtiEntryFor(def({ rtiLinkage: { published: false } }))).toBeNull();
  });

  it("builds an entry from service metadata when opted in", () => {
    const e = rtiEntryFor(def({ rtiLinkage: published }))!;
    expect(e.serviceKey).toBe("pack:hall-booking");
    expect(e.pattern).toBe("booking");
    expect(e.pioDesignationLabel).toBe("PIO");
    expect(e.requiredDocumentTypes.length).toBeGreaterThan(0);
  });

  it("never leaks a form field into the entry", () => {
    const e = rtiEntryFor(def({ rtiLinkage: published }))!;
    const serialised = JSON.stringify(e);
    expect(serialised).not.toContain("applicantName");
    expect(serialised).not.toContain("applicantMobile");
  });

  it("exports only published services", () => {
    // A draft is not something the public can request information about yet.
    const rows = [
      def({ rtiLinkage: published, status: "published" }),
      def({ rtiLinkage: published, status: "draft", serviceKey: "pack:draft" }),
      def({ rtiLinkage: null, status: "published", serviceKey: "pack:not-opted-in" }),
    ];
    expect(rtiExport(rows).map((e) => e.serviceKey)).toEqual(["pack:hall-booking"]);
  });

  it("returns an empty export rather than throwing on an empty catalogue", () => {
    expect(rtiExport([])).toEqual([]);
  });
});

describe("FN-18 localizationFor", () => {
  it("lists the translatable strings of the definition's form", () => {
    const r = localizationFor(def());
    expect(r.total).toBeGreaterThan(0);
    expect(r.strings.some((s) => s.key.startsWith("form.field."))).toBe(true);
    expect(r.locales).toEqual(["en", "or"]);
  });

  it("omits coverage when no locale is requested", () => {
    const r = localizationFor(def());
    expect(r.coverage).toBeUndefined();
    expect(r.missing).toBeUndefined();
  });

  it("reports every string outstanding for a requested locale", () => {
    // No translation store exists yet (OQ-1). Saying "0% translated" is true;
    // implying a store exists would not be.
    const r = localizationFor(def(), "or");
    expect(r.coverage?.locale).toBe("or");
    expect(r.coverage?.percent).toBe(0);
    expect(r.missing).toHaveLength(r.total);
  });

  it("still finds document labels when the definition has no form", () => {
    // Required-document labels are citizen-facing whether or not a form exists,
    // so they stay in the inventory; only the form-derived keys disappear.
    const r = localizationFor(def({ forms: [] }));
    expect(r.strings.some((s) => s.key.startsWith("form."))).toBe(false);
    expect(r.strings.every((s) => s.key.startsWith("document."))).toBe(true);
    expect(r.total).toBeGreaterThan(0);
  });

  it("returns an empty inventory when there is neither form nor document", () => {
    const r = localizationFor(def({ forms: [], requiredDocuments: [] }));
    expect(r.total).toBe(0);
    expect(r.strings).toEqual([]);
  });
});
