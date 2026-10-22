import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import kn from "@/messages/kn.json";
import ta from "@/messages/ta.json";
import te from "@/messages/te.json";
import { withEnglishFallback, type MessageTree } from "@/i18n/mergeMessages";

// GAP-HR-TRANSFER-10: every string /hr/transfer renders comes from a message key, and every key
// resolves in all five locales (hi has its own translation; kn/ta/te fall back to English through
// i18n/request.ts, see i18n/mergeMessages.ts).
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const FILES: Array<{ file: string; code: string }> = [
  "./page.tsx",
  "./TransferWithApproval.tsx",
  "./_components/TransferListFilters.tsx",
  "./_components/TransferOrderCard.tsx",
].map((file) => ({ file, code: src(file) }));

// `t` is the "transfer" namespace translator, `tr` the "transferUi" one (the naming every file here uses).
function usedKeys(): Array<{ ns: "transfer" | "transferUi"; key: string; file: string }> {
  const out: Array<{ ns: "transfer" | "transferUi"; key: string; file: string }> = [];
  for (const { file, code } of FILES) {
    for (const m of code.matchAll(/(?<![\w.])(t|tr)\(\s*"([A-Za-z0-9_.]+)"/g)) {
      out.push({ ns: m[1] === "t" ? "transfer" : "transferUi", key: m[2] as string, file });
    }
  }
  return out;
}

const resolve = (tree: MessageTree, ns: string, key: string): unknown =>
  `${ns}.${key}`.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), tree);

const LOCALES = { hi, kn, ta, te } as const;

describe("/hr/transfer i18n (GAP-HR-TRANSFER-10)", () => {
  const keys = usedKeys();

  it("finds the keys the transfer UI uses", () => {
    expect(keys.length).toBeGreaterThan(60);
    expect(new Set(keys.map((k) => k.ns))).toEqual(new Set(["transfer", "transferUi"]));
  });

  it("every key used under 'transfer' / 'transferUi' exists in English", () => {
    for (const { ns, key, file } of keys) {
      expect(typeof resolve(en as MessageTree, ns, key), `${ns}.${key} (${file}) missing from en.json`).toBe("string");
    }
  });

  it("every key used exists in hi.json itself (a real translation, not a fallback)", () => {
    for (const { ns, key, file } of keys) {
      expect(typeof resolve(hi as MessageTree, ns, key), `${ns}.${key} (${file}) missing from hi.json`).toBe("string");
    }
  });

  it.each(Object.entries(LOCALES))("every key used resolves to a non-empty string in %s (own text or the English fallback)", (_code, locale) => {
    const merged = withEnglishFallback(en as MessageTree, locale as MessageTree);
    for (const { ns, key } of keys) {
      const v = resolve(merged, ns, key);
      expect(typeof v === "string" && v.length > 0, `${ns}.${key}`).toBe(true);
    }
  });

  it("hi has the whole 'transfer' namespace, with the same ICU placeholders as English", () => {
    const flat = (o: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    const enT = flat(en.transfer);
    const hiT = flat((hi as unknown as { transfer: Record<string, unknown> }).transfer);
    expect(Object.keys(hiT).sort()).toEqual(Object.keys(enT).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(enT)) expect(ph(hiT[k]!), k).toEqual(ph(enT[k]!));
  });

  it("page.tsx has no hard-coded user-facing English (back link, load-error badge, view-only note)", () => {
    const page = FILES[0]!.code;
    expect(page).not.toContain('backLabel="Back to HR"');
    expect(page).not.toMatch(/Couldn.t load transfer orders/);
    expect(page).not.toMatch(/view-only access/);
    // no literal text between JSX tags
    expect(page.match(/<\/?[A-Za-z][^<>]*>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g)).toBeNull();
  });
});
