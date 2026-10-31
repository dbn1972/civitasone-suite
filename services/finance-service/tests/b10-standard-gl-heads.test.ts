/**
 * F89/F91 (UAT T6-01, T6-03): the standard GL heads seeded at provisioning and backfilled into existing tenants must
 * cover EVERY account code a posting path resolves by code -- the env-defaulted codes (`process.env.X ?? "1234"`) and
 * the literal `accountCode: "1234"` legs. A posting path that adds a new default code without a standard head fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { standardGlHeads, missingStandardHeads } from "../src/modules/gl/standard-heads.js";

// Modules that build journals from account CODES (resolved per tenant by budgetRepo.findHeadByCodeTx). simplified/ is
// excluded: it posts to its own MSME chart (a separate table, seeded by that module).
const POSTING_MODULES = ["gl", "revenue-billing", "revenue-gl", "payments", "treasury", "tds", "integrations", "fixed-asset"];
const MODULES = join(__dirname, "..", "src", "modules");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

function defaultCodes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const mod of POSTING_MODULES) {
    for (const file of sources(join(MODULES, mod))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/process\.env(?:\.[A-Z_]+|\[\s*["'][A-Z_]+["']\s*\])\s*\?\?\s*["'](\d{4})["']/g)) found.set(m[1]!, file);
      for (const m of text.matchAll(/accountCode:\s*["'](\d{4})["']/g)) found.set(m[1]!, file);
    }
  }
  return found;
}

describe("standard GL heads", () => {
  it("cover the codes UAT tenant A was missing (T6-01 / T6-03)", () => {
    const codes = standardGlHeads().map((h) => h.code);
    for (const c of ["1250", "5100", "5101", "1300", "4010", "5200", "4001", "4200"]) expect(codes).toContain(c);
  });

  it("cover every default account code a posting path resolves by code", () => {
    const codes = new Set(standardGlHeads().map((h) => h.code));
    const found = defaultCodes();
    expect(found.size).toBeGreaterThan(15); // the scan really saw the posting modules
    const uncovered = [...found].filter(([c]) => !codes.has(c)).map(([c, f]) => `${c} (${f.replace(MODULES, "")})`);
    expect(uncovered).toEqual([]);
  });

  it("have one definition per code, a name and a known classification", () => {
    const heads = standardGlHeads();
    expect(new Set(heads.map((h) => h.code)).size).toBe(heads.length);
    for (const h of heads) {
      expect(h.name.length).toBeGreaterThan(3);
      expect(["asset", "capital", "liability", "income", "expense"]).toContain(h.classification);
    }
  });

  it("missingStandardHeads plans only the codes a tenant lacks", () => {
    const all = standardGlHeads().map((h) => h.code);
    expect(missingStandardHeads(all)).toEqual([]);
    expect(missingStandardHeads(all.filter((c) => c !== "1250")).map((h) => h.code)).toEqual(["1250"]);
  });
});
