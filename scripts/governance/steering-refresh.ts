// scripts/governance/steering-refresh.ts
//
// Conditional Doc Writer — see design.md's "2. Conditional Doc Writer
// (scripts/governance/steering-refresh.ts)" component.
//
// Implements task 4.1 (`selectTrimmable()` + `moveSectionsToConditionalDoc()`)
// and task 4.2 (the concrete target-document writer for
// `.kiro/steering/point-in-time-metrics.md`).
//
// Design decision on purity (per task 4.1's instructions): `moveSectionsToConditionalDoc()`
// does NOT write to disk. It is a pure function from (sections + source document
// texts + target front-matter/header) to a `MoveResult` plus the updated document
// texts (source documents with the moved sections spliced out, and the target
// document text with them appended). This keeps it property-testable in isolation
// (tasks 4.3–4.5) without touching the filesystem. Actual file-writing to the real
// 4 always-loaded steering docs + the new conditional doc happens later, in task 18,
// once the full pipeline (reconciliation, skills, hooks, report) is wired up.
//
// Design decision on `MoveResult.document`/`lineCountBefore`/`lineCountAfter`: these
// describe the TARGET Conditional_Steering_Document (not the source documents the
// sections were removed from), since a single `moveSectionsToConditionalDoc()` call
// can relocate sections originating from multiple different source documents (e.g.
// task 18.1 moves sections from `tech.md`, `structure.md`, `quick-reference.md`, and
// `product.md` into one target doc in one call) — there is no single meaningful
// "the source document" for a singular `document` field in that case. Per-source-
// document before/after line counts (needed for Requirement 2.6 / Property 5) are
// derivable by the caller by comparing `sourceDocumentTexts[doc]` against
// `updatedSourceDocuments[doc]` in the returned `MoveSectionsResult`.

import { basename } from "node:path";
import type { ClassifiedSection } from "./steering-audit.js";

/**
 * `MoveResult` — kept identical in shape to design.md's Data Model. Describes
 * the target Conditional_Steering_Document's growth: which sections were
 * moved into it, and its line count immediately before and after the move.
 */
export interface MoveResult {
  document: string;
  sectionsMoved: { heading: string; lineCount: number }[];
  lineCountBefore: number;
  lineCountAfter: number;
}

/**
 * Full pure-function result of a `moveSectionsToConditionalDoc()` call:
 * the `MoveResult` metadata, the updated text of every source document a
 * moved section came from (with that section's lines removed), and the
 * updated text of the target document (with the sections appended verbatim).
 *
 * Nothing here is written to disk — callers (task 18's apply step) are
 * responsible for persisting `updatedSourceDocuments` and
 * `targetDocumentText` to the real files.
 */
export interface MoveSectionsResult {
  result: MoveResult;
  updatedSourceDocuments: Record<string, string>;
  targetDocumentText: string;
}

export interface TargetFrontMatter {
  inclusion: "fileMatch" | "manual";
  fileMatchPattern?: string;
}

export interface MoveSectionsOptions {
  /** Full current text of every source document a section in `sections` may
   * originate from, keyed by `ClassifiedSection.document` (e.g. "tech.md"). */
  sourceDocumentTexts: Record<string, string>;
  /** The target Conditional_Steering_Document's current full text, if it
   * already exists (e.g. a previous governance run already created it and
   * this run is adding more sections to it). Omit when creating the target
   * document for the first time. */
  existingTargetDocumentText?: string;
  /** Verbatim markdown (title + intro note, NOT including front matter) used
   * to seed a brand-new target document, immediately after its front-matter
   * block. Ignored when `existingTargetDocumentText` is provided. */
  targetDocumentHeader?: string;
}

/**
 * Returns exactly the sections classified `Stale_Content` from a
 * `ClassifiedSection[]` — the set of sections eligible for trimming per
 * Requirement 2.1. This is the function Property 1 (trim scope) targets.
 */
export function selectTrimmable(classified: ClassifiedSection[]): ClassifiedSection[] {
  return classified.filter((section) => section.classification === "Stale_Content");
}

function countLines(text: string): number {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\r?\n/).length;
}

/**
 * Removes the given sections' line ranges (`lineStart`..`lineEnd`, 1-indexed,
 * inclusive — as recorded by `parseSections()`, covering the heading line
 * through the section's last body line) from `documentText`, then collapses
 * any run of 2+ resulting blank lines down to a single blank line so the
 * source document doesn't accumulate whitespace gaps where sections used to
 * be. This never touches the *content* of any remaining line — only removes
 * the targeted sections' own lines and excess blank lines left behind.
 */
function removeSectionsFromDocument(documentText: string, sections: ClassifiedSection[]): string {
  const lines = documentText.split(/\r?\n/);
  const removedLineIndexes = new Set<number>();
  for (const section of sections) {
    for (let i = section.lineStart; i <= section.lineEnd; i++) {
      removedLineIndexes.add(i - 1); // 1-indexed -> 0-indexed
    }
  }

  const remaining = lines.filter((_line, idx) => !removedLineIndexes.has(idx));

  const collapsed: string[] = [];
  for (const line of remaining) {
    const isBlank = line.trim() === "";
    const previousIsBlank = collapsed.length > 0 && collapsed[collapsed.length - 1]?.trim() === "";
    if (isBlank && previousIsBlank) continue;
    collapsed.push(line);
  }

  return collapsed.join("\n");
}

/**
 * HTML-comment provenance marker prepended to every section moved into a
 * Conditional_Steering_Document, e.g. `<!-- governance:moved-from
 * document="tech.md" lines="12" -->`. This is what keeps the tool correctly
 * reporting a historical trim even on a later, idempotent re-run: once a
 * section is removed from its source document, that document alone no
 * longer carries any record of what left it or how big it was — the
 * provenance marker is the durable record of "this many lines came out of
 * this source document", so `run.ts` can reconstruct an accurate
 * before/after delta by reading the target document rather than only the
 * (already-trimmed) source documents.
 */
function renderProvenanceComment(section: ClassifiedSection): string {
  return `<!-- governance:moved-from document="${section.document}" lines="${section.lineCount}" -->`;
}

/**
 * Renders a section's heading + body back into verbatim markdown text —
 * exactly reconstructing the original lines `parseSections()` split out
 * (heading line, then body lines joined by "\n") — prefixed with a
 * provenance comment recording which source document and how many lines
 * this section came from, so relocation is both byte-identical (for the
 * heading/body themselves) and provenance-tracked.
 */
function renderSectionVerbatim(section: ClassifiedSection): string {
  const body = section.bodyText.length > 0 ? `${section.heading}\n${section.bodyText}` : section.heading;
  return `${renderProvenanceComment(section)}\n${body}`;
}

/**
 * Extracts moved-section provenance from an existing target
 * Conditional_Steering_Document's text: for each `governance:moved-from`
 * comment found, the source `document` name, the `lines` count recorded at
 * move time, and the heading text of the section that immediately follows
 * the comment (the next non-blank line, expected to be a "##" heading per
 * `renderSectionVerbatim`'s output shape). Used by `run.ts` to reconstruct
 * a historically-accurate before/after line count *and* moved-section list
 * for a source document even after a later run finds nothing left in that
 * document to trim (the idempotent re-run case).
 */
export function extractMovedProvenance(
  targetDocumentText: string
): { document: string; lineCount: number; heading: string }[] {
  const lines = targetDocumentText.split(/\r?\n/);
  const PROVENANCE_LINE_RE = /^<!--\s*governance:moved-from\s+document="([^"]+)"\s+lines="(\d+)"\s*-->$/;
  const results: { document: string; lineCount: number; heading: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = PROVENANCE_LINE_RE.exec(lines[i] ?? "");
    if (match === null) continue;
    const document = match[1];
    const lineCountRaw = match[2];
    if (document === undefined || lineCountRaw === undefined) continue;

    let heading = "";
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j] ?? "";
      if (candidate.trim().length === 0) continue;
      heading = candidate;
      break;
    }

    results.push({ document, lineCount: Number(lineCountRaw), heading });
  }

  return results;
}

function renderFrontMatter(frontMatter: TargetFrontMatter): string {
  const lines = ["---", `inclusion: ${frontMatter.inclusion}`];
  if (frontMatter.inclusion === "fileMatch" && frontMatter.fileMatchPattern) {
    lines.push(`fileMatchPattern: "${frontMatter.fileMatchPattern}"`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Appends `sections` (rendered verbatim) to `existingText`, separating each
 * block with a single blank line. `existingText` may already end with a
 * moved section (subsequent call) or be a freshly-seeded skeleton
 * (front matter + header, no sections yet).
 */
function appendSectionsToTarget(existingText: string, sections: ClassifiedSection[]): string {
  const blocks = sections.map(renderSectionVerbatim);
  const trimmedExisting = existingText.replace(/\s+$/, "");
  const parts = trimmedExisting.length > 0 ? [trimmedExisting, ...blocks] : blocks;
  return `${parts.join("\n\n")}\n`;
}

/**
 * Performs a verbatim (byte-identical) relocation of `sections`' heading +
 * body text out of their source document(s) and into a target
 * Conditional_Steering_Document.
 *
 * Pure function — reads only from `options.sourceDocumentTexts` /
 * `options.existingTargetDocumentText`, writes nothing to disk. Returns the
 * `MoveResult` (target document's before/after line count + moved section
 * headings) alongside the full updated text of every affected document, for
 * the caller to persist.
 *
 * @throws if a section's `document` has no corresponding entry in
 *   `options.sourceDocumentTexts` — callers must supply the current text of
 *   every source document referenced by `sections`.
 */
export function moveSectionsToConditionalDoc(
  sections: ClassifiedSection[],
  targetDocPath: string,
  targetFrontMatter: TargetFrontMatter,
  options: MoveSectionsOptions
): MoveSectionsResult {
  const { sourceDocumentTexts, existingTargetDocumentText, targetDocumentHeader } = options;

  // Group sections by their originating source document so each source
  // document's text can be updated independently of the others.
  const byDocument = new Map<string, ClassifiedSection[]>();
  for (const section of sections) {
    const list = byDocument.get(section.document) ?? [];
    list.push(section);
    byDocument.set(section.document, list);
  }

  const updatedSourceDocuments: Record<string, string> = {};
  for (const [documentName, documentSections] of byDocument) {
    const originalText = sourceDocumentTexts[documentName];
    if (originalText === undefined) {
      throw new Error(
        `moveSectionsToConditionalDoc: no source text provided for document "${documentName}" ` +
          `referenced by section "${documentSections[0]?.heading ?? "<unknown>"}"`
      );
    }
    updatedSourceDocuments[documentName] = removeSectionsFromDocument(originalText, documentSections);
  }

  // Seed the target document (front matter + optional header) if it doesn't
  // already exist; otherwise extend the existing text as-is (no re-adding
  // front matter/header on subsequent calls).
  const seedText =
    existingTargetDocumentText ??
    [renderFrontMatter(targetFrontMatter), targetDocumentHeader ?? ""].filter((part) => part.length > 0).join("\n\n");

  const lineCountBefore = countLines(seedText);
  const targetDocumentText = appendSectionsToTarget(seedText, sections);
  const lineCountAfter = countLines(targetDocumentText);

  const result: MoveResult = {
    document: basename(targetDocPath),
    sectionsMoved: sections.map((section) => ({ heading: section.heading, lineCount: section.lineCount })),
    lineCountBefore,
    lineCountAfter,
  };

  return { result, updatedSourceDocuments, targetDocumentText };
}

// ─────────────────────────────────────────────────────────────────────────────
// Concrete target-document writer: `.kiro/steering/point-in-time-metrics.md`
// (task 4.2).
//
// Follows `code-patterns.md`'s front-matter shape:
//
//   ---
//   inclusion: fileMatch
//   fileMatchPattern: "services/**/*.ts,apps/web/**/*.tsx,apps/web/**/*.ts"
//   ---
//
// but with `inclusion: manual` (no `fileMatchPattern`) since these sections
// aren't tied to any file pattern — they're informational snapshots loaded
// on deliberate request, per design.md's rationale.
// ─────────────────────────────────────────────────────────────────────────────

export const POINT_IN_TIME_METRICS_DOC_PATH = ".kiro/steering/point-in-time-metrics.md";

export const POINT_IN_TIME_METRICS_FRONT_MATTER: TargetFrontMatter = {
  inclusion: "manual",
};

export const POINT_IN_TIME_METRICS_HEADER = [
  "# CivitasOne — Point-in-Time Metrics (Load on Request)",
  "",
  "> Snapshot data. Not enforced. Verify against live systems (Grafana, " +
    "`pnpm --filter <service> exec vitest run --coverage`, " +
    "`git log --oneline services/<service>/migrations`) before relying on any number here.",
].join("\n");

/**
 * Relocates `sections` into the concrete `.kiro/steering/point-in-time-metrics.md`
 * Conditional_Steering_Document, using its fixed `inclusion: manual`
 * front-matter and intro header. Thin wrapper over `moveSectionsToConditionalDoc()`
 * — still a pure function, writes nothing to disk.
 */
export function writePointInTimeMetricsDocument(
  sections: ClassifiedSection[],
  sourceDocumentTexts: Record<string, string>,
  existingTargetDocumentText?: string
): MoveSectionsResult {
  const options: MoveSectionsOptions =
    existingTargetDocumentText === undefined
      ? { sourceDocumentTexts, targetDocumentHeader: POINT_IN_TIME_METRICS_HEADER }
      : { sourceDocumentTexts, existingTargetDocumentText, targetDocumentHeader: POINT_IN_TIME_METRICS_HEADER };
  return moveSectionsToConditionalDoc(sections, POINT_IN_TIME_METRICS_DOC_PATH, POINT_IN_TIME_METRICS_FRONT_MATTER, options);
}
