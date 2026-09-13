/**
 * tenant-table-rls-guard.mjs — fixture-based unit tests (SEC-010).
 *
 * Exercises the exported `findTenantTableViolations()` directly against
 * in-memory migration-text strings, mirroring
 * tests/architecture/raw-status-leak-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/tenant-table-rls-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { findTenantTableViolations } from "../../scripts/ci/tenant-table-rls-guard.mjs";

describe("tenant-table-rls-guard: findTenantTableViolations()", () => {
  it("flags a tenant_id table created with no RLS at all (the SEC-010 exemplar defect)", () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS admin.reconciliation_breaks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        break_type varchar(32) NOT NULL
      );
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("admin.reconciliation_breaks");
    expect(violations[0].missing).toEqual([
      "ENABLE ROW LEVEL SECURITY",
      "FORCE ROW LEVEL SECURITY",
      "CREATE POLICY",
    ]);
  });

  it("passes a tenant_id table that carries ENABLE + FORCE + CREATE POLICY in the same file", () => {
    const sql = `
      CREATE TABLE workflow.dmn_tables (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name varchar(200) NOT NULL
      );
      ALTER TABLE workflow.dmn_tables ENABLE ROW LEVEL SECURITY;
      ALTER TABLE workflow.dmn_tables FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_policy ON workflow.dmn_tables
        USING (tenant_id = workflow.current_tenant_id())
        WITH CHECK (tenant_id = workflow.current_tenant_id());
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("flags the SEC-009 half-fix shape: ENABLE without FORCE", () => {
    const sql = `
      CREATE TABLE learning.training_plans (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
      ALTER TABLE learning.training_plans ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON learning.training_plans
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].missing).toEqual(["FORCE ROW LEVEL SECURITY"]);
  });

  it("does not flag a table with no tenant_id column", () => {
    const sql = `
      CREATE TABLE app_config.feature_toggles (
        id uuid PRIMARY KEY,
        toggle_key varchar(64) NOT NULL
      );
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("does not false-positive on a column that merely ends in tenant_id (e.g. parent_tenant_id)", () => {
    const sql = `
      CREATE TABLE org.sub_units (
        id uuid PRIMARY KEY,
        parent_tenant_id uuid
      );
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("ignores RLS language that only appears in a SQL comment (doc-comments must not count as real RLS)", () => {
    const sql = `
      -- TODO: ALTER TABLE billing.invoices ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;
      -- CREATE POLICY tenant_isolation_policy ON billing.invoices ...
      CREATE TABLE billing.invoices (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("billing.invoices");
  });

  it("matches a bare (unqualified) ALTER/POLICY reference against a schema-qualified CREATE TABLE", () => {
    const sql = `
      CREATE TABLE employee.integrations (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
      ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_policy ON integrations
        USING (tenant_id = employee.current_tenant_id());
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("correctly walks nested parens in the column list (varchar(n), CHECK(...)) without truncating early", () => {
    const sql = `
      CREATE TABLE employee.integrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        type varchar(32) NOT NULL CHECK (type IN ('a','b')),
        status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
      );
    `;
    // No RLS anywhere -- must still correctly detect the tenant_id column
    // despite multiple nested parens in the body, i.e. must NOT stop at the
    // first `)` (gen_random_uuid()'s).
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("employee.integrations");
  });

  it("reports one violation per non-compliant table when a file creates several", () => {
    const sql = `
      CREATE TABLE admin.reconciliation_results (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL
      );
      CREATE TABLE admin.reconciliation_breaks (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL
      );
      ALTER TABLE admin.reconciliation_results ENABLE ROW LEVEL SECURITY;
      ALTER TABLE admin.reconciliation_results FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_policy ON admin.reconciliation_results
        USING (tenant_id = current_tenant_id());
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("admin.reconciliation_breaks");
  });
});
