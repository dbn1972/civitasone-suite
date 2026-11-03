import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * GAP-UAT-P3-ERRCOPY i18n check: every key this change adds has both en and hi, the
 * Hindi is real Devanagari (never left in English), the ICU arguments match, and the
 * fixed loader / search failures no longer blame the user's internet connection.
 */
type Tree = { [k: string]: string | Tree };
const E = en as unknown as Tree;
const H = hi as unknown as Tree;
const DEVANAGARI = /[ऀ-ॿ]/;
const args = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort();
const get = (t: Tree, path: string): string | undefined => {
  let cur: string | Tree | undefined = t;
  for (const p of path.split(".")) cur = typeof cur === "object" ? cur[p] : undefined;
  return typeof cur === "string" ? cur : undefined;
};

function checkNamespace(ns: string) {
  const enNs = E[ns] as Record<string, string>;
  const hiNs = H[ns] as Record<string, string>;
  expect(enNs, ns + " in en").toBeDefined();
  expect(hiNs, ns + " in hi").toBeDefined();
  expect(Object.keys(hiNs)).toEqual(Object.keys(enNs));
  for (const [k, v] of Object.entries(enNs)) {
    const h = hiNs[k];
    expect(h?.trim().length, ns + "." + k + " empty in hi").toBeGreaterThan(0);
    expect(DEVANAGARI.test(h), ns + "." + k + " left in English").toBe(true);
    expect(args(h), ns + "." + k).toEqual(args(v));
  }
}

describe("uxMessages: new keys have en and hi", () => {
  it("uxMessages", () => checkNamespace("uxMessages"));
  it("uses ICU plurals, so 1 reads singular", () => {
    const ns = E.uxMessages as Record<string, string>;
    expect(ns.onboardingOverdueNotice).toContain("one {# joinee has overdue onboarding tasks}");
    expect(ns.leaveRoutingFailedTitle).toContain("one {# leave request could not be sent for approval}");
  });
});

describe("namespaces that were missing from hi.json", () => {
  it.each(["onboarding", "disciplinary"])("%s is translated", (ns) => checkNamespace(ns));
});

describe("loader and search failures name the object and never blame the connection", () => {
  const keys = [
    "employeePicker.searchFailed",
    "directoryPicker.searchFailed",
    "leaveBalance.employeeListError",
    "promotionApprove.lookupFailed",
    "expenditureAdvancesNew.vendorSearchFailed",
    "works.tsNew.workSearchFailed",
    "financeChartOfAccountsNew.searchFailed",
    "citizenServices.submitFailed",
    "taxProofs.errors.generic",
    "revealableValue.failed",
    "piiReveal.failed",
    "error.load.next",
  ];
  it.each(keys)("%s", (key) => {
    const e = get(E, key);
    const h = get(H, key);
    expect(e, key).toBeDefined();
    expect(h, key).toBeDefined();
    expect(e).not.toMatch(/connection|internet/i);
    expect(h).not.toMatch(/कनेक्शन|इंटरनेट/);
    expect(DEVANAGARI.test(h as string)).toBe(true);
  });

  it("no en value says only \"Couldn't load — showing nothing\"", () => {
    const bad: string[] = [];
    const walk = (t: Tree, p: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === "string") {
          if (/showing nothing$/.test(v)) bad.push(p + k);
        } else walk(v, p + k + ".");
      }
    };
    walk(E, "");
    expect(bad).toEqual([]);
  });
});
