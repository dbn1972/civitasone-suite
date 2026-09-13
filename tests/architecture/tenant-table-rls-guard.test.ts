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

describe("tenant-table-rls-guard: SEC-022 — ALTER TABLE ... ADD COLUMN tenant_id", () => {
  it("flags a table CREATEd without tenant_id that is later ALTERed in the SAME file to add tenant_id, with no RLS anywhere (the SEC-022 blind spot)", () => {
    const sql = `
      CREATE TABLE billing.subscriptions (
        id uuid PRIMARY KEY,
        plan_code varchar(64) NOT NULL
      );
      ALTER TABLE billing.subscriptions ADD COLUMN tenant_id uuid;
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("billing.subscriptions");
    expect(violations[0].missing).toEqual([
      "ENABLE ROW LEVEL SECURITY",
      "FORCE ROW LEVEL SECURITY",
      "CREATE POLICY",
    ]);
  });

  it("flags the same shape across TWO files when the caller threads knownTables between them (cross-file blind spot), resolving the bare ALTER reference back to the CREATE's qualified name", () => {
    const knownTables = new Map();
    const fileA_createOnly = `
      CREATE TABLE billing.legacy_accounts (
        id uuid PRIMARY KEY,
        name varchar(200) NOT NULL
      );
    `;
    const fileB_alterOnlyLater = `
      ALTER TABLE legacy_accounts ADD COLUMN tenant_id uuid;
    `;
    expect(findTenantTableViolations(fileA_createOnly, knownTables)).toHaveLength(0);
    const violations = findTenantTableViolations(fileB_alterOnlyLater, knownTables);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("billing.legacy_accounts");
    expect(violations[0].missing).toEqual([
      "ENABLE ROW LEVEL SECURITY",
      "FORCE ROW LEVEL SECURITY",
      "CREATE POLICY",
    ]);
  });

  it("does not flag ALTER TABLE ... ADD COLUMN tenant_id when the guard has no CREATE TABLE record for that table anywhere (avoids false positives on tables outside its knowledge)", () => {
    const sql = `
      ALTER TABLE some_unknown_schema.mystery_table ADD COLUMN tenant_id uuid;
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("passes the SEC-022 shape when ENABLE + FORCE + CREATE POLICY are added in the same file as the ALTER (mirrors the two real fleet migrations found while fixing this: admin-service 0014_webhook_lifecycle.sql, payroll-service 0039_tax_slab_config_tenant_scope.sql)", () => {
    const sql = `
      CREATE TABLE webhooks.webhook_deliveries (
        id uuid PRIMARY KEY,
        webhook_id uuid NOT NULL
      );
      ALTER TABLE webhooks.webhook_deliveries ADD COLUMN IF NOT EXISTS tenant_id uuid;
      ALTER TABLE webhooks.webhook_deliveries ENABLE ROW LEVEL SECURITY;
      ALTER TABLE webhooks.webhook_deliveries FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_policy ON webhooks.webhook_deliveries
        USING (tenant_id = current_tenant_id());
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("does not false-positive on ADD COLUMN parent_tenant_id via ALTER (mirrors the CREATE TABLE guard's same whole-column-name rule)", () => {
    const sql = `
      CREATE TABLE org.branches (
        id uuid PRIMARY KEY
      );
      ALTER TABLE org.branches ADD COLUMN parent_tenant_id uuid;
    `;
    expect(findTenantTableViolations(sql)).toHaveLength(0);
  });

  it("finds tenant_id among multiple comma-separated ADD COLUMN clauses in one ALTER statement (the payroll-service 0039 shape)", () => {
    const sql = `
      CREATE TABLE payroll.tax_slab_config (
        id uuid PRIMARY KEY,
        fy_start_year integer NOT NULL
      );
      ALTER TABLE payroll.tax_slab_config
        ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        ADD COLUMN IF NOT EXISTS created_by UUID;
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("payroll.tax_slab_config");
  });

  it("also catches the bare `ADD tenant_id` form (COLUMN is optional in Postgres' own grammar)", () => {
    const sql = `
      CREATE TABLE crm.leads (
        id uuid PRIMARY KEY
      );
      ALTER TABLE crm.leads ADD tenant_id uuid;
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("crm.leads");
  });

  it("does not double-count a redundant `ADD COLUMN IF NOT EXISTS tenant_id` when the CREATE TABLE itself already has tenant_id and is already flagged", () => {
    const sql = `
      CREATE TABLE hr.timesheets (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
      ALTER TABLE hr.timesheets ADD COLUMN IF NOT EXISTS tenant_id uuid;
    `;
    const violations = findTenantTableViolations(sql);
    expect(violations).toHaveLength(1);
    expect(violations[0].table).toBe("hr.timesheets");
  });
});
