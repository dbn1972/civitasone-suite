import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * HR cluster 10 rescan: namespaces that must be fully available in Hindi, not
 * just English. The app loads only the active locale's file with no fallback
 * merge (src/i18n/request.ts), so a key present in en.json but missing from
 * hi.json renders as a raw key / error for Hindi users.
 *
 *  - jdTemplates / jdTemplateNew (GAP-HR-JD-TEMPLATES-06): hi had 9 of 23 and
 *    47 of 49 keys, so the Hindi library page was mostly untranslated.
 *  - apar / aparDetail / successionPlanCard / designationsTable: the keys this
 *    rescan added or renamed (APAR-05/06, APAR-DETAIL-03/05, SUCCESSION-02,
 *    DESIGNATIONS-01) must exist in both languages.
 */
type Dict = Record<string, unknown>;
const ns = (root: Dict, name: string): Record<string, string> => root[name] as Record<string, string>;
// ICU argument names only: the bodies of plural/select branches ("one {time}") are translated text, not arguments.
const args = (s: string): string[] =>
  [...new Set(
    [...s.replace(/(?:zero|one|two|few|many|other|=\d+)\s*\{[^{}]*\}/g, "").matchAll(/\{(\w+)/g)].map((m) => m[1]!),
  )].sort();

const FULL_NAMESPACES = ["jdTemplates", "jdTemplateNew"] as const;
const ADDED_KEYS: Record<string, string[]> = {
  apar: ["subtitle", "statInOfficerReview", "statInOfficerReviewHint", "filterSearchLabel", "filterSearchPlaceholder", "pagerAria", "pagerSummary", "pagerBeyondEnd", "pagerPrev", "pagerNext"],
  aparDetail: [
    "statAvgScore", "statAvgScoreHint", "statProvisionalScore", "statProvisionalScoreHint", "gradeVsAverageNote", "gradeScaleItem", "gradeScaleElse",
    "bandOutstanding", "bandVeryGood", "bandGood", "bandAverage", "bandBelowAverage", "reviewingDecisionLabel", "decisionConcur", "decisionVary", "variationLine",
  ],
  successionPlanCard: ["devPlanLabel", "planOnFile"],
  designationsTable: ["colServiceGroup", "serviceGroupIndicativeTitle", "serviceGroupNote"],
};

describe("HR cluster 10 i18n: jdTemplates + jdTemplateNew are complete in Hindi", () => {
  for (const name of FULL_NAMESPACES) {
    it(`${name}: hi.json has every key en.json has, and no extras`, () => {
      const enKeys = Object.keys(ns(en, name)).sort();
      const hiKeys = Object.keys(ns(hi, name)).sort();
      expect(hiKeys).toEqual(enKeys);
    });

    it(`${name}: placeholders match and values are non-empty`, () => {
      for (const [k, e] of Object.entries(ns(en, name))) {
        const h = ns(hi, name)[k];
        expect(h, `${name}.${k} (hi)`).toBeTruthy();
        expect(args(h!), `${name}.${k}`).toEqual(args(e));
      }
    });
  }

  it("the visible library strings are actually Hindi, not copies of the English", () => {
    for (const k of ["title", "subtitle", "newTemplate", "useTemplate", "edit", "filterAllTypes", "filterRegular", "filterContractual", "emptyTitle", "usedCount"]) {
      expect(ns(hi, "jdTemplates")[k], k).not.toBe(ns(en, "jdTemplates")[k]);
    }
  });

  it("the New template button text carries no literal '+' (the icon is rendered separately)", () => {
    expect(ns(en, "jdTemplates").newTemplate).not.toMatch(/^\s*\+/);
    expect(ns(hi, "jdTemplates").newTemplate).not.toMatch(/^\s*\+/);
  });
});

describe("HR cluster 10 i18n: added keys exist in English and Hindi with matching placeholders", () => {
  for (const [name, keys] of Object.entries(ADDED_KEYS)) {
    it(`${name}`, () => {
      for (const k of keys) {
        const e = ns(en, name)[k];
        const h = ns(hi, name)[k];
        expect(e, `${name}.${k} (en)`).toBeTruthy();
        expect(h, `${name}.${k} (hi)`).toBeTruthy();
        expect(args(h!), `${name}.${k}`).toEqual(args(e!));
      }
    });
  }
});
