import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import ta from "./ta.json";
import te from "./te.json";
import kn from "./kn.json";
import { SUPPORTED_LOCALES } from "@/i18n/config";

/**
 * GAP-CRM-DASHBOARD-06: the CRM dashboard title/subtitle come from next-intl
 * (crm.dashboard.*) instead of a hard-coded English + Devanagari literal. ta/te/kn
 * are partial locales with no English fallback configured, so without these two
 * keys a Tamil/Telugu/Kannada user would be shown the raw key path "crm.dashboard.title"
 * as the page heading. Every supported locale must therefore carry both.
 *
 * Odia ("or") is NOT a supported locale (see SUPPORTED_LOCALES); adding it is an
 * owner decision tracked in docs/gap-ledger/crm.md.
 */
const BUNDLES = { en, hi, ta, te, kn } as const;

type Dash = { crm?: { dashboard?: { title?: string; subtitle?: string } } };

describe("crm.dashboard title/subtitle in every supported locale (GAP-CRM-DASHBOARD-06)", () => {
  it("covers exactly the supported locales this test knows about", () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(Object.keys(BUNDLES).sort());
  });

  it.each(Object.entries(BUNDLES))("%s has a non-empty title and subtitle", (_loc, bundle) => {
    const d = (bundle as Dash).crm?.dashboard;
    expect(d?.title?.trim().length ?? 0).toBeGreaterThan(0);
    expect(d?.subtitle?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it.each(["hi", "ta", "te", "kn"] as const)("%s subtitle is translated, not the English copy", (loc) => {
    const d = (BUNDLES[loc] as Dash).crm!.dashboard!;
    expect(d.subtitle).not.toBe((en as Dash).crm!.dashboard!.subtitle);
  });

  it("no locale carries the retired hard-coded Devanagari suffix inside an English subtitle", () => {
    expect((en as Dash).crm!.dashboard!.subtitle).not.toMatch(/[ऀ-ॿ]/);
  });
});
