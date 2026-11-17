/**
 * Data-keyed guard (owner rule, 2026-11): rules are keyed to the @civitasone/tenant-profile catalogue, never forked on
 * an edition / profile STRING. This scans service + app + package sources OUTSIDE packages/tenant-profile for
 * `edition ===`, `profile ===`, `profile_code ===` / `profileCode ===` string comparisons (and !==, ==, !=, and the
 * reversed `"x" === edition` form).
 *
 * Known remaining forks are listed in ALLOWED below, each with the slice that removes it. The test fails on (a) any
 * NEW fork and (b) any allowlist entry that no longer matches (so fixing a fork forces removing its entry).
 * Pure filesystem scan: no DB, no network.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SCAN_DIRS = ["services", "apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "tests", "__tests__", "e2e", "scratch"]);
const SKIP_PREFIX = ["packages/tenant-profile/"];

const IDENT = String.raw`(?:edition|profile|profile_code|profileCode)`;
const LIT = String.raw`["'\`][^"'\`]*["'\`]`;
const OP = String.raw`[!=]==?`;
export const FORK_RE = new RegExp(
  String.raw`(?:(?<!typeof\s+(?:[\w$?]+\.)*)\b${IDENT}\b\??\s*${OP}\s*${LIT})|(?:${LIT}\s*${OP}\s*[\w.?]*\b${IDENT}\b)`,
);

/**
 * path -> why it is allowed. `slice` says which future slice removes the entry; "permanent" means the identifier is
 * NOT the tenant profile/edition (a different concept sharing the name) and the entry is never removed.
 */
export const ALLOWED: Record<string, { slice: string; why: string }> = {
  "services/hrms-service/src/modules/recruitment/edition-policy.ts": { slice: "B6", why: "policy.edition === 'govt' -> catalogue recruitmentPolicy" },
  "services/gateway-service/src/screen-manifest.ts": { slice: "B6", why: "edition === 'small_office' -> catalogue manifestKey (also the small_office=MSME naming trap)" },
  "services/payroll-service/src/modules/pay-profiles/plan.ts": { slice: "B6", why: "pay-profile plan; confirm/rename in B6 (payroll plan.ts)" },
  "services/hrms-service/src/modules/pay-profile/domain.ts": { slice: "permanent", why: "pay profile (govt_scale / ctc_contract ...), not a tenant profile" },
  "services/payroll-service/src/modules/ctc/runtime.ts": { slice: "permanent", why: "pay profile, not a tenant profile" },
  "services/payroll-service/src/modules/integration/consumer.ts": { slice: "permanent", why: "pay profile, not a tenant profile" },
  "services/payroll-service/src/modules/pay-profiles/reports.ts": { slice: "permanent", why: "pay profile, not a tenant profile" },
  "services/payroll-service/src/modules/tax/consumer.ts": { slice: "permanent", why: "pay profile, not a tenant profile" },
};

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; } // dangling symlink: skip the entry, never the whole tree
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.(test|spec|d)\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
}

export function scan(root: string = ROOT, dirs: string[] = SCAN_DIRS): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const d of dirs) {
    let files: string[] = [];
    if (!existsSync(join(root, d))) continue;
    walk(join(root, d), files);
    for (const f of files) {
      const rel = relative(root, f).split(sep).join("/");
      if (SKIP_PREFIX.some((p) => rel.startsWith(p))) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/^\s*(\*|\/\*)/.test(line)) return; // doc comment
        if (FORK_RE.test(code)) hits.set(rel, [...(hits.get(rel) ?? []), `${i + 1}: ${line.trim()}`]);
      });
    }
  }
  return hits;
}

describe("no edition / profile string forks outside packages/tenant-profile", () => {
  it("every fork is in the documented allowlist (add to the catalogue, not to ALLOWED)", () => {
    const hits = scan();
    const unexpected = [...hits.entries()].filter(([f]) => !(f in ALLOWED)).map(([f, l]) => `${f}\n    ${l.join("\n    ")}`);
    expect(unexpected, "new edition/profile string comparison; key the rule to a PROFILES field instead").toEqual([]);
  });

  it("no stale allowlist entries (a fixed fork must be removed from ALLOWED)", () => {
    const hits = scan();
    const stale = Object.keys(ALLOWED).filter((f) => !hits.has(f));
    expect(stale).toEqual([]);
  });

  it("every allowlist entry names the slice that removes it", () => {
    for (const [f, e] of Object.entries(ALLOWED)) {
      expect(e.slice, f).toMatch(/^(B\d+|permanent)$/);
      expect(e.why.length, f).toBeGreaterThan(5);
    }
  });

  it("the detector catches a planted fork (forward and reversed) and ignores catalogue-style code", () => {
    for (const bad of [
      `if (edition === "govt") x();`, `if (tenant.edition !== 'psu') x();`, `if (profile == "section8") x();`,
      "return profileCode === `small_office`;", `if (p.profile_code === "psu") x();`, `if ("govt" === edition) x();`,
    ]) expect(FORK_RE.test(bad), bad).toBe(true);
    for (const ok of [
      `if (getProfile(code)?.composeOnOnboard) x();`, `const e = edition ?? "govt";`, `if (edition === other) x();`,
      `if (profileCodes.includes(edition)) x();`,
      `return typeof body.edition === "string" && body.edition.length > 0;`,
    ]) expect(FORK_RE.test(ok), ok).toBe(false);
  });

  it("scan() finds a fork planted in a temp tree outside the package", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const root = mkdtempSync(join(tmpdir(), "forkscan-"));
    try {
      mkdirSync(join(root, "services", "x", "src"), { recursive: true });
      mkdirSync(join(root, "packages", "tenant-profile", "src"), { recursive: true });
      writeFileSync(join(root, "services", "x", "src", "a.ts"), `export const f = (edition: string) => edition === "govt";\n`);
      writeFileSync(join(root, "packages", "tenant-profile", "src", "i.ts"), `export const g = (edition: string) => edition === "govt";\n`);
      const hits = scan(root, SCAN_DIRS);
      expect([...hits.keys()]).toEqual(["services/x/src/a.ts"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
