/**
 * Static regression: works-service migration 0013 must enable RLS on
 * `_outbox.messages` (and `_inbox.processed` when tenant_id exists),
 * guarded by table-owner checks. Mirrors visitor-service 0013 / court-service
 * 0015. Outbox may already be covered by 0011 — 0013 re-applies idempotently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("works outbox/inbox RLS migration 0013", () => {
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

  it("notes idempotency with 0011 outbox migration", () => {
    expect(sql).toContain("0011_outbox_rls_if_owner.sql");
  });

  it("skips inbox RLS when tenant_id column is absent (works _inbox.processed has none)", () => {
    expect(sql).toContain("no tenant_id column");
    expect(sql).toMatch(/information_schema\.columns/);
  });
});

describe("works scanner role migration 0012", () => {
  const sql = readFileSync(join(migDir, "0012_works_scanner_role.sql"), "utf8");

  it("creates a BYPASSRLS works_scanner role, idempotently", () => {
    expect(sql).toContain("works_scanner");
    expect(sql).toContain("BYPASSRLS");
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'works_scanner'\)/);
  });

  it("does not ship a password literal (SEC-P1-09)", () => {
    expect(sql).not.toMatch(/PASSWORD\s+'[^%'][^']*'/);
    expect(sql).toContain("civitas.works_scanner_password");
  });

  it("grants the outbox/inbox privileges startRelay + startOutboxPurge need", () => {
    expect(sql).toMatch(/GRANT[^;]*_outbox\.messages[^;]*works_scanner/s);
    expect(sql).toMatch(/GRANT[^;]*_inbox\.processed[^;]*works_scanner/s);
  });
});
