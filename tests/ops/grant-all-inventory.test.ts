/**
 * grant-all inventory regression lock (UAT DB test g7-municipal, 2026-10-28).
 *
 * scripts/dev/grant-all.mjs gives each service role its schema/table/sequence
 * grants. A database whose *_svc role is missing from DB_USERS comes up with
 * tables but no grants (advertisement/animal/vendor/swm/sewerage did exactly
 * that). Lock the five reported ones and the naming convention.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const src = readFileSync(join(ROOT, "scripts/dev/grant-all.mjs"), "utf8");
const start = src.indexOf("const DB_USERS = {");
const block = src.slice(start, src.indexOf("};", start));
const entries = [...block.matchAll(/^\s*(civitas_\w+):\s*"(\w+)"/gm)].map((m) => [m[1]!, m[2]!] as const);
const map = new Map(entries);

describe("grant-all inventory", () => {
  it.each(["advertisement", "animal", "vendor", "swm", "sewerage"])(
    "grants civitas_%s to its *_svc role",
    (name) => {
      expect(map.get(`civitas_${name}`)).toBe(`${name}_svc`);
    },
  );

  it("every entry follows civitas_<x> -> <x>_svc (except admin)", () => {
    const bad = entries.filter(([db, role]) => db !== "civitas_admin" && role !== `${db.replace("civitas_", "")}_svc`);
    expect(bad).toEqual([]);
  });

  it("has no duplicate databases", () => {
    expect(new Set(entries.map(([d]) => d)).size).toBe(entries.length);
  });

  it("grants on existing and future sequences", () => {
    expect(src).toContain("GRANT ALL ON ALL SEQUENCES IN SCHEMA");
    expect(src).toContain("GRANT ALL ON SEQUENCES TO");
  });
});
