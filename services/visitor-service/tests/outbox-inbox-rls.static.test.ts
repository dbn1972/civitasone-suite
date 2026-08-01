/**
 * Static regression: visitor-service migration 0013 must enable RLS on
 * `_outbox.messages` (and `_inbox.processed` when tenant_id exists),
 * guarded by table-owner checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("visitor outbox/inbox RLS migration 0013", () => {
  const sql = readFileSync(join(migDir, "0013_outbox_inbox_rls.sql"), "utf8");

  it("targets _outbox.messages and _inbox.processed", () => {
    expect(sql).toContain("_outbox.messages");
    expect(sql).toContain("_inbox.processed");
  });

  it("enables + forces row level security", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("creates a tenant_isolation_policy scoped to app.tenant_id", () => {
    expect(sql).toContain("tenant_isolation_policy");
    expect(sql).toContain("current_setting('app.tenant_id'");
  });

  it("guards the RLS grant behind a table-owner check (safe no-op otherwise)", () => {
    expect(sql).toMatch(/tableowner\s*=\s*current_user/);
  });

  it("no-ops when the table doesn't exist yet", () => {
    expect(sql).toContain("to_regclass('_outbox.messages') IS NULL");
    expect(sql).toContain("to_regclass('_inbox.processed') IS NULL");
  });

  it("documents scannerDb relay requirement", () => {
    expect(sql.toLowerCase()).toMatch(/scanner/);
  });

  it("skips inbox RLS when tenant_id column is absent", () => {
    expect(sql).toContain("no tenant_id column");
  });
});
