/**
 * Static regression: every works.* table must have FORCE RLS + a
 * tenant_isolation policy, either centrally in 0010_rls_tenant_isolation.sql
 * (tables that existed at that point) or inline in the migration that
 * creates the table (tables added afterwards, e.g. 0015 contractors,
 * 0016 contractor_ratings, both of which set up FORCE RLS + a
 * "tenant_isolation" policy in the same file that CREATE TABLEs them).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("works RLS migration coverage", () => {
  it("enables FORCE RLS + a tenant_isolation policy for every works.* table", () => {
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql"));
    const tables = new Set<string>();
    const creatingFile = new Map<string, string>();
    for (const f of files) {
      const sql = readFileSync(join(migDir, f), "utf8");
      for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (works\.[a-z0-9_]+)/g)) {
        tables.add(m[1]);
        creatingFile.set(m[1], f);
      }
    }
    expect(tables.size).toBeGreaterThan(10);

    const rls0010 = readFileSync(join(migDir, "0010_rls_tenant_isolation.sql"), "utf8");
    expect(rls0010).toContain("FORCE ROW LEVEL SECURITY");
    expect(rls0010).toContain("tenant_isolation_policy");

    // outbox covered by 0011 when role owns table
    for (const t of tables) {
      const coveredIn0010 = rls0010.includes(`'${t}'`);
      const ownFile = creatingFile.get(t) as string;
      let coveredInline = false;
      if (!coveredIn0010 && ownFile !== "0010_rls_tenant_isolation.sql") {
        const ownSql = readFileSync(join(migDir, ownFile), "utf8");
        const escaped = t.replace(/\./g, "\\.");
        coveredInline =
          new RegExp(`ALTER TABLE ${escaped} FORCE ROW LEVEL SECURITY`).test(ownSql) &&
          new RegExp(`CREATE POLICY \\w+ ON ${escaped}`).test(ownSql);
      }
      expect(
        coveredIn0010 || coveredInline,
        `${t} must have FORCE RLS + a tenant_isolation policy, either in 0010_rls_tenant_isolation.sql or inline in ${ownFile} (the migration that creates it)`
      ).toBe(true);
    }
  });
});
