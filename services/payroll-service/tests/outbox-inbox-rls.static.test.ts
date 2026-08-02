/**
 * Static regression: payroll-service migration 0033 must (re-)apply RLS to
 * `_outbox.messages` (and `_inbox.processed` only if it has tenant_id),
 * guarded by table-owner checks — and 0032 must create the payroll_scanner
 * BYPASSRLS role the relay/purge depend on. Mirrors works-service 0013/0012.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("payroll outbox/inbox RLS migration 0033", () => {
  const sql = readFileSync(join(migDir, "0033_outbox_inbox_rls.sql"), "utf8");

  it("targets _outbox.messages and _inbox.processed", () => {
    expect(sql).toContain("_outbox.messages");
    expect(sql).toContain("_inbox.processed");
  });

  it("enables + forces row level security", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("creates a tenant_isolation_policy scoped to payroll.current_tenant_id()", () => {
    expect(sql).toContain("tenant_isolation_policy");
    expect(sql).toContain("payroll.current_tenant_id()");
  });

  it("guards the RLS grant behind a table-owner check (safe no-op otherwise)", () => {
    expect(sql).toMatch(/tableowner\s*=\s*current_user/);
  });

  it("no-ops when the table doesn't exist yet", () => {
    expect(sql).toContain("to_regclass('_outbox.messages') IS NULL");
    expect(sql).toContain("to_regclass('_inbox.processed') IS NULL");
  });

  it("skips inbox RLS when tenant_id column is absent (payroll _inbox.processed has none)", () => {
    expect(sql).toMatch(/no tenant_id column/);
    expect(sql).toMatch(/information_schema\.columns/);
  });
});

describe("payroll scanner role migration 0032", () => {
  const sql = readFileSync(join(migDir, "0032_payroll_scanner_role.sql"), "utf8");

  it("creates a BYPASSRLS payroll_scanner role, idempotently", () => {
    expect(sql).toContain("payroll_scanner");
    expect(sql).toContain("BYPASSRLS");
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'payroll_scanner'\)/);
  });

  it("does not ship a password literal (SEC-P1-09)", () => {
    expect(sql).not.toMatch(/PASSWORD\s+'[^%'][^']*'/);
    expect(sql).toContain("civitas.payroll_scanner_password");
  });

  it("grants the outbox/inbox privileges startRelay + startOutboxPurge need", () => {
    expect(sql).toMatch(/GRANT[^;]*_outbox\.messages[^;]*payroll_scanner/s);
    expect(sql).toMatch(/GRANT[^;]*_inbox\.processed[^;]*payroll_scanner/s);
  });
});
