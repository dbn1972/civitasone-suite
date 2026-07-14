/**
 * Runbook lint test (task 14.3).
 *
 * File-existence + required-heading check for the 9 Tier-0/Tier-1 runbook
 * files plus the index, following the standard template in
 * docs/operations/SLO-SLI-RUNBOOKS.md §5: Purpose, Owner/escalation,
 * Dependencies, Key dashboards, Common failure modes → action, Rollback,
 * Recovery (RPO/RTO).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNBOOKS_DIR = resolve(__dirname, "../../docs/runbooks");

// The 9 Tier-0/Tier-1 services per docs/operations/SLO-SLI-RUNBOOKS.md §3/§4.
const TIER01_SERVICES = [
  "gateway",
  "identity",
  "queue",
  "finance",
  "estab",
  "workflow",
  "hrms",
  "payroll",
  "audit",
];

// Required section headers per the §5 standard runbook template.
const REQUIRED_SECTIONS = [
  "**Purpose:**",
  "**Owner / escalation:**",
  "**Dependencies:**",
  "**Key dashboards:**",
  "Common failure modes",
  "**Rollback:**",
  "**Recovery (RPO/RTO):**",
];

describe("runbook lint — file existence", () => {
  it("every Tier-0/Tier-1 service has a runbook file", () => {
    for (const service of TIER01_SERVICES) {
      const path = resolve(RUNBOOKS_DIR, `${service}.md`);
      expect(existsSync(path), `missing runbook: docs/runbooks/${service}.md`).toBe(true);
    }
  });

  it("the runbooks index (README.md) exists", () => {
    expect(existsSync(resolve(RUNBOOKS_DIR, "README.md"))).toBe(true);
  });
});

describe("runbook lint — required headings (§5 template)", () => {
  for (const service of TIER01_SERVICES) {
    it(`${service}.md contains every required section`, () => {
      const path = resolve(RUNBOOKS_DIR, `${service}.md`);
      const content = readFileSync(path, "utf-8");
      for (const section of REQUIRED_SECTIONS) {
        expect(content, `${service}.md missing section: ${section}`).toContain(section);
      }
      // The title heading must name the service (e.g. "# Runbook: finance-service").
      expect(content).toMatch(/^# Runbook: /m);
    });
  }
});

describe("runbook lint — index links every Tier-0/Tier-1 runbook", () => {
  it("README.md links each of the 9 service runbook files", () => {
    const readme = readFileSync(resolve(RUNBOOKS_DIR, "README.md"), "utf-8");
    for (const service of TIER01_SERVICES) {
      expect(readme, `README.md does not link ${service}.md`).toContain(`(./${service}.md)`);
    }
  });

  it("README.md cross-references the Tier-2 template doc", () => {
    const readme = readFileSync(resolve(RUNBOOKS_DIR, "README.md"), "utf-8");
    expect(readme).toContain("SLO-SLI-RUNBOOKS.md");
  });
});
