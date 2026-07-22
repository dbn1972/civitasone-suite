// scripts/governance/steering-audit.ts
//
// Steering Section Parser & Classifier — see design.md's
// "1. Steering Section Parser & Classifier (scripts/governance/steering-audit.ts)"
// component.
//
// This file currently implements only `parseSections()` (task 2.1).
// `classifySection()` and `auditSteeringDocuments()` are implemented in a
// later task (2.2) and are intentionally NOT present here yet.

/**
 * A single section of a Steering_Document, split by its "##" (level 2)
 * heading.
 */
export interface SteeringSection {
  document: string; // "tech.md", "structure.md", etc.
  heading: string; // "## Performance Budget (Targets vs Actuals)"
  level: number; // heading depth (2 = "##")
  lineStart: number; // 1-indexed, the heading's own line
  lineEnd: number; // 1-indexed, inclusive, last line of the section
  lineCount: number; // lineEnd - lineStart + 1
  bodyText: string; // raw markdown body under the heading (heading line excluded)
}

const FENCE_RE = /^(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+/;

/**
 * Splits a markdown document into `SteeringSection[]`, one entry per "##"
 * (level 2) heading.
 *
 * Design decision (documented here per task 2.1's instructions): every
 * Always_Loaded_Steering_Document in this repo today is structured as a
 * single level-1 ("#") document title followed by a flat list of level-2
 * ("##") sections — none of the 4 documents nest a "###" heading under a
 * "##" section. Given that, this parser:
 *
 *   - Treats ONLY "##" headings as section-starting boundaries.
 *   - Ends a section at the line before the next heading whose level is
 *     "same or higher" than level 2 — i.e. the next "#" or "##" line — or at
 *     EOF if there is none.
 *   - Deliberately SKIPS the content before the first "##" heading (the
 *     level-1 title line and anything between it and the first "##"). That
 *     preamble carries no independently governed content of its own in any
 *     of the real documents, so emitting it as a pseudo-section with an
 *     empty/synthetic heading would not be meaningful for classification
 *     (task 2.2) or trimming (task 4). If a document ever introduces content
 *     before its first "##" heading that needs auditing, that is a decision
 *     to revisit explicitly rather than something this parser should guess.
 *   - If a "###"+ (level 3 or deeper) heading ever appears, it is NOT split
 *     out as its own section — it stays inside the enclosing "##" section's
 *     `bodyText`, since level 3+ headings don't terminate a level-2 section
 *     (only "same or higher level" — i.e. level 1 or 2 — headings do).
 *
 * Headings inside fenced code blocks (``` or ~~~) are ignored, since several
 * steering docs contain shell comment lines (e.g. "# Single service" inside
 * a ```bash block) that would otherwise be misdetected as markdown headings.
 */
export function parseSections(markdown: string, documentName: string): SteeringSection[] {
  const lines = markdown.split(/\r?\n/);

  const headingLines: { index: number; level: number }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = HEADING_RE.exec(line);
    if (match && match[1] !== undefined) {
      headingLines.push({ index: i, level: match[1].length });
    }
  }

  const sections: SteeringSection[] = [];

  for (let h = 0; h < headingLines.length; h++) {
    const current = headingLines[h];
    if (current === undefined || current.level !== 2) continue; // only "##" headings start a section
    const { index, level } = current;

    // Find the next "same or higher level" heading (level 1 or 2) after this
    // one; the section runs up to the line before it, or to EOF.
    let endIndex = lines.length - 1;
    for (let j = h + 1; j < headingLines.length; j++) {
      const next = headingLines[j];
      if (next !== undefined && next.level <= 2) {
        endIndex = next.index - 1;
        break;
      }
    }

    const heading = lines[index] ?? "";
    const bodyText = lines.slice(index + 1, endIndex + 1).join("\n");

    sections.push({
      document: documentName,
      heading,
      level,
      lineStart: index + 1,
      lineEnd: endIndex + 1,
      lineCount: endIndex - index + 1,
      bodyText,
    });
  }

  return sections;
}

// ─────────────────────────────────────────────────────────────────────────────
// classifySection() / auditSteeringDocuments() — task 2.2.
//
// See design.md's "1. Steering Section Parser & Classifier" component for the
// four deterministic classification rules, checked in this order:
//   1. Stale_Content            — point-in-time metric/count/status table
//   2. duplicate-of-another-section — cross-document near-duplicate
//   3. reference-detail-not-frequently-needed — lookup/reference material
//   4. Enforceable_Rule         — imperative-marker fallback (guarantees
//                                 every section receives exactly one label)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { basename } from "node:path";

export type Classification =
  | "Enforceable_Rule"
  | "Stale_Content"
  | "duplicate-of-another-section"
  | "reference-detail-not-frequently-needed";

export interface ClassifiedSection extends SteeringSection {
  classification: Classification;
  // populated only when classification === "duplicate-of-another-section"
  duplicateOf?: { document: string; heading: string }[];
  // populated only when classification === "Stale_Content"
  staleReason?: "point-in-time-metric" | "status-table" | "last-verified-date";
}

// ── Rule 1: Stale_Content ───────────────────────────────────────────────────

// Matches the heading/column-name keywords called out by design.md and
// Requirement 2.1's worked examples: "Performance Budget (Targets vs
// Actuals)", "Security Posture & Compliance" ("Last Verified" column),
// "Service Maturity" ("Tier"/"test count" columns), "Migration Count".
// Kept broad (includes "status", "tier", "test count") for use against a
// *table's header row*, where those words reliably signal a point-in-time
// snapshot column. Deliberately NOT used against section headings — see
// HEADING_STALE_RE below, which is narrower.
const STALE_KEYWORD_RE = /actual|status|last verified|migration count|maturity|tier|test count/i;

// Narrower than STALE_KEYWORD_RE: applied directly to section *heading* text
// (not table contents). "status" and "tier" are excluded here because they
// occur in ordinary enforceable/reference headings unrelated to point-in-time
// metrics (e.g. "Support Tiers", "API Versioning & Deprecation" has a
// "Status" column but isn't itself about status). Only these three keywords,
// found directly in a heading, reliably indicate a point-in-time snapshot
// section per design.md's worked examples ("Performance Budget (Targets vs
// Actuals)", "Service Maturity (July 2026)", "Migration Count (July 2026)").
const HEADING_STALE_RE = /actual|migration count|maturity|last verified/i;

const TABLE_SEPARATOR_RE = /^\|?[\s:|-]+\|?$/;

// Matches a full-line HTML comment (e.g. the `governance:moved-from`
// provenance markers steering-refresh.ts prepends to relocated sections).
// Comment lines carry no classification-relevant content and must never
// count as "non-table body content" when measuring how table-dominated a
// section's body is — otherwise a provenance comment sitting at the tail
// end of one section's body (immediately before the next section's
// heading, since it isn't itself a heading) would dilute that *preceding*
// section's table ratio and could flip its classification after a
// relocation round-trip, which is not a real change in the content.
const HTML_COMMENT_LINE_RE = /^<!--.*-->$/;

/** Strips full-line HTML comments before measuring body composition. */
function stripCommentLines(bodyText: string): string {
  return bodyText
    .split(/\r?\n/)
    .filter((line) => !HTML_COMMENT_LINE_RE.test(line.trim()))
    .join("\n");
}

/**
 * Returns the header-row line(s) of every markdown table in `bodyText` — a
 * "|"-prefixed line that is immediately followed by a "|---|---|"-style
 * separator line. Used to inspect column names without over-matching on
 * ordinary data rows.
 */
function extractTableHeaderLines(bodyText: string): string[] {
  const lines = bodyText.split(/\r?\n/);
  const headerLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("|")) continue;
    const next = (lines[i + 1] ?? "").trim();
    if (TABLE_SEPARATOR_RE.test(next) && next.includes("-")) {
      headerLines.push(line);
    }
  }
  return headerLines;
}

/**
 * True when a markdown table occupies at least half of a section's non-blank
 * lines. Used to gate the table-column-name Stale_Content check so a section
 * that merely *contains* a small table alongside substantial prose (e.g.
 * "API Versioning & Deprecation", whose table is a 2-row versioning policy
 * followed by a multi-step deprecation process description) isn't classified
 * as a point-in-time-metric snapshot just because one column happens to be
 * named "Status". A section genuinely "dominated by a markdown table" (per
 * design.md's rule 1 wording) is the actual trigger — table headers on their
 * own are not sufficient.
 */
function isTableDominatedBody(bodyText: string): boolean {
  const lines = stripCommentLines(bodyText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;

  const tableLines = lines.filter((line) => line.startsWith("|"));
  return tableLines.length / lines.length >= 0.5;
}

/**
 * Rule 1 detector. Checks, in order:
 *   (a) the section heading itself against STALE_KEYWORD_RE (catches
 *       "Performance Budget (Targets vs Actuals)", "Service Maturity",
 *       "Migration Count" — none of which require inspecting a table at all;
 *       "Migration Count (July 2026)" in quick-reference.md is plain text,
 *       not a table, so heading-based detection is required for it).
 *   (b) each table header-row against STALE_KEYWORD_RE (catches "Security
 *       Posture & Compliance"'s "Last Verified" column, and "Current Phase"'s
 *       "Status" column).
 *   (c) a "Target" column paired with an "Actual"/"Current"/"Status" column
 *       in the same header row — the general "targets vs actuals" snapshot
 *       shape (catches "Success Metrics (V1 Launch)"'s "KPI | Target |
 *       Current" header, which doesn't literally contain any STALE_KEYWORD_RE
 *       token but is the same kind of point-in-time snapshot as Performance
 *       Budget).
 */
type StaleReason = "point-in-time-metric" | "status-table" | "last-verified-date";

function detectStaleContent(
  heading: string,
  bodyText: string
): { match: true; staleReason: StaleReason } | { match: false } {
  const headingText = heading.replace(/^#+\s*/, "");

  if (HEADING_STALE_RE.test(headingText)) {
    return {
      match: true,
      staleReason: /last verified/i.test(headingText) ? "last-verified-date" : "point-in-time-metric",
    };
  }

  // Table-column-name checks only apply when the table dominates the section
  // body (see isTableDominatedBody) — a section that merely contains a small
  // table alongside substantial enforceable prose (e.g. "API Versioning &
  // Deprecation") is not a point-in-time-metric snapshot just because one
  // column happens to be named "Status".
  //
  // Deliberately more targeted than a blanket STALE_KEYWORD_RE match against
  // the header line: a bare "Status" column (e.g. "Compliance &
  // Certifications"'s "Standard | Status | Notes", "Support Tiers"'s
  // "Tier | SLA | Channel", "API Versioning & Deprecation"'s "Version |
  // Status | Deprecation Date | Removal Date") does not by itself indicate a
  // point-in-time metric snapshot — those are reference/enforceable tables
  // that happen to have a status-like column. Only the specific combinations
  // below (verified against design.md's curated Stale_Content list) fire.
  if (isTableDominatedBody(bodyText)) {
    for (const headerLine of extractTableHeaderLines(bodyText)) {
      if (/last verified/i.test(headerLine)) {
        return { match: true, staleReason: "last-verified-date" };
      }
      if (/\bactual\b/i.test(headerLine)) {
        // "Performance Budget (Targets vs Actuals)"'s "Target | Actual (Staging) | Status" column.
        return { match: true, staleReason: "point-in-time-metric" };
      }
      if (/\btarget\b/i.test(headerLine) && /\bcurrent\b/i.test(headerLine)) {
        // "Success Metrics (V1 Launch)"'s "KPI | Target | Current" column — same shape as
        // Performance Budget's targets-vs-actuals table but using "Current" instead of "Actual".
        return { match: true, staleReason: "point-in-time-metric" };
      }
      if (/\bstatus\b/i.test(headerLine) && /\bmetric\b/i.test(headerLine)) {
        // "Current Phase"'s "Area | Status | Metric" column — a KPI-status snapshot table,
        // distinguished from a generic status column (e.g. Compliance & Certifications,
        // API Versioning & Deprecation) by pairing "Status" with a "Metric" column.
        return { match: true, staleReason: "status-table" };
      }
      if (/migration count|test count/i.test(headerLine)) {
        return { match: true, staleReason: "point-in-time-metric" };
      }
    }
  }

  return { match: false };
}

// ── Rule 2: duplicate-of-another-section ────────────────────────────────────

const DUPLICATE_OVERLAP_THRESHOLD = 0.9;

function normalizeBodyText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenize(text: string): string[] {
  return normalizeBodyText(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Directional token-overlap ratio: the fraction of the *smaller* section's
 * unique tokens that also appear in the other section. Using the smaller
 * set's size as the denominator (rather than the union, as in a strict
 * Jaccard index) means a short section fully contained in a longer one still
 * registers as a near-duplicate, which matches design.md's "≥90% normalized
 * token overlap" framing for detecting one section repeated inside another.
 */
function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return shared / Math.min(tokensA.size, tokensB.size);
}

/** Strips heading markers, parenthetical qualifiers, and punctuation so that
 * e.g. "## Service Maturity (July 2026)" and "## Service Maturity (2026)"
 * would be recognized as "near-identical heading text". */
function normalizeHeadingText(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s]/gi, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Rule 2 detector: finds every section in a *different* document that either
 * shares a near-identical heading with `section`, or whose body text has
 * ≥90% directional token overlap with `section`'s body text.
 */
function findDuplicates(
  section: SteeringSection,
  allSections: SteeringSection[]
): { document: string; heading: string }[] {
  const ownNormalizedHeading = normalizeHeadingText(section.heading);
  const duplicates: { document: string; heading: string }[] = [];

  for (const other of allSections) {
    if (other.document === section.document) continue; // only cross-document duplicates count

    const headingMatches = ownNormalizedHeading.length > 0 && normalizeHeadingText(other.heading) === ownNormalizedHeading;
    const overlapMatches = tokenOverlapRatio(section.bodyText, other.bodyText) >= DUPLICATE_OVERLAP_THRESHOLD;

    if (headingMatches || overlapMatches) {
      duplicates.push({ document: other.document, heading: other.heading });
    }
  }

  return duplicates;
}

// ── Rule 3: reference-detail-not-frequently-needed ──────────────────────────

// Catches design.md's named examples directly by heading: "Shared Packages
// (Reference)", "Compliance Mapping", "DS Components Available".
const REFERENCE_HEADING_RE = /\(reference\)|mapping|available/i;

const IMPERATIVE_MARKER_RE = /\bmust\b|\bmandatory\b|\bshall\b|\bnever\b|do not|\(enforced\)|\(ci-enforced\)/i;

function hasImperativeMarker(heading: string, bodyText: string): boolean {
  return IMPERATIVE_MARKER_RE.test(heading) || IMPERATIVE_MARKER_RE.test(bodyText);
}

/**
 * Rule 3 detector: a section is reference-detail-not-frequently-needed if its
 * heading explicitly marks it as reference/lookup material, or if its body is
 * dominated by a lookup table with no imperative/normative language.
 */
function isReferenceDetail(section: SteeringSection): boolean {
  const headingText = section.heading.replace(/^#+\s*/, "");
  if (REFERENCE_HEADING_RE.test(headingText)) return true;

  return isTableDominatedBody(section.bodyText) && !hasImperativeMarker(section.heading, section.bodyText);
}

// ── classifySection() ────────────────────────────────────────────────────────

/**
 * Classifies a single `SteeringSection` into exactly one `Classification`,
 * applying the four rules in order (Stale_Content → duplicate-of-another-
 * section → reference-detail-not-frequently-needed → Enforceable_Rule). Rule
 * 4 is the unconditional fallback, so every section — real or synthetic —
 * always receives exactly one classification.
 */
export function classifySection(section: SteeringSection, allSections: SteeringSection[]): ClassifiedSection {
  const stale = detectStaleContent(section.heading, section.bodyText);
  if (stale.match) {
    return { ...section, classification: "Stale_Content", staleReason: stale.staleReason };
  }

  const duplicates = findDuplicates(section, allSections);
  if (duplicates.length > 0) {
    return { ...section, classification: "duplicate-of-another-section", duplicateOf: duplicates };
  }

  if (isReferenceDetail(section)) {
    return { ...section, classification: "reference-detail-not-frequently-needed" };
  }

  return { ...section, classification: "Enforceable_Rule" };
}

// ── auditSteeringDocuments() ─────────────────────────────────────────────────

/**
 * Runs `parseSections` + `classifySection` across every document at `paths`,
 * returning a per-document inventory (pre-change line count + classified
 * sections) plus the combined pre-change line count across all documents.
 * Classification is computed with full cross-document visibility: every
 * document's sections are parsed first, then each section is classified
 * against the complete `allSections` list so Rule 2 (duplicate detection)
 * can see sections in every other document, not just the ones parsed so far.
 */
export function auditSteeringDocuments(paths: string[]): {
  perDocument: Record<string, { lineCountBefore: number; sections: ClassifiedSection[] }>;
  combinedLineCountBefore: number;
} {
  const documents = paths.map((path) => {
    const documentName = basename(path);
    const markdown = readFileSync(path, "utf8");
    const lineCountBefore = markdown.split(/\r?\n/).length;
    const sections = parseSections(markdown, documentName);
    return { documentName, lineCountBefore, sections };
  });

  const allSections: SteeringSection[] = documents.flatMap((doc) => doc.sections);

  const perDocument: Record<string, { lineCountBefore: number; sections: ClassifiedSection[] }> = {};
  let combinedLineCountBefore = 0;

  for (const doc of documents) {
    perDocument[doc.documentName] = {
      lineCountBefore: doc.lineCountBefore,
      sections: doc.sections.map((section) => classifySection(section, allSections)),
    };
    combinedLineCountBefore += doc.lineCountBefore;
  }

  return { perDocument, combinedLineCountBefore };
}
