/**
 * MSME commercial M0 -- widened "no edition forks" lint (docs/design/MSME-COMMERCIAL.md cross-cutting contract item 1).
 * Extends the NF-0 lint (nf0-no-edition-lint.test.ts, which covers gl / year-end / financial-statements) to EVERY file under
 * services/finance-service/src OUTSIDE approvals/ and tenant-onboard/ (the two places allowed to map edition -> stored settings).
 *
 * Outside those, behaviour is decided by STORED configuration (gl.finance_settings), never by edition. A file fails if it:
 *   - value-imports `@civitasone/tenant-profile` (type-only imports are erased and behaviour-free, so allowed);
 *   - uses getProfile / PROFILES;
 *   - reads `edition`;
 *   - references process.env.*EDITION*;
 *   - contains the quoted literal small_office or section8.
 * Static, no DB. Comments are stripped so documenting the rule does not trip it.
 */
import { describe, expect, it } from "vitest";
import { SRC, listTs, read, rel, stripComments } from "./_nf0-static.js";

const EXEMPT_DIRS = ["modules/approvals/", "modules/tenant-onboard/"];

const RULES: Record<string, RegExp> = {
  "value import of @civitasone/tenant-profile": /^\s*import\s+(?!type\b)[^;]*?from\s+["']@civitasone\/tenant-profile["']/m,
  "getProfile / PROFILES": /\b(getProfile|PROFILES)\b/,
  "reads edition": /\bedition\b/i,
  "process.env EDITION": /process\.env\.[A-Za-z0-9_]*EDITION/i,
  "small_office / section8 literal": /["'`](small_office|section8)["'`]/,
};

/**
 * Pre-existing violations on main when this lint was added. Each is reasoned; none may grow. An entry whose violation
 * disappears fails as stale, so this list can only shrink.
 */
const ALLOW: Record<string, string> = {
  "modules/gl/coa-template.ts": "S4 onboarding-time COA seeding; reads gl.finance_settings first, consults the catalogue only for head packs (also allowed by the NF-0 lint)",
  "modules/payments/consumer.ts": "S4: tenantProfilesEnabled() kill-switch gating the COA-template read; the template itself comes from stored settings",
  "modules/payments/routes.ts": "S4: tenantProfilesEnabled() kill-switch gating the COA-template read; the template itself comes from stored settings",
  "modules/simplified/routes.ts": "legacy edition guard (x-tenant-edition header); retired by MSME slice M7 -- must not be copied",
};

const exempt = (r: string): boolean => EXEMPT_DIRS.some((d) => r.startsWith(d));
const violations = (code: string): string[] => Object.entries(RULES).filter(([, re]) => re.test(code)).map(([n]) => n);

describe("MSME M0 lint: no edition forks anywhere in finance-service/src outside approvals/ and tenant-onboard/", () => {
  const files = listTs(SRC).filter((f) => !exempt(rel(f)));

  it("scans the whole service, not a subset", () => {
    const rels = files.map(rel);
    expect(rels).toContain("modules/gl/consumer.ts");
    expect(rels).toContain("modules/payments/consumer.ts");
    expect(rels.some(exempt)).toBe(false);
    expect(files.length).toBeGreaterThan(50);
  });

  it("no file outside the allow-list breaks a rule", () => {
    const offenders = files
      .map((f) => ({ f: rel(f), v: violations(stripComments(read(f))) }))
      .filter((o) => o.v.length > 0 && !(o.f in ALLOW))
      .map((o) => `${o.f} [${o.v.join("; ")}]`);
    expect(offenders, `edition/profile forks found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every allow-list entry still violates a rule and carries a reason (no stale exemptions)", () => {
    for (const [f, why] of Object.entries(ALLOW)) {
      expect(violations(stripComments(read(`${SRC}/${f}`))).length, `stale allow-list entry ${f}`).toBeGreaterThan(0);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it("the rules do detect each violation (self-test)", () => {
    expect(violations(`import { getProfile } from "@civitasone/tenant-profile";`)).toEqual(expect.arrayContaining(["value import of @civitasone/tenant-profile", "getProfile / PROFILES"]));
    expect(violations(`import type { CoaTemplate } from "@civitasone/tenant-profile";`)).toEqual([]);
    expect(violations(`if (t.edition === 1) {}`)).toContain("reads edition");
    expect(violations(`const e = process.env.TENANT_EDITION;`)).toContain("process.env EDITION");
    expect(violations(`x === "small_office"`)).toContain("small_office / section8 literal");
    expect(violations(`x === 'section8'`)).toContain("small_office / section8 literal");
    expect(violations(`const small_office_admin = 1;`)).toEqual([]);
  });
});
