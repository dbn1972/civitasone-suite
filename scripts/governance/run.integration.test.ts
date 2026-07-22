// scripts/governance/run.integration.test.ts
//
// Integration test (task 16.3) for the end-to-end orchestration script
// (`run.ts`, task 16.1/16.2). This is the one deliberately slower test in
// this module: it spawns `run.ts` as a real subprocess (via `tsx`, exactly
// as `pnpm governance:audit` does) against the real repository, rather than
// calling any exported function directly. Every other test file in this
// directory tests pure functions in-process; this file is the only place
// that exercises the actual CLI entrypoint end to end.
//
// It asserts two things, both empirically (not by trusting the
// implementation's own doc comments):
//
//   1. Running `tsx scripts/governance/run.ts --dry-run` does not modify any
//      governed source file — the 4 always-loaded steering documents, every
//      Skill_File under `.claude/skills/`, and every Agent_Hook file under
//      `.kiro/hooks/` — even though `run.ts` itself always writes its own
//      report artifact (see run.ts's module-header rationale for why the
//      report write is not considered a "changes" write).
//   2. The generated `governance-report.md` reflects the real repo's actual
//      shape: all 4 steering documents, a representation of all 38 real
//      services (33 documented + the 5 newly-discovered ones), and all 11
//      real hooks.
//
// Feature: agent-context-governance-refresh
// _Requirements: 7.1, 8.1

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SUITE_ROOT = join(__dirname, "../..");
const REPO_ROOT = join(SUITE_ROOT, "..");

const STEERING_DIR = join(REPO_ROOT, ".kiro/steering");
const SKILLS_DIR = join(SUITE_ROOT, ".claude/skills");
const HOOKS_DIR = join(REPO_ROOT, ".kiro/hooks");
const SERVICES_DIR = join(SUITE_ROOT, "services");
const REPORT_PATH = join(REPO_ROOT, ".kiro/specs/agent-context-governance-refresh/governance-report.md");

const ALWAYS_LOADED_DOC_NAMES = ["tech.md", "structure.md", "quick-reference.md", "product.md"];

const DOCUMENTED_SERVICES = [
  "identity", "tenant", "policy", "audit", "notification", "finance", "procurement",
  "contract", "hrms", "payroll", "estab", "asset", "stock", "inventory", "project",
  "grant", "citizen", "legal", "crm", "helpdesk", "telephony", "knowledge", "location",
  "report", "analytics", "workflow", "admin", "billing", "install", "plugin", "theme",
  "gateway", "queue",
];

const NEWLY_DISCOVERED_SERVICES = ["court", "meeting", "metadata", "ml", "visitor"];

const REAL_HOOK_FILES = [
  "authz-guard-check.kiro.hook",
  "enforce-coverage-80.kiro.hook",
  "mobile-integrity-check.kiro.hook",
  "money-path-integrity.kiro.hook",
  "pii-encryption-check.kiro.hook",
  "sync-validators-docs.kiro.hook",
  "update-api-docs.kiro.hook",
  "update-db-schema.kiro.hook",
  "update-user-manual.kiro.hook",
  "validate-migration.kiro.hook",
  "verify-consumer-wiring.kiro.hook",
];

/** Content hash of a single file, or `null` if the file does not exist. */
function hashFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Content hashes of every file directly under `dir` (non-recursive), keyed
 * by filename — used to snapshot the skill files and hook files directories
 * without depending on this test having to know every filename up front. */
function hashDirFilesShallow(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isFile()) continue;
    const hash = hashFile(join(dir, name.name));
    if (hash !== null) result[name.name] = hash;
  }
  return result;
}

describe("run.ts --dry-run against the real repo", () => {
  it(
    "produces a governance-report.md covering all 4 steering docs, all 38 services, and all 11 hooks, without modifying any source file",
    () => {
      // ── Snapshot governed source files BEFORE running the tool ──
      const steeringBefore = Object.fromEntries(
        ALWAYS_LOADED_DOC_NAMES.map((name) => [name, hashFile(join(STEERING_DIR, name))])
      );
      const skillsBefore = hashDirFilesShallow(SKILLS_DIR);
      const hooksBefore = hashDirFilesShallow(HOOKS_DIR);

      // Real services/ directory: confirm it currently has 38 service dirs
      // (33 documented + 5 newly discovered), independent of anything run.ts
      // reports — this is a fact about the repo, not about the tool.
      const realServiceDirNames = readdirSync(SERVICES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name.replace(/-service$/, ""));
      expect(realServiceDirNames.length).toBe(38);
      for (const service of [...DOCUMENTED_SERVICES, ...NEWLY_DISCOVERED_SERVICES]) {
        expect(realServiceDirNames).toContain(service);
      }

      // ── Run `tsx scripts/governance/run.ts --dry-run` as a real subprocess,
      // cwd = civitasone-suite/, exactly as `pnpm governance:audit` does. ──
      const tsxBin = join(SUITE_ROOT, "node_modules/.bin/tsx");
      const output = execFileSync(tsxBin, ["scripts/governance/run.ts", "--dry-run"], {
        cwd: SUITE_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });

      expect(output).toContain("Report written to");

      // ── Snapshot governed source files AFTER running the tool, and assert
      // nothing changed. ──
      const steeringAfter = Object.fromEntries(
        ALWAYS_LOADED_DOC_NAMES.map((name) => [name, hashFile(join(STEERING_DIR, name))])
      );
      const skillsAfter = hashDirFilesShallow(SKILLS_DIR);
      const hooksAfter = hashDirFilesShallow(HOOKS_DIR);

      expect(steeringAfter).toEqual(steeringBefore);
      expect(skillsAfter).toEqual(skillsBefore);
      expect(hooksAfter).toEqual(hooksBefore);

      // ── Read the generated report and assert its content. ──
      expect(existsSync(REPORT_PATH)).toBe(true);
      const report = readFileSync(REPORT_PATH, "utf8");

      // All 4 steering documents are represented.
      for (const doc of ALWAYS_LOADED_DOC_NAMES) {
        expect(report).toContain(doc);
      }

      // All 38 services are represented: the 5 newly-discovered ones appear
      // explicitly in the reconciliation output (the 33 already-documented
      // ones are the reconciliation's unchanged baseline, verified above
      // against the real services/ directory rather than expected to be
      // re-listed verbatim in the report body).
      for (const service of NEWLY_DISCOVERED_SERVICES) {
        expect(report).toContain(`\`${service}\``);
      }

      // All 11 real hooks are represented.
      for (const hookFile of REAL_HOOK_FILES) {
        expect(report).toContain(hookFile);
      }
    },
    60_000
  );
});
