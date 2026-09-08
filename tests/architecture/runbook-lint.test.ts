/**
 * Runbook lint test (task 14.3).
 *
 * File-existence + required-heading check for the 9 Tier-0/Tier-1 runbook
 * files plus the index, following the standard template in
 * docs/operations/SLO-SLI-RUNBOOKS.md §5: Purpose, Owner/escalation,
 * Dependencies, Key dashboards, Common failure modes → action, Rollback,
 * Recovery (RPO/RTO).
 *
 * Two conventions for expressing those sections currently coexist in
 * docs/runbooks/: the original bold-label list style (`**Purpose:**` etc.,
 * still used by queue.md), and the "world-class SRE format" heading style
 * (`## Purpose` etc.) that 4ec58530 ("docs: upgrade 23 runbooks to
 * world-class SRE format", 2026-07-26) rolled out to gateway, identity,
 * finance, estab, workflow, hrms, payroll and audit. Both are accepted here
 * as long as the section is present in some recognizable form — see
 * REL-011 in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md for the follow-up
 * finding that queue.md was named in 4ec58530's commit message as upgraded
 * but was never actually touched, so it's the one runbook still on the
 * older convention.
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

// Required sections per the §5 standard runbook template. Each entry lists
// every pattern currently in legitimate use across docs/runbooks/ — a
// runbook passes a section if it matches at least one.
const REQUIRED_SECTIONS: { name: string; patterns: RegExp[] }[] = [
  { name: "Purpose", patterns: [/\*\*Purpose:\*\*/, /^## Purpose$/m] },
  {
    name: "Owner / escalation",
    patterns: [
      /\*\*Owner \/ escalation:\*\*/,
      // SRE-format header line, e.g. "**Owner:** X | **Escalation:** Y".
      /\*\*Owner:\*\*.*\*\*Escalation:\*\*/,
    ],
  },
  { name: "Dependencies", patterns: [/\*\*Dependencies:\*\*/, /^## Dependencies$/m] },
  { name: "Key dashboards", patterns: [/\*\*Key dashboards:\*\*/i, /^## Key Dashboards$/im] },
  {
    name: "Common failure modes → action",
    patterns: [/Common failure modes/i, /^## Failure Modes$/m],
  },
  { name: "Rollback", patterns: [/\*\*Rollback:\*\*/, /^## Rollback$/m] },
  {
    name: "Recovery (RPO/RTO)",
    patterns: [/\*\*Recovery \(RPO\/RTO\):\*\*/, /^## Recovery \(RPO\/RTO\)$/m],
  },
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
        const found = section.patterns.some((pattern) => pattern.test(content));
        expect(found, `${service}.md missing section: ${section.name}`).toBe(true);
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
