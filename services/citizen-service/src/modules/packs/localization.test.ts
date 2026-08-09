/**
 * FN-18 — Localization, storage-agnostic half.
 *
 * BRD acceptance is "English + Hindi labels on same form definition". The
 * rendering half of that is blocked on OQ-1, so these tests cover the half that
 * every candidate architecture shares: which strings need translating, under
 * what keys, and whether a bundle covers them.
 */
import { describe, it, expect } from "vitest";
import {
  extractTranslatableStrings,
  missingStringsFor,
  translationCoverage,
  type LocalizableBlocks,
} from "./localization.js";
import { hallBookingManifestBlocks } from "./manifests/hall-booking.js";

const blocks = () => hallBookingManifestBlocks() as unknown as LocalizableBlocks;
const keysOf = (xs: { key: string }[]) => xs.map((x) => x.key);

describe("FN-18 extractTranslatableStrings", () => {
  it("finds every text-bearing block of a real pack", () => {
    const strings = extractTranslatableStrings(blocks());
    const keys = keysOf(strings);

    expect(keys).toContain("service.description");
    expect(keys.some((k) => k.startsWith("form.section."))).toBe(true);
    expect(keys.some((k) => k.endsWith(".label") && k.startsWith("form.field."))).toBe(true);
    expect(keys.some((k) => k.endsWith(".helpText"))).toBe(true);
    expect(keys.some((k) => k.includes(".choice."))).toBe(true);
    expect(keys.some((k) => k.startsWith("document."))).toBe(true);
    expect(keys.some((k) => k.startsWith("lane."))).toBe(true);
  });

  it("gives every string its source text and a context a translator can use", () => {
    for (const s of extractTranslatableStrings(blocks())) {
      expect(s.source.trim().length, s.key).toBeGreaterThan(0);
      expect(s.context.trim().length, s.key).toBeGreaterThan(0);
      expect(["citizen", "officer"]).toContain(s.audience);
    }
  });

  it("emits unique keys", () => {
    const keys = keysOf(extractTranslatableStrings(blocks()));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys fields by id, so reordering a form does not invalidate translations", () => {
    const b = blocks();
    const before = keysOf(extractTranslatableStrings(b));

    // Reverse the field map insertion order — same fields, different order.
    const design = b.forms![0]!.formDesign;
    design.fields = Object.fromEntries(Object.entries(design.fields!).reverse());

    expect(new Set(keysOf(extractTranslatableStrings(b)))).toEqual(new Set(before));
  });

  it("keys picklist options by their text, not their position", () => {
    const b: LocalizableBlocks = {
      forms: [
        {
          formDesign: {
            sections: [{ id: "s1", label: "S" }],
            fields: { f1: { id: "f1", apiName: "slot", label: "Slot", choices: ["Morning (9am–1pm)", "Full day"] } },
          },
        },
      ],
    };
    const keys = keysOf(extractTranslatableStrings(b));
    expect(keys).toContain("form.field.f1.choice.morning-9am-1pm");
    expect(keys).toContain("form.field.f1.choice.full-day");

    // Inserting an option ahead of them must not renumber the existing keys.
    b.forms![0]!.formDesign.fields!.f1!.choices = ["Evening", "Morning (9am–1pm)", "Full day"];
    const after = keysOf(extractTranslatableStrings(b));
    expect(after).toContain("form.field.f1.choice.morning-9am-1pm");
    expect(after).toContain("form.field.f1.choice.full-day");
  });

  it("skips blank and non-string text rather than sending the translator empties", () => {
    const b: LocalizableBlocks = {
      description: "   ",
      forms: [
        {
          formDesign: {
            sections: [{ id: "s1", label: "Details" }],
            fields: { f1: { id: "f1", apiName: "ward", label: "Ward", choices: [1, null, "Real"] as unknown[] } },
          },
        },
      ],
    };
    const keys = keysOf(extractTranslatableStrings(b));
    expect(keys).not.toContain("service.description");
    expect(keys).not.toContain("form.field.f1.helpText"); // absent, not blank
    expect(keys.filter((k) => k.includes(".choice."))).toEqual(["form.field.f1.choice.real"]);
  });

  it("marks lane names officer-facing but still extracts them", () => {
    // They reach the citizen through status tracking, so they are translatable.
    const lane = extractTranslatableStrings(blocks()).find((s) => s.key.startsWith("lane."));
    expect(lane?.audience).toBe("officer");
    expect(lane?.context).toMatch(/status tracking/i);
  });

  it("handles an empty or absent pack", () => {
    expect(extractTranslatableStrings(null)).toEqual([]);
    expect(extractTranslatableStrings({})).toEqual([]);
  });
});

describe("FN-18 translationCoverage", () => {
  const strings = extractTranslatableStrings(blocks());
  const fullBundle = Object.fromEntries(strings.map((s) => [s.key, `hi:${s.source}`]));

  it("reports a complete bundle as 100%", () => {
    const c = translationCoverage(strings, "hi", fullBundle);
    expect(c.complete).toBe(true);
    expect(c.percent).toBe(100);
    expect(c.missingKeys).toEqual([]);
    expect(c.translated).toBe(c.total);
  });

  it("reports an absent bundle as 0% and lists everything as missing", () => {
    const c = translationCoverage(strings, "hi", null);
    expect(c.percent).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.missingKeys).toHaveLength(strings.length);
  });

  it("counts an untouched copy of the source as missing", () => {
    // A Hindi bundle echoing the English string is a placeholder, and shipping
    // it would make the form look bilingual when it is not.
    const bundle = { ...fullBundle };
    bundle["service.description"] = strings.find((s) => s.key === "service.description")!.source;
    const c = translationCoverage(strings, "hi", bundle);
    expect(c.missingKeys).toEqual(["service.description"]);
    expect(c.complete).toBe(false);
  });

  it("counts a blank or whitespace translation as missing", () => {
    const bundle = { ...fullBundle, "service.description": "   " };
    expect(translationCoverage(strings, "hi", bundle).missingKeys).toEqual(["service.description"]);
  });

  it("flags stale keys left behind when a field is removed", () => {
    const c = translationCoverage(strings, "hi", { ...fullBundle, "form.field.gone.label": "पुराना" });
    expect(c.staleKeys).toEqual(["form.field.gone.label"]);
    // Stale keys do not reduce coverage — nothing the citizen sees is missing.
    expect(c.complete).toBe(true);
  });

  it("rounds down so a nearly-complete bundle never reads as finished", () => {
    const bundle = { ...fullBundle };
    delete bundle[strings[0]!.key];
    const c = translationCoverage(strings, "hi", bundle);
    expect(c.percent).toBeLessThan(100);
  });

  it("treats a pack with nothing to translate as complete", () => {
    const c = translationCoverage([], "hi", {});
    expect(c.percent).toBe(100);
    expect(c.complete).toBe(true);
  });

  it("carries the locale it was asked about", () => {
    expect(translationCoverage(strings, "or", {}).locale).toBe("or");
  });
});

describe("FN-18 missingStringsFor — translator worklist", () => {
  it("returns only the untranslated strings, with their context intact", () => {
    const strings = extractTranslatableStrings(blocks());
    const partial = Object.fromEntries(strings.slice(0, 3).map((s) => [s.key, `hi:${s.source}`]));
    const coverage = translationCoverage(strings, "hi", partial);

    const work = missingStringsFor(strings, coverage);

    expect(work).toHaveLength(strings.length - 3);
    expect(keysOf(work)).not.toContain(strings[0]!.key);
    for (const s of work) expect(s.context.length).toBeGreaterThan(0);
  });

  it("returns nothing when the bundle is complete", () => {
    const strings = extractTranslatableStrings(blocks());
    const full = Object.fromEntries(strings.map((s) => [s.key, `hi:${s.source}`]));
    expect(missingStringsFor(strings, translationCoverage(strings, "hi", full))).toEqual([]);
  });
});
