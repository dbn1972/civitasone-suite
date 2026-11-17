/**
 * Section 8 NF-0 lint test (design §0 contract #1, §9): no business-logic branch in the finance posting modules reads
 * `edition` or the profile catalogue. Behaviour is decided by STORED configuration (gl.finance_settings), never by edition.
 *
 * Static, no DB. Covers modules/{gl,year-end,financial-statements} (the design's named set). Comments are stripped, so
 * documenting the rule does not trip it.
 */
import { describe, expect, it } from "vitest";
import { SRC, listTs, read, rel, stripComments } from "./_nf0-static.js";
import { join } from "node:path";

const DIRS = ["modules/gl", "modules/year-end", "modules/financial-statements"];
/** Profile-catalogue accessors that resolve behaviour from the edition/profile (the *Settings types are fine). */
const BANNED_IMPORT = /\b(getProfile|PROFILES|effectiveSettings|describeProfile|defaultProfileCode|isProfileAllowedForEdition|tenantProfilesEnabled)\b/;
const EDITION_READ = /\bedition\b/i;

/**
 * Explicit, reasoned exceptions. coa-template.ts is the ONBOARDING-time chart seeder (tenant.tenant.onboarded -> seed
 * heads); it reads the stored settings row and only consults the catalogue for the S4 head-pack list. It is not on a
 * posting path. Must still contain a violation, or the entry fails as stale.
 */
const ALLOW: Record<string, string> = {
  "modules/gl/coa-template.ts": "onboarding-time COA seeding (S4), not a posting path; reads gl.finance_settings first and consults the catalogue only for head packs",
};

describe("NF-0 lint: finance posting modules do not read edition or the profile catalogue", () => {
  const files = DIRS.flatMap((d) => listTs(join(SRC, d)));

  it("scans a non-trivial file set including the posting consumer", () => {
    expect(files.map(rel)).toContain("modules/gl/consumer.ts");
    expect(files.length).toBeGreaterThan(10);
  });

  it("no gl / year-end / financial-statements file imports or uses the profile catalogue, or reads `edition`", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(read(f));
      const bad = BANNED_IMPORT.test(code) || EDITION_READ.test(code);
      if (bad && !(rel(f) in ALLOW)) offenders.push(rel(f));
    }
    expect(offenders, `banned edition/getProfile usage in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every allow-list entry still has a violation (no stale exemptions) and a reason", () => {
    for (const [f, why] of Object.entries(ALLOW)) {
      const code = stripComments(read(join(SRC, f)));
      expect(BANNED_IMPORT.test(code) || EDITION_READ.test(code), `stale allow-list entry ${f}`).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it("the NF-0 fund seam itself is catalogue-free", () => {
    const code = stripComments(read(join(SRC, "modules/gl/fund-context.ts")));
    expect(code).not.toMatch(/tenant-profile/);
    expect(BANNED_IMPORT.test(code)).toBe(false);
    expect(EDITION_READ.test(code)).toBe(false);
  });
});
