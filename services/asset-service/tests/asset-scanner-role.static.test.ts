/**
 * Static regression: asset-service migration 0026 must create the
 * asset_scanner BYPASSRLS role the depreciation scheduler's cross-tenant
 * scan (repo.findDueTenantPeriods, via src/shared/scanner-db.ts) depends on
 * -- and must NOT widen its grants beyond the one table that scan reads.
 * Mirrors payroll-service's tests/outbox-inbox-rls.static.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");

describe("asset scanner role migration 0026", () => {
  const sql = readFileSync(join(migDir, "0026_asset_scanner_role.sql"), "utf8");

  it("creates a BYPASSRLS asset_scanner role, idempotently", () => {
    expect(sql).toContain("asset_scanner");
    expect(sql).toContain("BYPASSRLS");
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'asset_scanner'\)/);
  });

  it("does not ship a password literal (SEC-P1-09)", () => {
    expect(sql).not.toMatch(/PASSWORD\s+'[^%'][^']*'/);
    expect(sql).toContain("civitas.asset_scanner_password");
  });

  it("grants SELECT on depreciation.asset_dep_entries -- the only table findDueTenantPeriods() reads", () => {
    expect(sql).toMatch(/GRANT SELECT ON depreciation\.asset_dep_entries TO asset_scanner/);
    expect(sql).toContain("GRANT USAGE ON SCHEMA depreciation TO asset_scanner");
  });

  it("does not grant access to asset_dep_schedules or any other schema (least privilege)", () => {
    expect(sql).not.toMatch(/asset_dep_schedules[^\n]*asset_scanner/);
    expect(sql).not.toMatch(/asset_scanner[^\n]*asset_dep_schedules/);
    for (const otherSchema of ["register", "lifecycle", "maintenance", "insurance", "enterprise", "_outbox", "_inbox"]) {
      expect(sql).not.toMatch(new RegExp(`GRANT[^;]*SCHEMA ${otherSchema}[^;]*asset_scanner`));
    }
  });

  it("is read-only: no INSERT/UPDATE/DELETE grant to asset_scanner anywhere", () => {
    expect(sql).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*asset_scanner/);
  });

  it("grants CONNECT on the current database (L1 DB-per-service isolation may revoke PUBLIC CONNECT)", () => {
    expect(sql).toMatch(/GRANT CONNECT ON DATABASE %I TO asset_scanner/);
  });
});
