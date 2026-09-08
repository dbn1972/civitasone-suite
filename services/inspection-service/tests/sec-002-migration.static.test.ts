/**
 * Static regression: inspection-service migration 0029 must ENABLE + FORCE
 * row level security and create a `tenant_isolation` policy on every one of
 * the 21 tables identified in SEC-002 as having zero RLS. Fast, no DB
 * required — complements sec-002-rls-isolation.test.ts, which proves this
 * live against Postgres.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migDir = join(__dirname, "../migrations");
const sql = readFileSync(join(migDir, "0029_sec_002_rls_isolation.sql"), "utf8");

const TABLES = [
  "capa.corrective_actions",
  "enforcement.penalty_rates",
  "enforcement.show_cause_notices",
  "enforcement.penalty_orders",
  "enforcement.prosecution_referrals",
  "licence.licences",
  "licence.licence_conditions",
  "survey.survey_definitions",
  "survey.sampling_frames",
  "survey.survey_responses",
  "survey.survey_aggregations",
  "telemetry.devices",
  "telemetry.telemetry_readings",
  "telemetry.telemetry_alerts",
  "telemetry.alert_rules",
  "encroachment.encroachment_complaints",
  "encroachment.encroachment_notices",
  "encroachment.encroachment_hearings",
  "encroachment.encroachment_removals",
  "illegal_construction.illegal_construction_cases",
  "illegal_construction.illegal_construction_actions",
];

describe("inspection SEC-002 RLS migration 0029", () => {
  it.each(TABLES)("%s: ENABLE + FORCE ROW LEVEL SECURITY", (table) => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${table.replace(".", "\\.")} ENABLE ROW LEVEL SECURITY`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${table.replace(".", "\\.")} FORCE\\s+ROW LEVEL SECURITY`));
  });

  it.each(TABLES)("%s: has a tenant_isolation policy scoped to app.tenant_id", (table) => {
    const escaped = table.replace(".", "\\.");
    expect(sql).toMatch(new RegExp(`CREATE POLICY tenant_isolation ON ${escaped}`));
  });

  it("policy predicate is fail-closed (NULLIF + current_setting('app.tenant_id', true))", () => {
    expect(sql).toContain("NULLIF(current_setting('app.tenant_id', true), '')::uuid");
  });

  it("every policy is dropped before create, for idempotent re-runs", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
    }
  });

  it("does not touch reports.inspection_reports / reports.observations (SEC-009's scope, not SEC-002's)", () => {
    // The migration's header comment mentions these two tables in prose (to
    // explain why they're excluded); only assert no ALTER/POLICY statement
    // actually targets them.
    expect(sql).not.toMatch(/ALTER TABLE reports\.(inspection_reports|observations)/);
    expect(sql).not.toMatch(/CREATE POLICY \S+ ON reports\.(inspection_reports|observations)/);
  });
});
