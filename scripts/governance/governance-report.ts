// scripts/governance/governance-report.ts
//
// Governance Report Writer — see design.md's
// "7. Governance Report Writer (scripts/governance/governance-report.ts)"
// component.
//
// This file implements task 14.2: `renderGovernanceReport()`, a pure
// function from a `GovernanceReportInput` snapshot to a single markdown
// document. It performs no file I/O and no repo inspection of its own — it
// only renders the structured findings collected by every upstream module
// (steering-audit/steering-refresh, reconcile-services, skills-audit,
// hooks-validate/hooks-referenced-paths, correction-gate) into the single
// summary artifact Requirement 8 calls for.
//
// Being pure and deterministic given its input is what makes this function
// property-testable (design Property 8: report faithfulness; Property 9:
// exactly-once hook coverage) rather than something that can only be
// verified by manually reading a generated report.
//
// _Requirements: 1.4, 2.6, 4.5, 7.2, 8.1, 8.2

import type { HookFinalStatus } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// GovernanceReportInput — mirrors design.md's "7. Governance Report Writer"
// component interface verbatim (field-for-field), with `hooks[].status`
// typed via the shared `HookFinalStatus` union from `types.ts` rather than
// redeclaring the `"valid" | "corrected" | "needs-manual-review"` literal
// union locally.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-document steering line counts and moved-section names, keyed by
 * document name (e.g. `"tech.md"`).
 */
export interface SteeringPerDocumentReport {
  lineCountBefore: number;
  lineCountAfter: number;
  sectionsMoved: string[];
}

/**
 * A single skill-file audit action, as recorded by `skills-audit.ts`.
 */
export interface SkillReportEntry {
  file: string;
  action: "created" | "updated" | "unchanged";
  reason: string;
}

/**
 * A single hook's final validation/correction status, as recorded by
 * `hooks-validate.ts` / `hooks-referenced-paths.ts` / `correction-gate.ts`.
 * `status` uses the shared `HookFinalStatus` union from `types.ts`.
 */
export interface HookReportEntry {
  file: string;
  status: HookFinalStatus;
  corrections?: string[];
  flaggedReasons?: string[];
}

/**
 * A single cross-reference from this Governance_Report to an existing spec
 * directory (Requirement 7.2) — `spec` is the link target/label supplied by
 * the caller (already resolved to whatever path form the orchestration
 * script wants rendered, e.g. a relative path to
 * `civitasone-suite/.kiro/specs/meeting-service/`), and `relatedTo`
 * describes what governance change relates to it (e.g. "meeting-service
 * voting/minutes/attendance/agenda/committee/participant modules"). This
 * function never inlines or duplicates the referenced spec's content — it
 * only renders a link and the reason for the reference.
 */
export interface SpecCrossReference {
  spec: string;
  relatedTo: string;
}

/**
 * The full structured input to `renderGovernanceReport`. Mirrors
 * design.md's `GovernanceReportInput` interface exactly.
 */
export interface GovernanceReportInput {
  steering: {
    perDocument: Record<string, SteeringPerDocumentReport>;
    combinedLineCountBefore: number;
    combinedLineCountAfter: number;
  };
  serviceReconciliation: { added: string[] };
  portReconciliation: {
    added: { service: string; port: number }[];
    needsManualAssignment: string[];
  };
  skills: SkillReportEntry[];
  hooks: HookReportEntry[];
  specCrossReferences: SpecCrossReference[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Small rendering helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escapes text for safe placement inside a markdown table cell: pipes would
 * otherwise be parsed as column separators, and raw newlines would break
 * the table row onto multiple lines.
 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/**
 * Renders a markdown table from a header row and a list of already-escaped
 * cell rows. Returns a single "_None._" line instead of an empty table when
 * `rows` is empty, since a header-only table with no data rows is not
 * useful output.
 */
function renderTable(headers: string[], rows: string[][], emptyText = "_None._"): string {
  if (rows.length === 0) return emptyText;
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

/**
 * Renders a markdown bullet list, or "_None._" when `items` is empty.
 */
function renderList(items: string[], emptyText = "_None._"): string {
  if (items.length === 0) return emptyText;
  return items.map((item) => `- ${item}`).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Section renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the "Steering Refresh Summary" section: the combined before/after
 * always-loaded line count (Requirement 2.4/2.6), and, per document, its
 * before/after line count and the list of sections moved out of it
 * (Requirement 2.6, 1.4).
 */
function renderSteeringSection(steering: GovernanceReportInput["steering"]): string {
  const combinedDelta = steering.combinedLineCountBefore - steering.combinedLineCountAfter;
  const summaryLine = `Combined always-loaded line count: **${steering.combinedLineCountBefore} → ${steering.combinedLineCountAfter}** lines (Δ ${combinedDelta >= 0 ? "-" : "+"}${Math.abs(combinedDelta)}).`;

  const documentNames = Object.keys(steering.perDocument).sort();
  const rows = documentNames.map((doc) => {
    const entry = steering.perDocument[doc];
    if (entry === undefined) return [escapeCell(doc), "—", "—", "_None._"];
    const movedList = entry.sectionsMoved.length > 0 ? entry.sectionsMoved.map(escapeCell).join(", ") : "_None._";
    return [escapeCell(doc), String(entry.lineCountBefore), String(entry.lineCountAfter), movedList];
  });

  const table = renderTable(["Document", "Lines Before", "Lines After", "Sections Moved"], rows);

  return ["## Steering Refresh Summary", "", summaryLine, "", table].join("\n");
}

/**
 * Renders the "Service/Port Reconciliation" section: services added to the
 * documented registry (Requirement 3.1), ports added (Requirement 3.2), and
 * services left needing manual port assignment rather than an invented port
 * (Requirement 3.3).
 */
function renderServicePortSection(
  serviceReconciliation: GovernanceReportInput["serviceReconciliation"],
  portReconciliation: GovernanceReportInput["portReconciliation"]
): string {
  const addedServicesList = renderList(serviceReconciliation.added.map((service) => `\`${escapeCell(service)}\``));

  const addedPortsRows = portReconciliation.added.map((entry) => [`\`${escapeCell(entry.service)}\``, String(entry.port)]);
  const addedPortsTable = renderTable(["Service", "Port"], addedPortsRows);

  const needsManualList = renderList(portReconciliation.needsManualAssignment.map((service) => `\`${escapeCell(service)}\``));

  return [
    "## Service/Port Reconciliation",
    "",
    "### Services Added",
    "",
    addedServicesList,
    "",
    "### Ports Added",
    "",
    addedPortsTable,
    "",
    "### Needs Manual Port Assignment",
    "",
    needsManualList,
  ].join("\n");
}

/**
 * Renders the "Skills Audit" section: every Skill_File's action
 * (created/updated/unchanged) and the reason recorded for that action
 * (Requirement 4.5).
 */
function renderSkillsSection(skills: GovernanceReportInput["skills"]): string {
  const rows = skills.map((skill) => [`\`${escapeCell(skill.file)}\``, skill.action, escapeCell(skill.reason)]);
  const table = renderTable(["Skill File", "Action", "Reason"], rows);
  return ["## Skills Audit", "", table].join("\n");
}

/**
 * Renders the details cell for a single hook row: the corrections made if
 * `corrected`, the reasons flagged if `needs-manual-review`, or an em-dash
 * for `valid` (or any status with nothing to report).
 */
function renderHookDetails(hook: HookReportEntry): string {
  if (hook.status === "corrected" && hook.corrections !== undefined && hook.corrections.length > 0) {
    return escapeCell(hook.corrections.join("; "));
  }
  if (hook.status === "needs-manual-review" && hook.flaggedReasons !== undefined && hook.flaggedReasons.length > 0) {
    return escapeCell(hook.flaggedReasons.join("; "));
  }
  return "—";
}

/**
 * Renders the "Hook Validation" section: every Agent_Hook listed by name
 * with its final validation status (Requirement 8.2 — every hook appears
 * with exactly one of `valid`, `corrected`, `needs-manual-review`), one row
 * per entry in `hooks` (design Property 9's exactly-once guarantee — this
 * function renders exactly one table row per input entry, in the order
 * given, without deduplicating or fanning out).
 */
function renderHooksSection(hooks: GovernanceReportInput["hooks"]): string {
  const rows = hooks.map((hook) => [`\`${escapeCell(hook.file)}\``, hook.status, renderHookDetails(hook)]);
  const table = renderTable(["Hook File", "Status", "Details"], rows);
  return ["## Hook Validation", "", table].join("\n");
}

/**
 * Renders the "Spec Cross-References" section (Requirement 7.2): links out
 * to existing spec directories that recent governance changes relate to
 * (e.g. `meeting-service`, `tenant-platform-hardening`), each paired with a
 * short description of the relation. Deliberately renders only a link + one
 * line of reason per reference — never the referenced spec's own content —
 * so this section cannot become a duplicate of those specs (Requirement
 * 7.3's "SHALL NOT create a duplicate spec").
 */
function renderSpecCrossReferencesSection(specCrossReferences: SpecCrossReference[]): string {
  const items = specCrossReferences.map((ref) => `[${ref.spec}](${ref.spec}) — relates to: ${ref.relatedTo}`);
  const intro =
    "This governance refresh's changes relate to work already tracked in the following existing specs. " +
    "Their full content lives in their own spec directories and is intentionally not repeated here.";
  return ["## Spec Cross-References", "", intro, "", renderList(items)].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// renderGovernanceReport() — task 14.2
// _Requirements: 1.4, 2.6, 4.5, 7.2, 8.1, 8.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders a `GovernanceReportInput` snapshot into a single markdown
 * `Governance_Report` document (Requirement 8.1): steering line-count
 * before/after and moved sections (Requirements 1.4, 2.6), service/port
 * reconciliation results (Requirement 3), skill actions and reasons
 * (Requirement 4.5), hook statuses with exactly one entry per hook
 * (Requirement 8.2), and a spec cross-references section (Requirement 7.2).
 *
 * Pure function: no file I/O, no repo access, no non-determinism — the same
 * input always renders the same markdown text. This is what makes the
 * function directly property-testable (design Properties 8 and 9) rather
 * than requiring an end-to-end run against the real repo to verify.
 */
export function renderGovernanceReport(input: GovernanceReportInput): string {
  const sections = [
    "# Governance Report",
    "",
    "_Generated by `scripts/governance/governance-report.ts` for the `agent-context-governance-refresh` feature. " +
      "See [requirements](./requirements.md) and [design](./design.md) for the full specification this report satisfies._",
    "",
    renderSteeringSection(input.steering),
    "",
    renderServicePortSection(input.serviceReconciliation, input.portReconciliation),
    "",
    renderSkillsSection(input.skills),
    "",
    renderHooksSection(input.hooks),
    "",
    renderSpecCrossReferencesSection(input.specCrossReferences),
    "",
  ];
  return sections.join("\n");
}
