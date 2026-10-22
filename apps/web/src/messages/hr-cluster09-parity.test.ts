import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * en/hi parity for the HR namespaces the W2 cluster-09 gap closures touched
 * (GAP-HR-CONFIRMATION-05, GAP-HR-RETIREMENT-08, GAP-HR-INTERNS-05,
 * GAP-HR-SERVICE-BOOK-04/06, GAP-HR-CONTRACTUAL-03/04): the same key tree, the
 * same ICU argument names, non-empty values, and Hindi that is actually
 * translated. Locales load only their own file (i18n/request.ts has no English
 * fallback), so a key missing from hi.json renders as a raw key path.
 */
type Tree = { [k: string]: string | Tree };

function flatten(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** ICU argument names only (`{name}` / `{name, plural, ...}`), not plural branch bodies. */
function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/(?<!(?:\b(?:zero|one|two|few|many|other|up)|=\d+)\s*)\{(\w+)\s*[,}]/g)].map((m) => m[1]!))].sort();
}

const enRoot = en as unknown as Tree;
const hiRoot = hi as unknown as Tree;

const NAMESPACES = [
  "confirmation",
  "retirement",
  "retirementDashboard",
  "retirementWorkspace",
  "retirementWizard",
  "initiateSeparation",
  "interns",
  "serviceBook",
  "serviceBookView",
  "contractual",
];

describe("HR cluster-09 namespaces: en/hi parity", () => {
  for (const ns of NAMESPACES) {
    it(`${ns}: same keys, same ICU arguments, non-empty and translated`, () => {
      expect(enRoot[ns], `en.json has no "${ns}" namespace`).toBeTruthy();
      const e = flatten(enRoot[ns] as Tree);
      const h = hiRoot[ns] ? flatten(hiRoot[ns] as Tree) : {};
      expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
      for (const k of Object.keys(e)) {
        expect(h[k]!.trim().length, `${ns}.${k} is empty in hi`).toBeGreaterThan(0);
        expect(placeholders(h[k]!), `${ns}.${k} ICU arguments differ`).toEqual(placeholders(e[k]!));
        // A Hindi value identical to the English must be a pure symbol/number/acronym, never untranslated prose.
        if (h[k] === e[k]) expect(e[k], `${ns}.${k} is untranslated in hi`).not.toMatch(/[A-Za-z]{4,}/);
      }
    });
  }
});

/**
 * Every literal translation key the retirement page and its components pass to a
 * `t(...)` / `tType(...)` translator exists in hi.json -- the page-level guard behind
 * "switch locale to hi: no raw keys / English literals" (GAP-HR-RETIREMENT-08).
 */
describe("retirement page: every literal translation key exists in hi.json", () => {
  const dir = join(__dirname, "..", "app", "(app)", "hr", "retirement");
  const files = [
    join(dir, "page.tsx"),
    ...readdirSync(join(dir, "_components"))
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .map((f) => join(dir, "_components", f)),
  ];

  for (const file of files) {
    it(file.split("/").slice(-2).join("/"), () => {
      const src = readFileSync(file, "utf8");
      const bindings = [...src.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\("(\w+)"\)/g)];
      expect(bindings.length).toBeGreaterThan(0);
      for (const [, variable, ns] of bindings) {
        const hiNs = (hiRoot[ns!] ?? {}) as Tree;
        const keys = [...src.matchAll(new RegExp(`\\b${variable}\\("([\\w.]+)"`, "g"))].map((m) => m[1]!);
        for (const key of keys) {
          const resolved = key.split(".").reduce<string | Tree | undefined>((node, part) => (typeof node === "object" ? node[part] : undefined), hiNs);
          expect(resolved, `${ns}.${key} (used as ${variable}("${key}")) is missing from hi.json`).toBeTruthy();
        }
      }
    });
  }
});

/**
 * GAP-HR-INTERNS-05: the empty-state / search copy must match the columns the table actually
 * shows (name, department, type, status, stipend, period) -- no mentor column exists.
 */
describe("interns copy matches the visible columns", () => {
  const interns = (root: Tree) => root["interns"] as Tree;
  for (const [locale, root] of [["en", enRoot], ["hi", hiRoot]] as const) {
    it(`${locale}: empty state and filter placeholder do not promise a mentor column`, () => {
      expect(interns(root)["emptyMessage"]).not.toMatch(/mentor|मेंटर/i);
      expect(interns(root)["filterPlaceholder"]).not.toMatch(/mentor|मेंटर/i);
      expect(interns(root)["subtitle"]).not.toMatch(/mentor|मेंटर/i);
    });
  }
});
