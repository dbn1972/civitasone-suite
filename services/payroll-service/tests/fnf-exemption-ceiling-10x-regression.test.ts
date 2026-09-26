/**
 * Regression guard for the F&F exemption-ceiling 10x bug (migration
 * 0048_fix_fnf_exemption_ceilings_10x.sql).
 *
 * The bug: migration 0022 seeded all four Sec 10(10)/10(10AA)/10(10B)/
 * 10(10C) exemption ceilings at exactly 10x their own documented rupee
 * figure (e.g. "Gratuity ₹20L" seeded as 2,000,000,000 paise instead of
 * 200,000,000), and the identical wrong numbers were hardcoded as the
 * no-config-row fallback in fnf/routes.ts and fnf/consumer.ts.
 *
 * A hardcoded "expect(ceiling).toBe(200000000n)" regression test would not
 * actually catch a FUTURE re-introduction of this exact bug class, because
 * the same transcription slip (rupees-to-paise off by one factor of 10)
 * could just as easily be made in the test's own expected literal. Instead,
 * every assertion below RECOMPUTES the expected paise value from the
 * ₹NL figure written in prose in the migration's own "notes" column /
 * header comment (₹1L = ₹1,00,000; paise = rupees × 100) and compares that
 * independently-derived number against what the seed data and the source
 * fallbacks actually contain -- so a future 10x slip in either place, even
 * if internally "consistent" with itself, is caught as long as the ₹NL
 * prose and the numeral disagree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");
const FNF_DIR = join(__dirname, "..", "src", "modules", "fnf");

const migration0022 = readFileSync(join(MIGRATIONS_DIR, "0022_fnf_ltc_exemptions.sql"), "utf8");
const migration0048 = readFileSync(join(MIGRATIONS_DIR, "0048_fix_fnf_exemption_ceilings_10x.sql"), "utf8");
const routesSrc = readFileSync(join(FNF_DIR, "routes.ts"), "utf8");
const consumerSrc = readFileSync(join(FNF_DIR, "consumer.ts"), "utf8");

/** ₹1L = ₹1,00,000; paise = rupees × 100. */
function lakhsToPaise(lakhs: bigint): bigint {
  return lakhs * 100_000n * 100n;
}

interface SeedTuple {
  fyStartYear: number;
  section: string;
  ceilingMinor: bigint;
  documentedLakhs: bigint;
}

/** Parses `(gen_random_uuid(), <fy>, '<section>', <ceiling_minor>, '<notes>')` tuples. */
function parseSeedTuples(sql: string): SeedTuple[] {
  const tupleRe = /\(\s*gen_random_uuid\(\),\s*(\d{4}),\s*'([\w]+)',\s*(\d+),\s*'([^']*)'\s*\)/g;
  const out: SeedTuple[] = [];
  for (const m of sql.matchAll(tupleRe)) {
    const [, fy, section, ceiling, notes] = m;
    const lakhMatch = notes!.match(/₹(\d+)L/);
    if (!lakhMatch) throw new Error(`seed tuple for ${section}/${fy} has no ₹NL figure in its notes: "${notes}"`);
    out.push({
      fyStartYear: Number(fy),
      section: section!,
      ceilingMinor: BigInt(ceiling!),
      documentedLakhs: BigInt(lakhMatch[1]!),
    });
  }
  return out;
}

/** Parses `UPDATE payroll.exemption_ceilings SET ceiling_minor = <n> WHERE ... section = '<s>' ...` blocks. */
function parseCorrectionUpdates(sql: string): Map<string, bigint> {
  const updateRe = /UPDATE payroll\.exemption_ceilings\s+SET ceiling_minor = (\d+)\s+WHERE fy_start_year IN \([^)]*\) AND section = '([\w]+)'/g;
  const out = new Map<string, bigint>();
  for (const m of sql.matchAll(updateRe)) {
    const [, ceiling, section] = m;
    out.set(section!, BigInt(ceiling!));
  }
  return out;
}

/** Parses `ceilingMap.get("<section>") ?? <n>n` fallback literals from fnf route/consumer source. */
function parseFallbackConstants(src: string): Map<string, bigint> {
  const fallbackRe = /ceilingMap\.get\("([\w]+)"\)\s*\?\?\s*(\d+)n/g;
  const out = new Map<string, bigint>();
  for (const m of src.matchAll(fallbackRe)) {
    const [, section, value] = m;
    out.set(section!, BigInt(value!));
  }
  return out;
}

// The migration's own documentation is the single source of truth for what
// each section's ceiling is SUPPOSED to be, in rupees. Sourced from 0022's
// original "notes" column text (unchanged by 0048's UPDATEs, which only
// touch ceiling_minor) -- never a second hand-typed constant in this test.
const seed0022 = parseSeedTuples(migration0022);
const documentedLakhsBySection = new Map<string, bigint>();
for (const t of seed0022) {
  const existing = documentedLakhsBySection.get(t.section);
  if (existing !== undefined && existing !== t.documentedLakhs) {
    throw new Error(`0022 documents conflicting ₹NL figures for ${t.section}: ${existing}L vs ${t.documentedLakhs}L`);
  }
  documentedLakhsBySection.set(t.section, t.documentedLakhs);
}

describe("F&F exemption ceilings match their own documented rupee amounts (10x regression guard)", () => {
  it("0022 seeded 8 rows (4 sections × FY2024-25/FY2025-26), each with a ₹NL figure in its notes", () => {
    expect(seed0022.length).toBe(8);
    expect(documentedLakhsBySection.size).toBe(4);
  });

  it.each([...documentedLakhsBySection.entries()])(
    "migration 0048 corrects the FY2024-25/FY2025-26 %s row(s) to exactly documented-rupees × 100 (paise)",
    (section, lakhs) => {
      const corrections = parseCorrectionUpdates(migration0048);
      const corrected = corrections.get(section);
      expect(corrected, `no UPDATE found in 0048 for section ${section}`).toBeDefined();
      expect(corrected).toBe(lakhsToPaise(lakhs));
    },
  );

  it("0048 also seeds FY2026-27 rows whose ceiling_minor matches their OWN documented ₹NL figure", () => {
    const seed0048 = parseSeedTuples(migration0048).filter((t) => t.fyStartYear === 2026);
    expect(seed0048.length).toBeGreaterThan(0);
    for (const t of seed0048) {
      expect(t.ceilingMinor, `FY2026-27 ${t.section} seed vs. its own ₹${t.documentedLakhs}L notes`).toBe(
        lakhsToPaise(t.documentedLakhs),
      );
      // And it must agree with the canonical documented figure for that
      // section (no silent drift between what 0022 and 0048 each document).
      expect(t.documentedLakhs).toBe(documentedLakhsBySection.get(t.section));
    }
  });

  it.each([
    ["routes.ts (GET .../fnf-tax-breakdown)", () => routesSrc],
    ["consumer.ts (payroll.fnf.compute worker)", () => consumerSrc],
  ])("%s: no-config-row fallback constants match the documented rupee amounts, in paise", (_label, getSrc) => {
    const fallbacks = parseFallbackConstants(getSrc());
    expect(fallbacks.size).toBe(4);
    for (const [section, lakhs] of documentedLakhsBySection) {
      const actual = fallbacks.get(section);
      expect(actual, `${section} fallback constant missing`).toBeDefined();
      expect(actual, `${section} fallback should be ₹${lakhs}L in paise`).toBe(lakhsToPaise(lakhs));
    }
  });
});

describe("F&F exemption ceiling correctly caps when the actual amount exceeds it (domain-level)", () => {
  it("gratuity: correct ₹20L ceiling caps a ₹30L payout that the wrong ₹2Cr (10x) ceiling would not", async () => {
    const { computeGratuityExemption } = await import("../src/modules/tax/exemptions.js");

    const shared = {
      actualGratuityMinor: 300_000_000n, // ₹30L
      lastDrawnWagesMinor: 20_000_000n, // ₹2L/month
      completedYears: 30,
      employeeCategory: "non_govt_covered" as const,
    };

    const withWrongCeiling = computeGratuityExemption({ ...shared, ceilingMinor: 2_000_000_000n }); // ₹2Cr (10x bug)
    const withCorrectCeiling = computeGratuityExemption({ ...shared, ceilingMinor: 200_000_000n }); // ₹20L

    // Under the bug, the ceiling never binds (actual < wrong ceiling), so
    // exemption is un-capped.
    expect(withWrongCeiling.exemptMinor).toBe(300_000_000n);
    expect(withWrongCeiling.taxableMinor).toBe(0n);

    // With the correct ceiling, exemption is capped at ₹20L and the
    // remaining ₹10L becomes taxable -- the exact ₹10L under-withholding
    // this bug caused in the real settlement path.
    expect(withCorrectCeiling.exemptMinor).toBe(200_000_000n);
    expect(withCorrectCeiling.taxableMinor).toBe(100_000_000n);
  });
});
