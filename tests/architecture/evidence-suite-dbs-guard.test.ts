/**
 * evidence-suite-dbs-guard.mjs — fixture-based unit tests (PERF-022).
 *
 * Exercises the exported `parseEvidenceSuiteDbs()` directly against
 * in-memory bootstrap-postgres.sh-shaped text, mirroring
 * tests/architecture/tenant-table-rls-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/evidence-suite-dbs-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { parseEvidenceSuiteDbs, REQUIRED_ENTRIES } from "../../scripts/ci/evidence-suite-dbs-guard.mjs";

// A faithful fixture of scripts/ci/bootstrap-postgres.sh's real
// EVIDENCE_SUITE_DBS block: the PERF-020 comment interrupting the array
// partway through (the real shape this parser has to handle), and the
// `for entry in "${EVIDENCE_SUITE_DBS[@]}"` loop that follows it in the real
// file (proves the parser stops at the closing `)` rather than reading on).
const FULL_FIXTURE = `
some earlier script content
that must be ignored
EVIDENCE_SUITE_DBS=(
  "asset-service:civitas_asset:asset_svc"
  "inventory-service:civitas_inventory:inventory_svc"
  "hrms-service:civitas_hrms:hrms_svc"
  "payroll-service:civitas_payroll:payroll_svc"
  "procurement-service:civitas_procurement:procurement_svc"
  "contract-service:civitas_contract:contract_svc"
  "finance-service:civitas_finance:finance_svc"
  # PERF-020: bootstrap.generated.sql's REVOKE ALL ON DATABASE ... FROM
  # PUBLIC hardening actually covers all 8 foundational-service databases —
  # these 6 were simply never added here originally.
  "tenant-service:civitas_tenant:tenant_svc"
  "identity-service:civitas_identity:identity_svc"
  "policy-service:civitas_policy:policy_svc"
  "audit-service:civitas_audit:audit_svc"
  "notification-service:civitas_notification:notification_svc"
  "billing-service:civitas_billing:billing_svc"
)
for entry in "\${EVIDENCE_SUITE_DBS[@]}"; do
  IFS=: read -r svc db role <<< "$entry"
done
`;

describe("evidence-suite-dbs-guard: parseEvidenceSuiteDbs()", () => {
  it("parses all 13 entries from a realistic fixture, including the comment-interrupted block", () => {
    const entries = parseEvidenceSuiteDbs(FULL_FIXTURE);
    expect(entries).toHaveLength(13);
    expect(entries).toContain("notification-service:civitas_notification:notification_svc");
    expect(entries).toContain("finance-service:civitas_finance:finance_svc");
  });

  it("stops at the closing paren and does not pick up the trailing for-loop", () => {
    const entries = parseEvidenceSuiteDbs(FULL_FIXTURE);
    expect(entries.some((e) => e.includes("entry"))).toBe(false);
  });

  it("ignores blank lines inside the array", () => {
    const fixture = `
EVIDENCE_SUITE_DBS=(
  "a-service:civitas_a:a_svc"

  "b-service:civitas_b:b_svc"
)
`;
    expect(parseEvidenceSuiteDbs(fixture)).toEqual(["a-service:civitas_a:a_svc", "b-service:civitas_b:b_svc"]);
  });

  it("throws when no EVIDENCE_SUITE_DBS array is present at all", () => {
    expect(() => parseEvidenceSuiteDbs("#!/usr/bin/env bash\necho hello\n")).toThrow();
  });

  it("REQUIRED_ENTRIES currently has 13 entries — the guard's own known-good floor", () => {
    expect(REQUIRED_ENTRIES).toHaveLength(13);
  });
});

describe("evidence-suite-dbs-guard: the PERF-022 regression shape", () => {
  it("flags nothing missing when the full fixture matches REQUIRED_ENTRIES", () => {
    const current = new Set(parseEvidenceSuiteDbs(FULL_FIXTURE));
    const missing = REQUIRED_ENTRIES.filter((e) => !current.has(e));
    expect(missing).toEqual([]);
  });

  it("PERF-022's own repro shape: deleting one EVIDENCE_SUITE_DBS entry (notification-service) is detected as missing", () => {
    const sabotaged = FULL_FIXTURE.replace('  "notification-service:civitas_notification:notification_svc"\n', "");
    // Confirm the sabotage actually removed it, so this test can't pass for
    // the wrong reason (a no-op replace leaving all 13 entries untouched).
    const current = new Set(parseEvidenceSuiteDbs(sabotaged));
    expect(current.has("notification-service:civitas_notification:notification_svc")).toBe(false);
    expect(current.size).toBe(12);

    const missing = REQUIRED_ENTRIES.filter((e) => !current.has(e));
    expect(missing).toEqual(["notification-service:civitas_notification:notification_svc"]);
  });

  it("detects removal of any one of the 13 required entries, not just notification-service", () => {
    for (const victim of REQUIRED_ENTRIES) {
      const sabotaged = FULL_FIXTURE.replace(`  "${victim}"\n`, "");
      const current = new Set(parseEvidenceSuiteDbs(sabotaged));
      const missing = REQUIRED_ENTRIES.filter((e) => !current.has(e));
      expect(missing).toEqual([victim]);
    }
  });
});
