import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import ta from "./ta.json";
import te from "./te.json";
import kn from "./kn.json";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n/config";

/**
 * UX-004 follow-up: ta/te/kn were deleted (with the rest of the old
 * lib/i18n/* framework) when UX-004 consolidated i18n onto next-intl, with
 * no migration path — flagged as an explicit open question in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's UX-004 row for whoever picked
 * up the next i18n tranche. This PR recovered the three files from git
 * history (`git show <pre-deletion commit>^:apps/web/src/lib/i18n/{ta,te,kn}.ts`),
 * read them in full, and found genuine, coherent, professionally-written
 * Tamil/Telugu/Kannada UI copy — not stubs, not machine-garbled text — just
 * scoped to an older, smaller, flat key set (194 keys: nav/action/status/
 * common/msg/error/setup/assistant/lang/auth/misc) that predates most of
 * this app's current namespaces (1859 keys across 84 namespaces today).
 *
 * That means ta/te/kn cover roughly 10% of the full app, by design — the
 * same "translate what exists, leave the rest to fall back" pattern this
 * app already uses for hi.json between UX-017 tranches. This file makes
 * that partial coverage an explicit, tested contract instead of a silent
 * fact someone has to rediscover:
 *   1. Coverage is real and non-trivial (not zero, not a token handful).
 *   2. Every key ta/te/kn *does* have also exists in en.json at the same
 *      path — no orphaned key silently doing nothing at runtime. If a
 *      future PR renames/removes one of these namespaces from en.json,
 *      this test fails and says so, rather than the key going quietly
 *      dead inside ta/te/kn only.
 *   3. Every value is a real, non-empty string (no accidental blanks).
 *   4. SUPPORTED_LOCALES / LOCALE_LABELS (src/i18n/config.ts) actually
 *      list all three, so the switcher offers them and never renders
 *      `undefined` for a label.
 */

function leafEntries(obj: unknown, prefix = ""): Array<[string, unknown]> {
  if (obj === null || typeof obj !== "object") return [[prefix, obj]];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v) ? leafEntries(v, path) : [[path, v] as [string, unknown]];
  });
}

function getPath(obj: Record<string, unknown>, path: string): { found: boolean; value: unknown } {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || !(p in (cur as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return { found: true, value: cur };
}

const RESTORED = { ta, te, kn } as const;

// Full app size today (~1859 keys). Restored locales cover a real slice of
// this, not the whole thing -- see file header. Kept as a loose ceiling so
// this test doesn't need touching every time an unrelated namespace grows;
// it exists to catch coverage silently regressing to near-zero, not to
// track the exact figure.
const FULL_KEY_COUNT = leafEntries(en).length;

describe("restored locales (ta/te/kn) — partial coverage is intentional, not silently broken", () => {
  it("lists ta/te/kn in SUPPORTED_LOCALES", () => {
    expect(SUPPORTED_LOCALES).toEqual(expect.arrayContaining(["en", "hi", "ta", "te", "kn"]));
  });

  it("gives every supported locale a real, non-empty LOCALE_LABELS entry", () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[loc], `LOCALE_LABELS is missing "${loc}"`).toBeTruthy();
      expect(typeof LOCALE_LABELS[loc]).toBe("string");
    }
  });

  it.each(Object.entries(RESTORED))("%s covers a real, non-trivial, non-zero subset of en.json's keys", (_loc, messages) => {
    const keyCount = leafEntries(messages).length;
    // Not zero, not a token handful, and honestly nowhere near full
    // coverage -- both bounds document the actual, intentional shape of
    // this restoration rather than letting either extreme drift in
    // silently.
    expect(keyCount).toBeGreaterThan(100);
    expect(keyCount).toBeLessThan(FULL_KEY_COUNT * 0.5);
  });

  it.each(Object.entries(RESTORED))("every %s key exists at the same path in en.json (no orphaned keys)", (_loc, messages) => {
    const orphans = leafEntries(messages)
      .map(([path]) => path)
      .filter((path) => !getPath(en as Record<string, unknown>, path).found);
    expect(orphans, `orphaned keys with no en.json counterpart: ${orphans.join(", ")}`).toEqual([]);
  });

  it.each(Object.entries(RESTORED))("every %s value is a real, non-empty string", (_loc, messages) => {
    const blanks = leafEntries(messages).filter(([, value]) => typeof value !== "string" || value.trim().length === 0);
    expect(blanks, `blank/non-string values: ${JSON.stringify(blanks)}`).toEqual([]);
  });

  it("en.json and hi.json both already carry autonym labels for ta/te/kn under lang.*", () => {
    for (const messages of [en, hi]) {
      expect(messages.lang.ta).toBeTruthy();
      expect(messages.lang.te).toBeTruthy();
      expect(messages.lang.kn).toBeTruthy();
    }
  });
});
