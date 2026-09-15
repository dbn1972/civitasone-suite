/**
 * Migration rollback down-file regression lock (REL-020).
 *
 * Guards the two structural properties scripts/ops/MIGRATION-ROLLBACK.md
 * documents for the services/*-service/migrations/down/*.sql convention:
 *
 *   1. Every down-migration has a matching up-migration at the same
 *      basename one directory up (no orphaned rollback file for a migration
 *      that doesn't exist, or was renamed).
 *   2. The down/ directory itself is invisible to the fleet's forward
 *      migration tooling -- scripts/dev/migrate-all.mjs's
 *      readdirSync(...).filter(f => f.endsWith(".sql")) and
 *      scripts/ci/bootstrap-postgres.sh's `find -maxdepth 1 -name '*.sql'`
 *      must never see a down-migration as something to forward-apply. This
 *      is the exact footgun a `NNNN_name.down.sql` sibling (instead of a
 *      down/ subdirectory) would have created -- see MIGRATION-ROLLBACK.md's
 *      "Convention" section for the lexicographic-ordering argument.
 *
 * CI: Architecture Guard job (.github/workflows/ci.yml, "Ops regression
 *     locks" step) runs this alongside migrate-all-inventory.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const SERVICES_DIR = join(ROOT, "services");

/** Services with a migrations/down/ directory as of REL-020's initial rollout. */
const SERVICES_WITH_DOWN_MIGRATIONS = ["vendor-service", "animal-service", "identity-service"];

function serviceDirs(): string[] {
  return readdirSync(SERVICES_DIR).filter((d) => d.endsWith("-service"));
}

describe("migration rollback down-files (REL-020)", () => {
  it("REL-020's 3 demo services each carry at least one down-migration", () => {
    for (const svc of SERVICES_WITH_DOWN_MIGRATIONS) {
      const downDir = join(SERVICES_DIR, svc, "migrations", "down");
      expect(existsSync(downDir), `${svc} should have migrations/down/`).toBe(true);
      const files = readdirSync(downDir).filter((f) => f.endsWith(".sql"));
      expect(
        files.length,
        `${svc}/migrations/down/ should contain at least one .sql file`,
      ).toBeGreaterThan(0);
    }
  });

  it("every down-migration has a matching up-migration", () => {
    const orphans: string[] = [];
    for (const svc of serviceDirs()) {
      const downDir = join(SERVICES_DIR, svc, "migrations", "down");
      if (!existsSync(downDir)) continue;
      for (const f of readdirSync(downDir)) {
        if (!f.endsWith(".sql")) continue;
        const upFile = join(SERVICES_DIR, svc, "migrations", f);
        if (!existsSync(upFile)) {
          orphans.push(`${svc}/migrations/down/${f} has no matching ${svc}/migrations/${f}`);
        }
      }
    }
    expect(orphans, orphans.join("\n")).toEqual([]);
  });

  it("the down/ subdirectory convention is never confused with the rejected *.down.sql sibling convention", () => {
    for (const svc of serviceDirs()) {
      const migDir = join(SERVICES_DIR, svc, "migrations");
      if (!existsSync(migDir)) continue;

      // Mirrors migrate-all.mjs exactly: readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).
      // A non-recursive readdirSync of migrations/ can only ever surface the
      // bare "down" directory entry, never a path inside it -- so the real
      // risk isn't the down/ directory itself (which structurally can't
      // satisfy .endsWith(".sql")), it's someone instead naming a down-file
      // directly in migrations/ as `NNNN_name.down.sql` (the convention
      // MIGRATION-ROLLBACK.md's "Convention" section explicitly rejects,
      // because that form DOES end in .sql, so migrate-all.mjs and
      // bootstrap-postgres.sh would forward-apply it -- and, sorting before
      // its matching up-migration, apply it FIRST on a fresh bootstrap).
      const forwardCandidates = readdirSync(migDir).filter((f) => f.endsWith(".sql"));
      expect(forwardCandidates, `${svc}: "down" must never end in .sql`).not.toContain("down");

      const downDir = join(migDir, "down");
      if (existsSync(downDir)) {
        expect(statSync(downDir).isDirectory(), `${svc}: migrations/down must be a directory`).toBe(true);
      }

      const wrongConventionFiles = forwardCandidates.filter((f) => f.endsWith(".down.sql"));
      expect(
        wrongConventionFiles,
        `${svc}: found *.down.sql directly in migrations/ -- move to migrations/down/<same name> instead`,
      ).toEqual([]);
    }
  });
});
