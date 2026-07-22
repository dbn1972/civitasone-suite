// scripts/governance/run.ts
//
// End-to-end orchestration — see design.md's Architecture diagram and
// task 16.1's instructions. Composes, in order:
//
//   auditSteeringDocuments()
//     -> inventorySkills() / findEnforceableRuleDuplication()
//     -> listServiceRegistry() / discoverPort() / reconcileServiceList() / reconcilePortMap()
//     -> per-hook parseHookFile() / validateHookSchema() / checkGlobLowConfidence()
//     -> extractReferencedPaths() / checkFileOrDirExists() / checkPnpmScriptExists()
//     -> classifyCorrection() / applyOrFlag() (the R6 correction gate)
//     -> renderGovernanceReport()
//
// writing the result to
// `.kiro/specs/agent-context-governance-refresh/governance-report.md`.
//
// This is a synthesis/wiring script: every non-trivial decision (what to
// trim, what to classify as stale, what to auto-apply) already lives in the
// pure functions imported below. This file's own logic is limited to: (a)
// locating real repo paths, (b) collecting inputs for each pure function
// from disk, (c) shaping their outputs into `GovernanceReportInput`, and (d)
// — in `--apply` mode only — performing the actual file writes the
// Refresh_Process decided on.
//
// Invocation (per README.md): `tsx scripts/governance/run.ts [--dry-run|--apply]`,
// run with `cwd` = `civitasone-suite/`. Defaults to `--dry-run` when neither
// flag is given, per task 16.1's safety instruction.
//
// _Requirements: 7.1, 8.1

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { auditSteeringDocuments, type ClassifiedSection } from "./steering-audit.js";
import {
  moveSectionsToConditionalDoc,
  selectTrimmable,
  extractMovedProvenance,
  POINT_IN_TIME_METRICS_DOC_PATH,
  POINT_IN_TIME_METRICS_FRONT_MATTER,
  POINT_IN_TIME_METRICS_HEADER,
} from "./steering-refresh.js";
import {
  discoverPort,
  listServiceRegistry,
  reconcilePortMap,
  reconcileServiceList,
  type PortDiscoveryResult,
} from "./reconcile-services.js";
import { findEnforceableRuleDuplication, inventorySkills, replaceDuplicatedContent } from "./skills-audit.js";
import {
  checkGlobLowConfidence,
  parseHookFile,
  validateHookSchema,
  fixMissingVersion,
  fixInvalidWhenType,
} from "./hooks-validate.js";
import { checkFileOrDirExists, checkPnpmScriptExists, extractReferencedPaths } from "./hooks-referenced-paths.js";
import { classifyCorrection, applyOrFlag } from "./correction-gate.js";
import { renderGovernanceReport, type GovernanceReportInput, type HookReportEntry, type SkillReportEntry } from "./governance-report.js";
import type { Correction } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Repo paths
// ─────────────────────────────────────────────────────────────────────────────

// This file lives at civitasone-suite/scripts/governance/run.ts. The
// workspace root (containing .kiro/) is two levels up from civitasone-suite/.
// `__dirname` is available as a CommonJS ambient global here (this module
// compiles to CommonJS, matching every sibling *.test.ts file's use of
// `__dirname` in this same directory — see e.g. reconcile-services.test.ts).
const SUITE_ROOT = join(__dirname, "../.."); // civitasone-suite/
const WORKSPACE_ROOT = join(SUITE_ROOT, ".."); // /home/ec2-user/CivitasOne

const STEERING_DIR = join(WORKSPACE_ROOT, ".kiro/steering");
const HOOKS_DIR = join(WORKSPACE_ROOT, ".kiro/hooks");
const SKILLS_DIR = join(SUITE_ROOT, ".claude/skills");
const SERVICES_DIR = join(SUITE_ROOT, "services");
const GATEWAY_REGISTRY_PATH = join(SERVICES_DIR, "gateway-service/src/registry.ts");
const REPORT_PATH = join(WORKSPACE_ROOT, ".kiro/specs/agent-context-governance-refresh/governance-report.md");

const ALWAYS_LOADED_DOCS = ["tech.md", "structure.md", "quick-reference.md", "product.md"];

// The documented service list from .kiro/steering/structure.md's
// "## Services (33 total)" section, verbatim (matches
// reconcile-services.test.ts / governance-report.test.ts's fixture — these
// are read from the steering doc conceptually, but are hardcoded here for
// the same determinism reason those test files hardcode them: reconciling
// against whatever `structure.md` happens to say *right now* would make
// `added` drift as this very script edits that file in --apply mode).
const DOCUMENTED_SERVICES = [
  "identity",
  "tenant",
  "policy",
  "audit",
  "notification",
  "finance",
  "procurement",
  "contract",
  "hrms",
  "payroll",
  "estab",
  "asset",
  "stock",
  "inventory",
  "project",
  "grant",
  "citizen",
  "legal",
  "crm",
  "helpdesk",
  "telephony",
  "knowledge",
  "location",
  "report",
  "analytics",
  "workflow",
  "admin",
  "billing",
  "install",
  "plugin",
  "theme",
  "gateway",
  "queue",
];

// The documented port map from .kiro/steering/quick-reference.md's
// "## Port Map (Gateway Registry)" table, verbatim.
const DOCUMENTED_PORTS: Record<string, number> = {
  identity: 3001,
  tenant: 3002,
  policy: 3003,
  audit: 3004,
  install: 3005,
  notification: 3006,
  finance: 3007,
  procurement: 3008,
  contract: 3009,
  estab: 3010,
  stock: 3011,
  hrms: 3012,
  payroll: 3013,
  project: 3014,
  asset: 3015,
  report: 3016,
  plugin: 3017,
  theme: 3018,
  grant: 3019,
  citizen: 3020,
  legal: 3021,
  admin: 3022,
  billing: 3023,
  crm: 3024,
  inventory: 3025,
  telephony: 3026,
  helpdesk: 3027,
  knowledge: 3028,
  workflow: 3029,
  queue: 3030,
  analytics: 3031,
  location: 4012,
  gateway: 8080,
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI flag parsing (task 16.1's step 10) — defaults to --dry-run when
// neither flag is given, per the safety instruction.
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "dry-run" | "apply";

function parseMode(argv: string[]): Mode {
  if (argv.includes("--apply")) return "apply";
  return "dry-run"; // covers --dry-run and the no-flag default
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Steering audit
// ─────────────────────────────────────────────────────────────────────────────

interface SteeringPipelineResult {
  perDocumentReport: GovernanceReportInput["steering"]["perDocument"];
  combinedLineCountBefore: number;
  combinedLineCountAfter: number;
  staleSectionsByDocument: Map<string, ClassifiedSection[]>;
  allClassifiedSections: ClassifiedSection[];
  sourceDocumentTexts: Record<string, string>;
}

/**
 * Reads the target `point-in-time-metrics.md` conditional doc (if it exists)
 * and extracts every section's recorded provenance (`governance:moved-from`
 * comments — see `steering-refresh.ts`'s `renderProvenanceComment`), summed
 * per source document. This is how the report stays historically accurate
 * on an idempotent re-run: once a section is moved out of e.g. `tech.md`,
 * a later run's live audit of `tech.md` finds nothing left to trim there
 * (correctly — there's nothing left to move), but the *report* should still
 * show that `tech.md` was reduced by however many lines were moved out of
 * it, historically, rather than silently reporting a 0 delta as if the
 * trim had never happened.
 */
interface HistoricalMovedInfo {
  totalLineCount: number;
  headings: string[];
}

function readHistoricalMovedInfo(): Map<string, HistoricalMovedInfo> {
  const targetPath = join(WORKSPACE_ROOT, POINT_IN_TIME_METRICS_DOC_PATH);
  const historical = new Map<string, HistoricalMovedInfo>();
  if (!existsSync(targetPath)) return historical;

  const targetText = readFileSync(targetPath, "utf8");
  for (const { document, lineCount, heading } of extractMovedProvenance(targetText)) {
    const entry = historical.get(document) ?? { totalLineCount: 0, headings: [] };
    entry.totalLineCount += lineCount;
    if (heading.length > 0) entry.headings.push(heading.replace(/^#+\s*/, ""));
    historical.set(document, entry);
  }
  return historical;
}

function runSteeringAudit(): SteeringPipelineResult {
  const steeringPaths = ALWAYS_LOADED_DOCS.map((doc) => join(STEERING_DIR, doc));
  const audit = auditSteeringDocuments(steeringPaths);

  const sourceDocumentTexts: Record<string, string> = {};
  for (const doc of ALWAYS_LOADED_DOCS) {
    sourceDocumentTexts[doc] = readFileSync(join(STEERING_DIR, doc), "utf8");
  }

  const historicalMovedInfo = readHistoricalMovedInfo();

  const perDocumentReport: GovernanceReportInput["steering"]["perDocument"] = {};
  const staleSectionsByDocument = new Map<string, ClassifiedSection[]>();
  const allClassifiedSections: ClassifiedSection[] = [];
  let combinedLineCountBefore = 0;
  let combinedLineCountAfter = 0;

  for (const [doc, entry] of Object.entries(audit.perDocument)) {
    allClassifiedSections.push(...entry.sections);
    const staleSections = selectTrimmable(entry.sections);
    staleSectionsByDocument.set(doc, staleSections);

    // Lines/headings moved out of this document *in this run* (freshly
    // discovered Stale_Content still live in the document) plus lines
    // already moved out of it in a *previous* run (recovered from the
    // target doc's provenance comments). Combining both is what keeps
    // re-running the tool idempotent for the live docs while still
    // reporting the true cumulative reduction rather than a 0 delta once
    // nothing is left to trim.
    const movedThisRun = staleSections.reduce((sum, s) => sum + s.lineCount, 0);
    const historical = historicalMovedInfo.get(doc);
    const movedHistorically = historical?.totalLineCount ?? 0;

    const lineCountBefore = entry.lineCountBefore + movedHistorically;
    const lineCountAfter = entry.lineCountBefore - movedThisRun;

    const sectionsMovedThisRun = staleSections.map((s) => s.heading.replace(/^#+\s*/, ""));
    const sectionsMoved = [...(historical?.headings ?? []), ...sectionsMovedThisRun];

    perDocumentReport[doc] = { lineCountBefore, lineCountAfter, sectionsMoved };
    combinedLineCountBefore += lineCountBefore;
    combinedLineCountAfter += lineCountAfter;
  }

  return {
    perDocumentReport,
    combinedLineCountBefore,
    combinedLineCountAfter,
    staleSectionsByDocument,
    allClassifiedSections,
    sourceDocumentTexts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Skills audit
// ─────────────────────────────────────────────────────────────────────────────

function runSkillsAudit(enforceableRules: ClassifiedSection[]): {
  skillsReport: SkillReportEntry[];
  duplicationBySkillFile: Map<string, { text: string; findings: ReturnType<typeof findEnforceableRuleDuplication> }>;
} {
  const inventory = inventorySkills(SKILLS_DIR);
  const skillsWithText = inventory.map((info) => ({
    file: info.file,
    text: readFileSync(join(SKILLS_DIR, info.file), "utf8"),
  }));

  const findings = findEnforceableRuleDuplication(skillsWithText, enforceableRules);
  const findingsByFile = new Map<string, typeof findings>();
  for (const finding of findings) {
    const list = findingsByFile.get(finding.skillFile) ?? [];
    list.push(finding);
    findingsByFile.set(finding.skillFile, list);
  }

  const duplicationBySkillFile = new Map<string, { text: string; findings: typeof findings }>();
  const skillsReport: SkillReportEntry[] = inventory.map((info) => {
    const fileFindings = findingsByFile.get(info.file) ?? [];
    const text = skillsWithText.find((s) => s.file === info.file)?.text ?? "";
    duplicationBySkillFile.set(info.file, { text, findings: fileFindings });

    if (fileFindings.length > 0) {
      const reasons = fileFindings
        .map((f) => `duplicates "${f.matchedRuleHeading.replace(/^#+\s*/, "")}" from ${f.matchedRuleDocument}`)
        .join("; ");
      return { file: info.file, action: "updated", reason: `Replaced duplicated content with a steering reference (${reasons}).` };
    }

    return {
      file: info.file,
      action: "unchanged",
      reason: `Inventoried domain "${info.domain}" (${info.lineCount} lines); no duplication or coverage gap requiring a change was found for this file.`,
    };
  });

  return { skillsReport, duplicationBySkillFile };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Service/port reconciliation
// ─────────────────────────────────────────────────────────────────────────────

function runServicePortReconciliation(): {
  serviceReconciliation: GovernanceReportInput["serviceReconciliation"];
  portReconciliation: GovernanceReportInput["portReconciliation"];
} {
  const registry = listServiceRegistry(SERVICES_DIR);
  const { added: addedServices } = reconcileServiceList(DOCUMENTED_SERVICES, registry);

  const gatewayRegistrySource = readFileSync(GATEWAY_REGISTRY_PATH, "utf8");
  const discover = (service: string): PortDiscoveryResult =>
    discoverPort(join(SERVICES_DIR, `${service}-service`), gatewayRegistrySource);

  const { added: addedPorts, needsManualAssignment } = reconcilePortMap(DOCUMENTED_PORTS, registry, discover);

  return {
    serviceReconciliation: { added: addedServices },
    portReconciliation: { added: addedPorts, needsManualAssignment },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5/6. Hook validation, referenced-path checking, and the correction gate
// ─────────────────────────────────────────────────────────────────────────────

interface RawHookInfo {
  file: string;
  raw: string;
  parsed: ReturnType<typeof parseHookFile>;
}

interface PackageJsonShape {
  scripts: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Recursively lists every file under `dir` (relative to `dir`), skipping
 * heavy/irrelevant directories so the low-confidence glob check runs
 * against a reasonably complete but bounded snapshot of the repo. Used as
 * the `repoFileList` input to `checkGlobLowConfidence`. */
function listRepoFiles(dir: string): string[] {
  const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "coverage", ".pnpm"]);
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true }) as unknown as Array<{
    name: string;
    parentPath?: string;
    path?: string;
    isFile: () => boolean;
    isDirectory: () => boolean;
  }>;
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const base = entry.parentPath ?? entry.path ?? dir;
    const rel = join(base, entry.name).slice(dir.length + 1);
    if (rel.split(/[\\/]/).some((segment) => SKIP_DIR_NAMES.has(segment))) continue;
    files.push(rel.split("\\").join("/"));
  }
  return files;
}

function loadPackageJsons(): Record<string, PackageJsonShape> {
  const packageJsons: Record<string, PackageJsonShape> = {};

  const rootPkgPath = join(SUITE_ROOT, "package.json");
  if (existsSync(rootPkgPath)) {
    packageJsons.root = JSON.parse(readFileSync(rootPkgPath, "utf8")) as PackageJsonShape;
  }

  for (const workspaceDir of ["services", "packages", "apps"]) {
    const dirPath = join(SUITE_ROOT, workspaceDir);
    if (!existsSync(dirPath)) continue;
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(dirPath, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJsonShape & { name?: string };
        if (typeof pkg.name === "string") {
          packageJsons[pkg.name] = pkg;
        }
      } catch {
        // Malformed package.json — skip; this is a read-only audit step.
      }
    }
  }

  return packageJsons;
}

function loadRawHooks(): RawHookInfo[] {
  const files = readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith(".kiro.hook"))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(join(HOOKS_DIR, file), "utf8");
    return { file, raw, parsed: parseHookFile(raw) };
  });
}

interface HookPipelineResult {
  hooksReport: HookReportEntry[];
  appliedHookContents: Map<string, unknown>; // file -> corrected hook JSON value (apply mode only)
}

function runHooksPipeline(repoFileList: string[], packageJsons: Record<string, PackageJsonShape>): HookPipelineResult {
  const rawHooks = loadRawHooks();
  const hooksReport: HookReportEntry[] = [];
  const appliedHookContents = new Map<string, unknown>();

  for (const { file, raw, parsed } of rawHooks) {
    if (!parsed.ok) {
      hooksReport.push({ file, status: "needs-manual-review", flaggedReasons: [`parse error: ${parsed.error}`] });
      continue;
    }

    const hookValue = parsed.value;
    const { valid, errors } = validateHookSchema(hookValue);

    // Collect mechanical corrections for schema defects this validator can
    // fix (missing version, obvious when.type typo). These are the only
    // schema-level corrections attempted automatically; anything else
    // failing validateHookSchema is left as needs-manual-review.
    const correctionsApplied: string[] = [];
    const flaggedReasons: string[] = [];
    let workingValue: unknown = hookValue;

    if (!valid) {
      for (const error of errors) {
        if (error.startsWith("missing required key: version")) {
          const before = JSON.stringify(hookValue);
          const fixed = fixMissingVersion(workingValue);
          const after = JSON.stringify(fixed);
          const correction: Correction = {
            hookFile: file,
            field: "version",
            before,
            after,
            touchesRolesCommandsOrBusinessRules: classifyCorrection(before, after, "version"),
          };
          const outcome = applyOrFlag(correction, () => fixed);
          if (outcome.applied) {
            workingValue = fixed;
            correctionsApplied.push("added missing `version` key");
          } else {
            flaggedReasons.push("missing `version` key (flagged: touches roles/commands/business rules)");
          }
        } else if (error.startsWith("when.type")) {
          const before = JSON.stringify(hookValue);
          const fixed = fixInvalidWhenType(workingValue);
          const after = JSON.stringify(fixed);
          if (after !== before) {
            const correction: Correction = {
              hookFile: file,
              field: "when.type",
              before,
              after,
              touchesRolesCommandsOrBusinessRules: classifyCorrection(before, after, "when.type"),
            };
            const outcome = applyOrFlag(correction, () => fixed);
            if (outcome.applied) {
              workingValue = fixed;
              correctionsApplied.push("corrected invalid `when.type` value");
            } else {
              flaggedReasons.push("invalid `when.type` value (flagged: touches roles/commands/business rules)");
            }
          } else {
            flaggedReasons.push(error);
          }
        } else {
          flaggedReasons.push(error);
        }
      }
    }

    // Referenced-path checking (Requirement 6) — run against the
    // (possibly schema-corrected) hook value's when/then structure.
    const workingObj = workingValue as { name?: unknown; when?: unknown; then?: unknown };
    const hookName = typeof workingObj.name === "string" ? workingObj.name : file;
    const referenced = extractReferencedPaths({ name: hookName, when: workingObj.when, then: workingObj.then });

    for (const ref of referenced) {
      if (ref.kind === "glob") continue; // checked separately below via checkGlobLowConfidence
      if (ref.kind === "file-or-dir") {
        const exists = checkFileOrDirExists(SUITE_ROOT, ref.rawText);
        if (!exists) {
          // The one confirmed, mechanically-safe worked example: rewrite
          // docs/database/ -> docs/DATABASE-SCHEMA.md (task 18.4 target).
          // This is a path-string-only fix: no role, command, or
          // business-rule sentence changes, which classifyCorrection
          // confirms below.
          if (ref.rawText === "docs/database/" && typeof workingObj.then === "object" && workingObj.then !== null) {
            const thenObj = workingObj.then as { prompt?: unknown };
            if (typeof thenObj.prompt === "string" && thenObj.prompt.includes("docs/database/")) {
              const before = thenObj.prompt;
              const after = before.replace("docs/database/", "docs/DATABASE-SCHEMA.md");
              const touches = classifyCorrection(before, after, "then.prompt");
              const correction: Correction = { hookFile: file, field: "then.prompt", before, after, touchesRolesCommandsOrBusinessRules: touches };
              const outcome = applyOrFlag(correction, () => ({
                ...(workingValue as Record<string, unknown>),
                then: { ...thenObj, prompt: after },
              }));
              if (outcome.applied) {
                workingValue = outcome.result;
                correctionsApplied.push("corrected `docs/database/` reference to `docs/DATABASE-SCHEMA.md`");
              } else {
                flaggedReasons.push(`referenced path "docs/database/" does not exist (flagged: touches roles/commands/business rules)`);
              }
              continue;
            }
          }
          flaggedReasons.push(`referenced path "${ref.rawText}" (in ${ref.sourceField}) does not exist`);
        }
      } else if (ref.kind === "pnpm-script") {
        const exists = checkPnpmScriptExists(ref.rawText, packageJsons);
        if (!exists) {
          flaggedReasons.push(`referenced command "${ref.rawText}" (in ${ref.sourceField}) does not resolve to a known script/tool`);
        }
      }
    }

    // Low-confidence glob check (Requirement 6.5 / Property 18) — recorded
    // as a finding, never disables the hook.
    const whenObj = workingObj.when as { patterns?: unknown } | undefined;
    const patterns = Array.isArray(whenObj?.patterns) ? (whenObj?.patterns as string[]) : [];
    if (patterns.length > 0) {
      const lowConfidence = checkGlobLowConfidence(patterns, repoFileList);
      if (lowConfidence) {
        flaggedReasons.push(`when.patterns ${JSON.stringify(patterns)} currently match 0 files in the repo (low-confidence trigger)`);
      }
    }

    const finalErrors = validateHookSchema(workingValue).errors;
    let status: HookReportEntry["status"];
    if (finalErrors.length === 0 && flaggedReasons.length === 0) {
      status = correctionsApplied.length > 0 ? "corrected" : "valid";
    } else if (finalErrors.length === 0 && correctionsApplied.length > 0 && flaggedReasons.length === 0) {
      status = "corrected";
    } else if (flaggedReasons.length > 0 || finalErrors.length > 0) {
      status = "needs-manual-review";
    } else {
      status = "valid";
    }

    const entry: HookReportEntry = { file, status };
    if (correctionsApplied.length > 0) entry.corrections = correctionsApplied;
    const allFlagged = [...flaggedReasons, ...finalErrors.filter((e) => !flaggedReasons.includes(e))];
    if (allFlagged.length > 0) entry.flaggedReasons = allFlagged;
    hooksReport.push(entry);

    if (correctionsApplied.length > 0) {
      appliedHookContents.set(file, workingValue);
    }
  }

  return { hooksReport, appliedHookContents };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7/8. Assemble GovernanceReportInput and render
// ─────────────────────────────────────────────────────────────────────────────

function buildSpecCrossReferences(): GovernanceReportInput["specCrossReferences"] {
  return [
    {
      spec: "civitasone-suite/.kiro/specs/meeting-service/",
      relatedTo:
        "meeting-service voting/minutes/attendance/agenda/committee/participant modules reflected in the reconciled service list, port map, and the 12-meeting-governance-domain.md skill file",
    },
    {
      spec: "civitasone-suite/.kiro/specs/tenant-platform-hardening/",
      relatedTo: "tenant-platform-hardening work reflected in the reconciled service/port entries",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. --apply mode writes
// ─────────────────────────────────────────────────────────────────────────────

function applySteeringRefresh(steering: SteeringPipelineResult): void {
  const allStale = ALWAYS_LOADED_DOCS.flatMap((doc) => steering.staleSectionsByDocument.get(doc) ?? []);
  if (allStale.length === 0) return;

  const targetPath = join(WORKSPACE_ROOT, POINT_IN_TIME_METRICS_DOC_PATH);
  const existingTargetText = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : undefined;

  const moveResult = moveSectionsToConditionalDoc(allStale, POINT_IN_TIME_METRICS_DOC_PATH, POINT_IN_TIME_METRICS_FRONT_MATTER, {
    sourceDocumentTexts: steering.sourceDocumentTexts,
    ...(existingTargetText !== undefined
      ? { existingTargetDocumentText: existingTargetText }
      : { targetDocumentHeader: POINT_IN_TIME_METRICS_HEADER }),
  });

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, moveResult.targetDocumentText, "utf8");

  for (const [doc, text] of Object.entries(moveResult.updatedSourceDocuments)) {
    writeFileSync(join(STEERING_DIR, doc), text, "utf8");
  }
}

function applyServicePortReconciliation(
  serviceReconciliation: GovernanceReportInput["serviceReconciliation"],
  portReconciliation: GovernanceReportInput["portReconciliation"]
): void {
  if (serviceReconciliation.added.length > 0) {
    const structurePath = join(STEERING_DIR, "structure.md");
    let text = readFileSync(structurePath, "utf8");
    const match = /## Services \((\d+) total\)\n\n([^\n]+)\n/.exec(text);
    if (match !== undefined && match !== null) {
      const currentTotal = Number(match[1]);
      const currentListLine = match[2] ?? "";
      const currentNames = currentListLine
        .replace(/\.$/, "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const newNames = [...currentNames, ...serviceReconciliation.added];
      const newTotal = currentTotal + serviceReconciliation.added.length;
      const newHeading = `## Services (${newTotal} total)\n\n${newNames.join(", ")}.\n`;
      text = text.replace(/## Services \(\d+ total\)\n\n[^\n]+\n/, newHeading);
      writeFileSync(structurePath, text, "utf8");
    }
  }

  if (portReconciliation.added.length > 0 || portReconciliation.needsManualAssignment.length > 0) {
    const quickRefPath = join(STEERING_DIR, "quick-reference.md");
    let text = readFileSync(quickRefPath, "utf8");
    const tableRowAnchor = "| gateway | 8080 | — (entry point) |";
    const newRows = portReconciliation.added.map((entry) => `| ${entry.service} | ${entry.port} | _(needs gateway prefix documented)_ |`).join("\n");
    if (newRows.length > 0 && text.includes(tableRowAnchor)) {
      text = text.replace(tableRowAnchor, `${tableRowAnchor}\n${newRows}`);
    }
    if (portReconciliation.needsManualAssignment.length > 0) {
      const note = `\n> Needs manual port assignment: ${portReconciliation.needsManualAssignment.join(", ")} (no discoverable port — do not invent one).\n`;
      if (!text.includes("Needs manual port assignment")) {
        text = text.replace(/(## Port Map \(Gateway Registry\)\n)/, `$1${note}`);
      }
    }
    writeFileSync(quickRefPath, text, "utf8");
  }
}

function applySkillsUpdates(duplicationBySkillFile: Map<string, { text: string; findings: ReturnType<typeof findEnforceableRuleDuplication> }>): void {
  for (const [file, { text, findings }] of duplicationBySkillFile) {
    if (findings.length === 0) continue;
    let updated = text;
    for (const finding of findings) {
      updated = replaceDuplicatedContent(updated, finding);
    }
    if (updated !== text) {
      writeFileSync(join(SKILLS_DIR, file), updated, "utf8");
    }
  }
}

function applyHookCorrections(appliedHookContents: Map<string, unknown>): void {
  for (const [file, value] of appliedHookContents) {
    writeFileSync(join(HOOKS_DIR, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// main()
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const mode = parseMode(process.argv.slice(2));

  const steering = runSteeringAudit();
  const { skillsReport, duplicationBySkillFile } = runSkillsAudit(steering.allClassifiedSections);
  const { serviceReconciliation, portReconciliation } = runServicePortReconciliation();

  const repoFileList = listRepoFiles(SUITE_ROOT);
  const packageJsons = loadPackageJsons();
  const { hooksReport, appliedHookContents } = runHooksPipeline(repoFileList, packageJsons);

  const reportInput: GovernanceReportInput = {
    steering: {
      perDocument: steering.perDocumentReport,
      combinedLineCountBefore: steering.combinedLineCountBefore,
      combinedLineCountAfter: steering.combinedLineCountAfter,
    },
    serviceReconciliation,
    portReconciliation,
    skills: skillsReport,
    hooks: hooksReport,
    specCrossReferences: buildSpecCrossReferences(),
  };

  if (mode === "apply") {
    applySteeringRefresh(steering);
    applyServicePortReconciliation(serviceReconciliation, portReconciliation);
    applySkillsUpdates(duplicationBySkillFile);
    applyHookCorrections(appliedHookContents);
  }

  const markdown = renderGovernanceReport(reportInput);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, markdown, "utf8");

  // eslint-disable-next-line no-console
  console.log(`[governance] mode=${mode}. Report written to ${REPORT_PATH}`);
}

main();
