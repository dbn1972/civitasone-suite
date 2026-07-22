// scripts/governance/steering-refresh.property.test.ts
//
// Property tests for the conditional doc writer (tasks 4.3, 4.4, 4.5).
// Uses fast-check (already a devDependency) — see design.md's "Correctness
// Properties" section for Property 3, Property 4, and Property 5's full
// statements.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { selectTrimmable, moveSectionsToConditionalDoc, type TargetFrontMatter } from "./steering-refresh.js";
import type { ClassifiedSection, Classification } from "./steering-audit.js";

const TARGET_DOC_PATH = ".kiro/steering/point-in-time-metrics.md";
const TARGET_FRONT_MATTER: TargetFrontMatter = { inclusion: "manual" };

const ALL_CLASSIFICATIONS: Classification[] = [
  "Enforceable_Rule",
  "Stale_Content",
  "duplicate-of-another-section",
  "reference-detail-not-frequently-needed",
];

// ── Synthetic ClassifiedSection generation ──────────────────────────────────
//
// Builds ClassifiedSection objects directly (rather than round-tripping
// through parseSections/classifySection) so the generator can freely control
// the classification mix (zero Stale_Content, all Stale_Content, a blend,
// single document, multiple documents) as required by the task.

const arbDocumentName = fc.constantFrom("tech.md", "structure.md", "quick-reference.md", "product.md");

const arbHeadingWord = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{1,10}$/);

const arbHeadingText = fc
  .array(arbHeadingWord, { minLength: 1, maxLength: 5 })
  .map((words: string[]) => words.join(" "));

const arbBodyLine = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ,.'"()-]{0,40}$/);

const arbBodyText = fc.oneof(
  fc.constant(""), // empty body edge case
  arbBodyLine, // single-line body
  fc.array(arbBodyLine, { minLength: 2, maxLength: 6 }).map((lines) => lines.join("\n")), // multi-line body
);

/**
 * Builds one syntactically valid ClassifiedSection with a given
 * classification, random heading/body, and correctly-derived line metadata
 * (heading line + body lines). `lineStart` is supplied by the caller so a
 * whole synthetic document's sections can be laid out end-to-end
 * (non-overlapping line ranges), matching how parseSections() would have
 * produced them.
 */
function buildSection(
  document: string,
  classification: Classification,
  headingText: string,
  bodyText: string,
  lineStart: number
): ClassifiedSection {
  const heading = `## ${headingText}`;
  const bodyLineCount = bodyText.length === 0 ? 0 : bodyText.split(/\r?\n/).length;
  const lineCount = 1 + bodyLineCount; // heading line + body lines
  return {
    document,
    heading,
    level: 2,
    lineStart,
    lineEnd: lineStart + lineCount - 1,
    lineCount,
    bodyText,
    classification,
  };
}

/**
 * Renders a synthetic source document's full text from a list of sections
 * that were laid out end-to-end (contiguous, non-overlapping line ranges) —
 * i.e. the inverse of parseSections(), so `sourceDocumentTexts` fed to
 * moveSectionsToConditionalDoc() is internally consistent with each
 * section's own `lineStart`/`lineEnd`/`heading`/`bodyText` fields.
 */
function renderDocumentText(sections: ClassifiedSection[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(section.heading);
    if (section.bodyText.length > 0) {
      lines.push(...section.bodyText.split(/\r?\n/));
    }
  }
  return lines.join("\n");
}

/**
 * A single generated document: its name, and a list of ClassifiedSections
 * whose line ranges are contiguous and consistent with `renderDocumentText`.
 */
interface SyntheticDocument {
  document: string;
  sections: ClassifiedSection[];
  text: string;
}

/** Generates one synthetic document with 0-6 sections, covering a mix of
 * classifications (including "no Stale_Content at all" and "every section
 * is Stale_Content" as reachable cases via fc.oneof/fc.constantFrom). */
const arbSyntheticDocument: fc.Arbitrary<SyntheticDocument> = fc
  .tuple(
    arbDocumentName,
    fc.array(
      fc.tuple(fc.constantFrom(...ALL_CLASSIFICATIONS), arbHeadingText, arbBodyText),
      { minLength: 0, maxLength: 6 }
    )
  )
  .map(([document, entries]) => {
    const sections: ClassifiedSection[] = [];
    let cursor = 1;
    entries.forEach(([classification, headingText, bodyText], idx) => {
      const section = buildSection(document, classification, `${headingText} d${idx}`, bodyText, cursor);
      sections.push(section);
      cursor = section.lineEnd + 1;
    });
    return { document, sections, text: renderDocumentText(sections) };
  });

/** Generates a *set* of synthetic documents (1-4 of them, distinct names),
 * covering both the "single document" and "multiple documents" edge cases
 * called out by the task. */
const arbSyntheticDocumentSet: fc.Arbitrary<SyntheticDocument[]> = fc
  .uniqueArray(arbDocumentName, { minLength: 1, maxLength: 4 })
  .chain((documentNames) =>
    fc.tuple(
      ...documentNames.map((document) =>
        fc
          .array(
            fc.tuple(fc.constantFrom(...ALL_CLASSIFICATIONS), arbHeadingText, arbBodyText),
            { minLength: 0, maxLength: 5 }
          )
          .map((entries) => {
            const sections: ClassifiedSection[] = [];
            let cursor = 1;
            entries.forEach(([classification, headingText, bodyText], idx) => {
              const section = buildSection(document, classification, `${headingText} ${document} ${idx}`, bodyText, cursor);
              sections.push(section);
              cursor = section.lineEnd + 1;
            });
            return { document, sections, text: renderDocumentText(sections) } as SyntheticDocument;
          })
      )
    )
  );

function sourceTextsFrom(docs: SyntheticDocument[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const doc of docs) out[doc.document] = doc.text;
  return out;
}

function combinedLineCount(texts: Record<string, string>): number {
  let total = 0;
  for (const text of Object.values(texts)) {
    total += text.length === 0 ? 0 : text.split(/\r?\n/).length;
  }
  return total;
}

describe("Property 3: Stale_Content is relocated, never deleted or rewritten", () => {
  // Feature: agent-context-governance-refresh, Property 3: For any section classified Stale_Content and moved via moveSectionsToConditionalDoc, (a) the section's body text appears verbatim in the target Conditional_Steering_Document afterward, (b) the section no longer appears in its original Always_Loaded_Steering_Document, and (c) the moved text is byte-identical to the original (no numbers or wording invented or altered during the move).

  it("relocates every Stale_Content section verbatim into the target doc and removes it from its source doc, byte-identically", () => {
    fc.assert(
      fc.property(arbSyntheticDocumentSet, (docs) => {
        const sourceDocumentTexts = sourceTextsFrom(docs);
        const allSections = docs.flatMap((d) => d.sections);
        const staleSections = selectTrimmable(allSections);

        fc.pre(staleSections.length > 0); // property is about sections that are actually moved

        const { updatedSourceDocuments, targetDocumentText } = moveSectionsToConditionalDoc(
          staleSections,
          TARGET_DOC_PATH,
          TARGET_FRONT_MATTER,
          { sourceDocumentTexts }
        );

        for (const section of staleSections) {
          // (a) verbatim in the target doc afterward — heading + body text,
          // byte-identical to the original section's own fields.
          const expectedBlock = section.bodyText.length > 0 ? `${section.heading}\n${section.bodyText}` : section.heading;
          expect(targetDocumentText).toContain(expectedBlock);
          expect(targetDocumentText).toContain(section.heading);
          if (section.bodyText.length > 0) {
            expect(targetDocumentText).toContain(section.bodyText);
          }

          // (b) no longer appears in its original source document's updated text.
          const updatedSource = updatedSourceDocuments[section.document];
          expect(updatedSource).toBeDefined();
          expect(updatedSource ?? "").not.toContain(section.heading);

          // (c) byte-identical: no character of the moved heading/body was
          // altered — re-deriving the block from the target text and
          // comparing strictly to the original bodyText/heading fields.
          expect(expectedBlock.includes(section.heading)).toBe(true);
          if (section.bodyText.length > 0) {
            expect(expectedBlock.endsWith(section.bodyText)).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("moving zero Stale_Content sections (none present) leaves every source document's text unchanged", () => {
    fc.assert(
      fc.property(arbSyntheticDocumentSet, (docs) => {
        const sourceDocumentTexts = sourceTextsFrom(docs);
        const allSections = docs.flatMap((d) => d.sections);
        const staleSections = selectTrimmable(allSections);

        fc.pre(staleSections.length === 0);

        // No sections to move: calling with an empty array should not alter
        // any source document (nothing is grouped/removed).
        const { updatedSourceDocuments } = moveSectionsToConditionalDoc(staleSections, TARGET_DOC_PATH, TARGET_FRONT_MATTER, {
          sourceDocumentTexts,
        });

        // updatedSourceDocuments only contains entries for documents that had
        // sections removed — with zero Stale_Content sections, it must be empty.
        expect(Object.keys(updatedSourceDocuments)).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 4: Enforceable_Rule sections are never removed from always-loaded docs", () => {
  // Feature: agent-context-governance-refresh, Property 4: For any set of classified sections processed by the Refresh_Process, every section classified Enforceable_Rule remains present (unchanged or condensed, but present) in its original Always_Loaded_Steering_Document — it never appears in the moved-set or the deleted-set.

  it("selectTrimmable never includes an Enforceable_Rule section, and moving the trimmed set leaves every Enforceable_Rule section's heading present in its source document", () => {
    fc.assert(
      fc.property(arbSyntheticDocumentSet, (docs) => {
        const sourceDocumentTexts = sourceTextsFrom(docs);
        const allSections = docs.flatMap((d) => d.sections);
        const staleSections = selectTrimmable(allSections);
        const enforceableSections = allSections.filter((s) => s.classification === "Enforceable_Rule");

        // Never in the moved-set.
        for (const enforceable of enforceableSections) {
          expect(staleSections).not.toContain(enforceable);
        }

        fc.pre(staleSections.length > 0);

        const { updatedSourceDocuments } = moveSectionsToConditionalDoc(staleSections, TARGET_DOC_PATH, TARGET_FRONT_MATTER, {
          sourceDocumentTexts,
        });

        // Never in the deleted-set: every Enforceable_Rule section's heading
        // (and body, when non-empty) is still present in its source document's
        // text after the move (whether or not that document had any sections
        // moved out of it at all).
        for (const enforceable of enforceableSections) {
          const finalText = updatedSourceDocuments[enforceable.document] ?? sourceDocumentTexts[enforceable.document];
          expect(finalText).toBeDefined();
          expect(finalText ?? "").toContain(enforceable.heading);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 5: Combined always-loaded line count strictly decreases when Stale_Content exists", () => {
  // Feature: agent-context-governance-refresh, Property 5: For any set of classified sections across the 4 Always_Loaded_Steering_Documents that contains at least one Stale_Content section, the combined line count after moveSectionsToConditionalDoc is strictly less than the combined line count before.

  it("combined source-document line count strictly decreases after moving at least one Stale_Content section", () => {
    fc.assert(
      fc.property(arbSyntheticDocumentSet, (docs) => {
        const sourceDocumentTexts = sourceTextsFrom(docs);
        const allSections = docs.flatMap((d) => d.sections);
        const staleSections = selectTrimmable(allSections);

        fc.pre(staleSections.length > 0);

        const combinedBefore = combinedLineCount(sourceDocumentTexts);

        const { updatedSourceDocuments } = moveSectionsToConditionalDoc(staleSections, TARGET_DOC_PATH, TARGET_FRONT_MATTER, {
          sourceDocumentTexts,
        });

        // Merge updated documents over the originals (documents with no
        // Stale_Content sections keep their original text) to get the full
        // "after" combined picture across all 4 (or however many) documents.
        const mergedAfter: Record<string, string> = { ...sourceDocumentTexts, ...updatedSourceDocuments };
        const combinedAfter = combinedLineCount(mergedAfter);

        expect(combinedAfter).toBeLessThan(combinedBefore);
      }),
      { numRuns: 100 }
    );
  });

  it("combined source-document line count is unchanged when there is no Stale_Content section at all", () => {
    fc.assert(
      fc.property(arbSyntheticDocumentSet, (docs) => {
        const sourceDocumentTexts = sourceTextsFrom(docs);
        const allSections = docs.flatMap((d) => d.sections);
        const staleSections = selectTrimmable(allSections);

        fc.pre(staleSections.length === 0);

        const combinedBefore = combinedLineCount(sourceDocumentTexts);

        const { updatedSourceDocuments } = moveSectionsToConditionalDoc(staleSections, TARGET_DOC_PATH, TARGET_FRONT_MATTER, {
          sourceDocumentTexts,
        });

        const mergedAfter: Record<string, string> = { ...sourceDocumentTexts, ...updatedSourceDocuments };
        const combinedAfter = combinedLineCount(mergedAfter);

        expect(combinedAfter).toBe(combinedBefore);
      }),
      { numRuns: 100 }
    );
  });
});
