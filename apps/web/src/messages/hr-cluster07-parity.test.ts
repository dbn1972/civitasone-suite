import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * HR gap cluster 07 -- en/hi parity for the namespaces its pages read, and a
 * check that every key those pages ask for really exists.
 *
 * i18n/request.ts loads ONLY the active locale file (no English fallback
 * merge), so a key that exists in en.json but not hi.json does not fall back to
 * English: next-intl prints the key path on screen. GAP-HR-TRAVEL-06 asks for
 * a "keys in travelForm exist in every locale file" test; this is it for en and
 * hi, the locales that carry these namespaces.
 *
 * (ta / te / kn are a deliberately partial restored subset -- see
 * restored-locales.test.ts -- and carry none of these namespaces; whether to
 * translate them or merge an English fallback is an open owner decision.)
 */
type Tree = { [k: string]: string | Tree };

function leaves(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[p] = v;
    else Object.assign(out, leaves(v, p));
  }
  return out;
}

/** Top-level ICU argument names: {name} and {name, plural, ...}. */
const args = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!))].sort();

const NAMESPACES = ["attendanceConfig", "shifts", "travel", "travelForm", "advances", "loans", "benefits", "expenses"] as const;

// Select-templates (cluster 06 *Tpl keys) whose branch words are translated
// prose in hi, so their bare {branch} tokens differ by design (see attendanceConfig page test).
const PROSE_IN_HI = new Set([
  "attendanceConfig.whWeeklyOffTpl", "attendanceConfig.otRequiresApprovalTpl",
  "attendanceConfig.coEarnedWhenTpl", "attendanceConfig.coApprovalRequiredTpl",
]);

const root = en as unknown as Record<string, Tree>;
const hiRoot = hi as unknown as Record<string, Tree>;

describe.each(NAMESPACES)("en/hi parity: %s", (ns) => {
  const enLeaves = leaves(root[ns]!);
  const hiLeaves = leaves(hiRoot[ns]!);

  it("hi.json has exactly the keys en.json has", () => {
    expect(Object.keys(hiLeaves).sort()).toEqual(Object.keys(enLeaves).sort());
  });

  it("every hi value is non-empty and keeps en's ICU arguments", () => {
    for (const [k, v] of Object.entries(enLeaves)) {
      expect(hiLeaves[k]?.trim().length, `${ns}.${k} empty in hi`).toBeGreaterThan(0);
      if (PROSE_IN_HI.has(`${ns}.${k}`)) continue;
      expect(args(hiLeaves[k]!), `${ns}.${k} ICU arguments differ`).toEqual(args(v));
    }
  });
});

// Every static t("key") a cluster-07 source file asks for must exist in en AND hi.
const APP = path.join(__dirname, "..", "app", "(app)", "hr");
const SOURCES: Array<[namespace: (typeof NAMESPACES)[number], files: string[]]> = [
  ["travelForm", ["travel/TravelRequestForm.tsx"]],
  ["travel", ["travel/page.tsx", "travel/TravelRequestsTable.tsx", "travel/TravelApprovalsTable.tsx", "travel/TravelApprovalActions.tsx"]],
  ["advances", ["advances/page.tsx", "advances/RequestAdvanceForm.tsx", "advances/ApproveAdvanceButton.tsx", "advances/error.tsx"]],
  ["shifts", ["shifts/page.tsx", "_components/ShiftCard.tsx"]],
  ["loans", ["loans/page.tsx", "loans/LoansTable.tsx", "loans/EmiProgressCell.tsx"]],
  ["attendanceConfig", ["attendance/config/page.tsx", "attendance/config/loading.tsx"]],
  ["expenses", ["expenses/NewExpenseClaimForm.tsx"]],
];

describe.each(SOURCES)("keys read by the %s sources exist in en and hi", (ns, files) => {
  const enLeaves = leaves(root[ns]!);
  const hiLeaves = leaves(hiRoot[ns]!);

  it.each(files)("%s", (file) => {
    const src = readFileSync(path.join(APP, file), "utf8");
    // t("key") / t('key') with a literal, dotted-or-plain key; template keys (types.${code}) are skipped.
    const keys = [...src.matchAll(/\bt\(\s*["']([\w.]+)["']/g)].map((m) => m[1]!);
    for (const key of new Set(keys)) {
      // `shifts` fallback tables and ICU-only keys still must resolve in both files
      expect(enLeaves[key], `${ns}.${key} (used by ${file}) missing from en.json`).toBeDefined();
      expect(hiLeaves[key], `${ns}.${key} (used by ${file}) missing from hi.json`).toBeDefined();
    }
  });
});
