/**
 * GAP2-PLATFORM-MIGRATIONS-DUP-01 — migration-number uniqueness regression lock.
 *
 * The migration runners (scripts/dev/migrate-all.mjs and
 * scripts/ci/bootstrap-postgres.sh) apply each service's migrations in
 * lexicographic full-filename order with NO applied-ledger keyed on the
 * numeric prefix. Two DISTINCT non-suffixed `.sql` files that share a numeric
 * prefix therefore have only an implicit apply order, and any number-keyed
 * migrator (Drizzle's own, or prod tooling) would treat them as one entry and
 * silently skip the second. The fix renumbers the second colliding file with
 * the established `<nnnn>b` suffix so numbering stays strictly unambiguous.
 *
 * This test fails on the pre-fix tree (14 colliding numbers across admin,
 * audit, finance, helpdesk, hrms, notification, payroll, procurement,
 * workflow) and passes once each collision carries a disambiguating suffix.
 *
 * A `<nnnn>b`-style suffixed file is NOT a collision: the suffix is exactly the
 * mechanism the runners rely on to keep order deterministic (see
 * scripts/ci/bootstrap-postgres.sh's header comment).
 *
 * CI: runs under the Architecture Guard job alongside migrate-all-inventory.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const SERVICES_DIR = join(ROOT, "services");

/** The numeric prefix of a migration filename, or null if it has none. */
function numericPrefix(file: string): string | null {
  const m = file.match(/^(\d+)/);
  return m ? m[1]! : null;
}

/** True when the filename has a non-numeric disambiguating suffix after the digits (e.g. `0055b_...`). */
function hasAlphaSuffix(file: string): boolean {
  // `0055b_foo.sql` → the char right after the leading digits is a letter.
  return /^\d+[a-zA-Z]/.test(file);
}

function migrationServices(): string[] {
  return readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service"))
    .filter((d) => existsSync(join(SERVICES_DIR, d, "migrations")))
    .sort();
}

describe("GAP2-PLATFORM-MIGRATIONS-DUP-01: migration numbering is unambiguous", () => {
  for (const svc of migrationServices()) {
    it(`${svc}: no two non-suffixed migrations share a numeric prefix`, () => {
      const migDir = join(SERVICES_DIR, svc, "migrations");
      const files = readdirSync(migDir).filter((f) => f.endsWith(".sql"));

      // Only plain `<nnnn>_...` (no alpha suffix) files participate in the
      // collision check — a `<nnnn>b_...` file is the deliberate resolution.
      const byPrefix = new Map<string, string[]>();
      for (const f of files) {
        if (hasAlphaSuffix(f)) continue;
        const p = numericPrefix(f);
        if (!p) continue;
        const list = byPrefix.get(p) ?? [];
        list.push(f);
        byPrefix.set(p, list);
      }

      const collisions = [...byPrefix.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([p, list]) => `${p}: ${list.sort().join(", ")}`);

      expect(collisions, `duplicate non-suffixed migration numbers in ${svc}`).toEqual([]);
    });
  }
});
