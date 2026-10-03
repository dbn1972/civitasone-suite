import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * fin-recruitment-01 added these namespaces (and keys inside existing ones) in English AND Hindi; the placeholder
 * names must match or next-intl renders a raw `{name}` / throws at format time (ICU args are not translated).
 */
const NEW_NAMESPACES = ["recruitmentFinish", "careersCommon", "careersHome", "careersDetail", "careersApply"] as const;
const ADDED_KEYS: Record<string, string[]> = {
  recruitmentDetail: ["actionFee", "actionManageOffer", "blindCandidate", "blindRowHint", "categoryClaim", "viewResume", "resumeLinkFailed", "subpagesNav", "linkSelectionLists", "linkResults", "blindHelp", "blindOn", "blindOff"],
  recruitmentGoiCard: ["horizontalLegend", "horizontal_PWBD", "horizontal_EXSM", "horizontal_WOMEN", "horizontalHelp", "horizontalSummary"],
  recruitmentApplicationDetail: ["viewResume", "resumeLinkFailed", "feeStatusButton"],
  recruitmentTalentPool: ["purposeNoteDefault"],
  recruitment: ["settingsLink"],
};

type Dict = Record<string, unknown>;
const get = (root: Dict, ns: string): Record<string, string> => root[ns] as Record<string, string>;
const args = (s: string): string[] => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();

function pairs(): Array<[string, string, string, string]> {
  const out: Array<[string, string, string, string]> = [];
  for (const ns of NEW_NAMESPACES) for (const k of Object.keys(get(en, ns))) out.push([ns, k, get(en, ns)[k]!, get(hi, ns)[k] as string]);
  for (const [ns, keys] of Object.entries(ADDED_KEYS)) for (const k of keys) out.push([ns, k, get(en, ns)[k] as string, get(hi, ns)[k] as string]);
  return out;
}

describe("recruitment finish i18n: English and Hindi stay in step", () => {
  it("every added key exists in both languages and is non-empty", () => {
    for (const [ns, k, e, h] of pairs()) {
      expect(e, `${ns}.${k} (en)`).toBeTruthy();
      expect(h, `${ns}.${k} (hi)`).toBeTruthy();
    }
  });
  it("placeholder names match between English and Hindi", () => {
    for (const [ns, k, e, h] of pairs()) expect(args(h), `${ns}.${k}`).toEqual(args(e));
  });
  it("the Hindi text is actually translated (not a copy of the English)", () => {
    const same = pairs().filter(([, k, e, h]) => e === h && !/^(ph|phEmail|phStipend|phExperience|phHours|phIti|type_|category_sc|category_st|category_ews|qualLevel_ITI|horizontal_PWBD)/.test(k) && /[A-Za-z]{4,}/.test(e));
    expect(same.map(([ns, k]) => `${ns}.${k}`)).toEqual([]);
  });
});
