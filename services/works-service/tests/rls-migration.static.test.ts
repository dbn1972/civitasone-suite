/**
 * Static regression: works RLS migration must cover every works.* table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("works RLS migration 0010", () => {
  it("enables FORCE RLS + tenant_isolation_policy for all works.* tables", () => {
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql") && !f.startsWith("0010"));
    const tables = new Set<string>();
    for (const f of files) {
      const sql = readFileSync(join(migDir, f), "utf8");
      for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (works\.[a-z0-9_]+)/g)) {
        tables.add(m[1]);
      }
    }
    expect(tables.size).toBeGreaterThan(10);
    const rls = readFileSync(join(migDir, "0010_rls_tenant_isolation.sql"), "utf8");
    expect(rls).toContain("FORCE ROW LEVEL SECURITY");
    expect(rls).toContain("tenant_isolation_policy");
    expect(rls).toContain("_outbox.messages");
    for (const t of tables) {
      expect(rls).toContain(`'${t}'`);
    }
  });
});
