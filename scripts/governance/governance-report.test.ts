// scripts/governance/governance-report.test.ts
//
// Unit test against real audit output (task 14.3).
//
// Builds a realistic GovernanceReportInput from the actual outputs of the
// already-implemented audit modules — auditSteeringDocuments against the
// real 4 always-loaded steering docs, reconcileServiceList/reconcilePortMap
// against the real services/ directory, inventorySkills against the real
// .claude/skills/ directory, and a hooks array reflecting the real 11 hooks'
// validation status — plus a specCrossReferences array pointing at the
// meeting-service and tenant-platform-hardening specs (Requirement 7.2).
//
// Feature: agent-context-governance-refresh

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderGovernanceReport, type GovernanceReportInput, type HookReportEntry } from "./governance-report.js";
import { auditSteeringDocuments } from "./steering-audit.js";
import { discoverPort, listServiceRegistry, reconcilePortMap, reconcileServiceList, type PortDiscoveryResult } from "./reconcile-services.js";
import { inventorySkills } from "./skills-audit.js";
import { parseHookFile, validateHookSchema } from "./hooks-validate.js";

const REPO_ROOT = join(__dirname, "../../..");
const SUITE_ROOT = join(__dirname, "../..");
const STEERING_DIR = join(REPO_ROOT, ".kiro/steering");
const SERVICES_DIR = join(SUITE_ROOT, "services");
const GATEWAY_REGISTRY_PATH = join(SERVICES_DIR, "gateway-service/src/registry.ts");
const SKILLS_DIR = join(SUITE_ROOT, ".claude/skills");
const HOOKS_DIR = join(REPO_ROOT, ".kiro/hooks");
const SPECS_DIR = join(REPO_ROOT, ".kiro/specs");

const ALWAYS_LOADED_DOCS = ["tech.md", "structure.md", "quick-reference.md", "product.md"];

const DOCUMENTED_SERVICES = [
  "identity", "tenant", "policy", "audit", "notification", "finance", "procurement",
  "contract", "hrms", "payroll", "estab", "asset", "stock", "inventory", "project",
  "grant", "citizen", "legal", "crm", "helpdesk", "telephony", "knowledge", "location",
  "report", "analytics", "workflow", "admin", "billing", "install", "plugin", "theme",
  "gateway", "queue",
];

const DOCUMENTED_PORTS: Record<string, number> = {
  identity: 3001, tenant: 3002, policy: 3003, audit: 3004, install: 3005,
  notification: 3006, finance: 3007, procurement: 3008, contract: 3009, estab: 3010,
  stock: 3011, hrms: 3012, payroll: 3013, project: 3014, asset: 3015, report: 3016,
  plugin: 3017, theme: 3018, grant: 3019, citizen: 3020, legal: 3021, admin: 3022,
  billing: 3023, crm: 3024, inventory: 3025, telephony: 3026, helpdesk: 3027,
  knowledge: 3028, workflow: 3029, queue: 3030, analytics: 3031, location: 4012,
  gateway: 8080,
};

function buildRealGovernanceReportInput(): GovernanceReportInput {
  // Steering: real auditSteeringDocuments output against the 4 real docs.
  const steeringPaths = ALWAYS_LOADED_DOCS.map((doc) => join(STEERING_DIR, doc));
  const audit = auditSteeringDocuments(steeringPaths);
  const perDocument: GovernanceReportInput["steering"]["perDocument"] = {};
  let combinedLineCountAfter = 0;
  for (const [doc, entry] of Object.entries(audit.perDocument)) {
    const staleSections = entry.sections.filter((s) => s.classification === "Stale_Content");
    const movedLineCount = staleSections.reduce((sum, s) => sum + s.lineCount, 0);
    const lineCountAfter = entry.lineCountBefore - movedLineCount;
    perDocument[doc] = {
      lineCountBefore: entry.lineCountBefore,
      lineCountAfter,
      sectionsMoved: staleSections.map((s) => s.heading.replace(/^#+\s*/, "")),
    };
    combinedLineCountAfter += lineCountAfter;
  }

  // Service/port reconciliation: real reconcileServiceList/reconcilePortMap
  // against the real services/ directory.
  const registry = listServiceRegistry(SERVICES_DIR);
  const { added: addedServices } = reconcileServiceList(DOCUMENTED_SERVICES, registry);
  const gatewayRegistrySource = readFileSync(GATEWAY_REGISTRY_PATH, "utf8");
  const discover = (service: string): PortDiscoveryResult => discoverPort(join(SERVICES_DIR, `${service}-service`), gatewayRegistrySource);
  const { added: addedPorts, needsManualAssignment } = reconcilePortMap(DOCUMENTED_PORTS, registry, discover);

  // Skills: real inventorySkills output against the real skills dir.
  const skillInfos = inventorySkills(SKILLS_DIR);
  const skills: GovernanceReportInput["skills"] = skillInfos.map((info) => ({
    file: info.file,
    action: "unchanged" as const,
    reason: `Inventoried domain "${info.domain}" (${info.lineCount} lines); no duplication or coverage gap requiring a change was found for this file.`,
  }));

  // Hooks: real parseHookFile/validateHookSchema against the real 11 hooks.
  const hookFiles = readdirSync(HOOKS_DIR).filter((f) => f.endsWith(".kiro.hook")).sort();
  const hooks: HookReportEntry[] = hookFiles.map((file) => {
    const raw = readFileSync(join(HOOKS_DIR, file), "utf8");
    const parsed = parseHookFile(raw);
    if (!parsed.ok) {
      return { file, status: "needs-manual-review", flaggedReasons: [`parse error: ${parsed.error}`] };
    }
    const { valid, errors } = validateHookSchema(parsed.value);
    if (valid) {
      return { file, status: "valid" };
    }
    return { file, status: "needs-manual-review", flaggedReasons: errors };
  });

  const specCrossReferences: GovernanceReportInput["specCrossReferences"] = [
    {
      spec: "civitasone-suite/.kiro/specs/meeting-service/",
      relatedTo: "meeting-service voting/minutes/attendance/agenda/committee/participant modules reflected in the reconciled service list and port map",
    },
    {
      spec: "civitasone-suite/.kiro/specs/tenant-platform-hardening/",
      relatedTo: "tenant-platform-hardening work reflected in the reconciled service/port entries",
    },
  ];

  return {
    steering: {
      perDocument,
      combinedLineCountBefore: audit.combinedLineCountBefore,
      combinedLineCountAfter,
    },
    serviceReconciliation: { added: addedServices },
    portReconciliation: { added: addedPorts, needsManualAssignment },
    skills,
    hooks,
    specCrossReferences,
  };
}

describe("renderGovernanceReport against real audit output", () => {
  it("includes cross-references to both meeting-service and tenant-platform-hardening specs", () => {
    const input = buildRealGovernanceReportInput();
    const markdown = renderGovernanceReport(input);

    expect(markdown).toContain("civitasone-suite/.kiro/specs/meeting-service/");
    expect(markdown).toContain("civitasone-suite/.kiro/specs/tenant-platform-hardening/");
  });

  it("does not create a duplicate spec directory under .kiro/specs/ or civitasone-suite/.kiro/specs/ as a side effect of rendering", () => {
    const suiteSpecsDirBefore = readdirSync(join(SUITE_ROOT, ".kiro/specs")).sort();
    const rootSpecsDirBefore = readdirSync(SPECS_DIR).sort();

    const input = buildRealGovernanceReportInput();
    // renderGovernanceReport is a pure function: no file I/O of any kind, so
    // calling it cannot create a directory. This assertion documents that
    // guarantee explicitly rather than leaving it implicit.
    renderGovernanceReport(input);

    const suiteSpecsDirAfter = readdirSync(join(SUITE_ROOT, ".kiro/specs")).sort();
    const rootSpecsDirAfter = readdirSync(SPECS_DIR).sort();

    expect(suiteSpecsDirAfter).toEqual(suiteSpecsDirBefore);
    expect(rootSpecsDirAfter).toEqual(rootSpecsDirBefore);

    // Existing spec directories referenced by the report are not duplicated
    // (no new directory named e.g. "meeting-service-2" or similar appears).
    expect(existsSync(join(SUITE_ROOT, ".kiro/specs/meeting-service"))).toBe(true);
    expect(existsSync(join(SUITE_ROOT, ".kiro/specs/tenant-platform-hardening"))).toBe(true);
  });
});
