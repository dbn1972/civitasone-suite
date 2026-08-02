/**
 * Static regression: inspection-service migration 0023 must enable RLS on
 * `_outbox.messages` (and `_inbox.processed` when tenant_id exists),
 * guarded by table-owner checks. Migration 0022 must create inspection_scanner.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("inspection outbox/inbox RLS migration 0023", () => {
  const sql = readFileSync(join(migDir, "0023_outbox_inbox_rls.sql"), "utf8");

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
    expect(sql).toMatch(/information_schema\.columns/);
  });
});

describe("inspection scanner role migration 0022", () => {
  const sql = readFileSync(join(migDir, "0022_inspection_scanner_role.sql"), "utf8");

  it("creates a BYPASSRLS inspection_scanner role, idempotently", () => {
    expect(sql).toContain("inspection_scanner");
    expect(sql).toContain("BYPASSRLS");
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'inspection_scanner'\)/);
  });

  it("does not ship a password literal (SEC-P1-09)", () => {
    expect(sql).not.toMatch(/PASSWORD\s+'[^%'][^']*'/);
    expect(sql).toContain("civitas.inspection_scanner_password");
  });

  it("grants the outbox/inbox privileges startRelay + startOutboxPurge need", () => {
    expect(sql).toMatch(/GRANT[^;]*_outbox\.messages[^;]*inspection_scanner/s);
    expect(sql).toMatch(/GRANT[^;]*_inbox\.processed[^;]*inspection_scanner/s);
  });
});
