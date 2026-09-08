/**
 * REL-019 regression test — the production readiness score must not be able
 * to report 100/100 while the real product has known, confirmed integrity
 * gaps.
 *
 * Before this fix, `scripts/production-readiness-score.mjs` had no way to
 * see three real classes of defect documented in
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md:
 *   - COMP-001 / COMP-002: `admin-service` and `citizen-service` "gap"
 *     modules registering routes that return fabricated success responses
 *     (hardcoded/empty payloads or `randomUUID()`) with no persistence.
 *   - COMP-003: `document-service` is routed by the gateway and consumed by
 *     web pages but has no `migrations/` directory at all.
 *   - REL-006: `field-service` and `recommendation-service` have real
 *     migrations that are never provisioned in CI (absent from both
 *     `SERVICE_DBS` and `ADMIN_OWNED_DBS` in
 *     scripts/ci/bootstrap-postgres.sh).
 *
 * This test runs the actual script against the actual repo (not a mock) and
 * asserts it (a) reports these exact, currently-real findings, and (b)
 * therefore cannot claim PRODUCTION_READY while they exist. It is
 * intentionally a "ratchet against reality" test, not a fixture test: as
 * each underlying gap closes, the corresponding assertion here should be
 * updated (or the finding will simply stop appearing and the score will
 * rise) — this test's job is to make sure that happens because the gap was
 * actually fixed, not because the check was quietly weakened.
 *
 * Sabotage-checked: reverting scripts/production-readiness-score.mjs to its
 * pre-REL-019 form (git stash) and re-running this test fails it exactly as
 * expected — "PRODUCTION_READY: true" / no stub-route or provisioning
 * findings at all — confirming the test actually exercises the new checks
 * rather than passing vacuously. See the REL-019 PR description for the
 * before/after transcript.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");

function runScore(): string {
  return execSync("node scripts/production-readiness-score.mjs", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

describe("production-readiness-score.mjs (REL-019)", () => {
  const output = runScore();

  it("does not report 100/100 while known integrity gaps exist", () => {
    expect(output).not.toMatch(/\*\*Overall: 100\/100\*\*/);
    expect(output).toMatch(/PRODUCTION_READY: false/);
  });

  it("detects the COMP-001 admin-service fabricated-response stub routes", () => {
    expect(output).toMatch(/services\/admin-service\/src\/modules\/gap\/routes\.ts/);
    // COMP-001 names 21 fabricated admin routes; the heuristic should catch
    // at least the large majority of them under high-confidence findings.
    const adminMatches = output.match(/admin-service\/src\/modules\/gap\/routes\.ts/g) ?? [];
    expect(adminMatches.length).toBeGreaterThanOrEqual(18);
  });

  it("detects the COMP-002 citizen-service fabricated-response stub routes", () => {
    expect(output).toMatch(/services\/citizen-service\/src\/modules\/gap\/routes\.ts/);
    const citizenMatches = output.match(/citizen-service\/src\/modules\/gap\/routes\.ts/g) ?? [];
    expect(citizenMatches.length).toBeGreaterThanOrEqual(6);
  });

  it("detects the COMP-003 document-service zero-migration shell", () => {
    expect(output).toMatch(/NO migrations\/ directory[\s\S]*?- document-service/);
  });

  it("detects the REL-006 unprovisioned field-service and recommendation-service", () => {
    expect(output).toMatch(/not provisioned in CI[\s\S]*?- field-service/);
    expect(output).toMatch(/not provisioned in CI[\s\S]*?- recommendation-service/);
  });

  it("flags stale release evidence (REL-004 dependency)", () => {
    // Documented dependency: once REL-004 lands and CI writes fresh evidence
    // on every run, this assertion should be revisited — it currently
    // reflects the real, 40+ day old evidence/20260727/ directory on main.
    expect(output).toMatch(/Evidence freshness: newest evidence dir is evidence\/\d{8}\/ \((\d+) days old/);
  });
});
