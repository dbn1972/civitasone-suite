/**
 * Static regression: contract-service migration 0016 must enable RLS on
 * `_outbox.messages` (and `_inbox.processed` when tenant_id exists),
 * guarded by table-owner checks. Mirrors works-service 0013 / visitor-service
 * 0013. Outbox may already be covered by 0003/0004/0006 — 0016 re-applies
 * idempotently. Migration 0015 must create the contract_scanner BYPASSRLS role.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("contract outbox/inbox RLS migration 0016", () => {
  const sql = readFileSync(join(migDir, "0016_outbox_inbox_rls.sql"), "utf8");

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

  it("notes idempotency with earlier outbox RLS migrations", () => {
    expect(sql).toMatch(/0003|0004|0006/);
  });

  it("skips inbox RLS when tenant_id column is absent (contract _inbox.processed has none)", () => {
    expect(sql).toContain("no tenant_id column");
    expect(sql).toMatch(/information_schema\.columns/);
  });
});

describe("contract scanner role migration 0015", () => {
  const sql = readFileSync(join(migDir, "0015_contract_scanner_role.sql"), "utf8");

  it("creates a BYPASSRLS contract_scanner role, idempotently", () => {
    expect(sql).toContain("contract_scanner");
    expect(sql).toContain("BYPASSRLS");
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'contract_scanner'\)/);
  });

  it("does not ship a password literal (SEC-P1-09)", () => {
    expect(sql).not.toMatch(/PASSWORD\s+'[^%'][^']*'/);
    expect(sql).toContain("civitas.contract_scanner_password");
  });

  it("grants the outbox/inbox privileges startRelay + startOutboxPurge need", () => {
    expect(sql).toMatch(/GRANT[^;]*_outbox\.messages[^;]*contract_scanner/s);
    expect(sql).toMatch(/GRANT[^;]*_inbox\.processed[^;]*contract_scanner/s);
  });
});
