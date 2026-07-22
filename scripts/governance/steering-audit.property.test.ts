// scripts/governance/steering-audit.property.test.ts
//
// Property tests for the steering section parser/classifier (tasks 2.4, 2.5).
// Uses fast-check (already a devDependency) — see design.md's "Correctness
// Properties" section for Property 1 and Property 2's full statements.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifySection, type Classification, type ClassifiedSection } from "./steering-audit.js";
import type { SteeringSection } from "./steering-audit.js";

const ALL_CLASSIFICATIONS: Classification[] = [
  "Enforceable_Rule",
  "Stale_Content",
  "duplicate-of-another-section",
  "reference-detail-not-frequently-needed",
];

// ── Synthetic section generation ────────────────────────────────────────────
//
// Generates SteeringSection-shaped objects covering the edge cases called out
// by the task: empty body, whitespace-only body, markdown tables with random
// column names, and imperative-language text — plus plain prose headings/bodies
// so the fallback (Enforceable_Rule) rule gets exercised too.

const arbDocumentName = fc.constantFrom("tech.md", "structure.md", "quick-reference.md", "product.md", "synthetic-doc.md");

const arbPlainHeadingText = fc
  .array(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{1,10}$/), { minLength: 1, maxLength: 5 })
  .map((words) => words.join(" "));

// Headings that intentionally hit each of the non-fallback classifier rules,
// plus plain headings that should fall through to Enforceable_Rule.
const arbHeadingText = fc.oneof(
  arbPlainHeadingText, // plain heading -> exercises fallback (unless body forces something else)
  arbPlainHeadingText.map((t) => `${t} (Targets vs Actuals)`), // Stale_Content via heading keyword
  arbPlainHeadingText.map((t) => `${t} Maturity (July 2026)`), // Stale_Content via heading keyword
  arbPlainHeadingText.map((t) => `${t} (Reference)`), // reference-detail via heading keyword
  arbPlainHeadingText.map((t) => `${t} Mapping`), // reference-detail via heading keyword
);

const arbImperativeSentence = fc
  .constantFrom(
    "This rule MUST be followed at all times.",
    "This is MANDATORY for every service.",
    "Every consumer SHALL check idempotency first.",
    "NEVER log PII in any log statement.",
    "Do NOT bypass the queue for writes.",
    "(Enforced) All routes require zod validation.",
  )
  .map((s) => s);

const arbPlainSentence = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/), { minLength: 3, maxLength: 12 })
  .map((words) => words.join(" ") + ".");

const arbTableColumnName = fc.constantFrom(
  "Foo",
  "Bar",
  "Widget",
  "Notes",
  "Owner",
  "Region",
  "Category",
  "Value",
);

/** A markdown table body with a random header row of random column names. */
const arbTableBody = fc
  .array(arbTableColumnName, { minLength: 2, maxLength: 5 })
  .chain((columns) =>
    fc.array(fc.array(fc.stringMatching(/^[A-Za-z0-9]{1,8}$/), { minLength: columns.length, maxLength: columns.length }), {
      minLength: 1,
      maxLength: 4,
    }).map((rows) => {
      const header = `| ${columns.join(" | ")} |`;
      const separator = `|${columns.map(() => " --- ").join("|")}|`;
      const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
      return [header, separator, body].join("\n");
    }),
  );

const arbBodyText = fc.oneof(
  fc.constant(""), // empty body edge case
  fc.constant("   \n\t  \n "), // whitespace-only body edge case
  arbPlainSentence, // plain prose -> no rule fires except fallback
  arbImperativeSentence, // imperative language -> Enforceable_Rule marker
  arbTableBody, // markdown table with random column names
  fc.tuple(arbImperativeSentence, arbTableBody).map(([s, t]) => `${s}\n\n${t}`),
);

/** Builds a syntactically valid SteeringSection with random heading + body. */
const arbSection: fc.Arbitrary<SteeringSection> = fc
  .record({
    document: arbDocumentName,
    headingText: arbHeadingText,
    bodyText: arbBodyText,
  })
  .map(({ document, headingText, bodyText }) => {
    const heading = `## ${headingText}`;
    const lineCount = bodyText.length === 0 ? 1 : bodyText.split(/\r?\n/).length + 1;
    return {
      document,
      heading,
      level: 2,
      lineStart: 1,
      lineEnd: lineCount,
      lineCount,
      bodyText,
    };
  });

/** A small set of synthetic sections, used as the "other sections" context
 * that classifySection consults for cross-document duplicate detection. */
const arbSectionSet = fc.array(arbSection, { minLength: 1, maxLength: 8 });

describe("Property 1: Trim scope is exactly Stale_Content", () => {
  // Feature: agent-context-governance-refresh, Property 1: For any set of classified steering sections, the set of sections selected for trimming (selectTrimmable) is exactly the subset classified as Stale_Content — no section classified Enforceable_Rule, duplicate-of-another-section, or reference-detail-not-frequently-needed is ever included.
  //
  // NOTE: selectTrimmable() is implemented in task 4.1 (steering-refresh.ts),
  // which does not exist yet. This test exercises the property in terms of
  // classifySection's output directly, using `sections.filter(s =>
  // s.classification === "Stale_Content")` as the stand-in for the eventual
  // selectTrimmable() (which — per design.md line 132 — is defined to do
  // exactly that filter). This test should be revisited/re-pointed at the
  // real selectTrimmable() once task 4.1 lands, so both implementations are
  // checked against the same property rather than assuming they agree.
  it("filtering classified sections for Stale_Content never includes an Enforceable_Rule, duplicate-of-another-section, or reference-detail-not-frequently-needed section", () => {
    fc.assert(
      fc.property(arbSectionSet, (sections) => {
        const classified: ClassifiedSection[] = sections.map((s) => classifySection(s, sections));

        const trimmable = classified.filter((s) => s.classification === "Stale_Content");
        const nonTrimmable = classified.filter((s) => s.classification !== "Stale_Content");

        // Every trimmed section really is Stale_Content.
        for (const section of trimmable) {
          expect(section.classification).toBe("Stale_Content");
        }

        // No section classified Enforceable_Rule, duplicate-of-another-section,
        // or reference-detail-not-frequently-needed ever appears in the trim set.
        for (const section of nonTrimmable) {
          expect(trimmable).not.toContain(section);
          expect(["Enforceable_Rule", "duplicate-of-another-section", "reference-detail-not-frequently-needed"]).toContain(
            section.classification,
          );
        }

        // The two sets partition the full classified list with no overlap and no gaps.
        expect(trimmable.length + nonTrimmable.length).toBe(classified.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 2: Classification totality and exclusivity", () => {
  // Feature: agent-context-governance-refresh, Property 2: For any steering section (real or synthetically generated markdown heading + body), classifySection returns exactly one value from {Enforceable_Rule, Stale_Content, duplicate-of-another-section, reference-detail-not-frequently-needed} — never zero classifications and never more than one.
  it("classifySection always returns exactly one value from the known Classification union", () => {
    fc.assert(
      fc.property(arbSectionSet, (sections) => {
        for (const section of sections) {
          const classified = classifySection(section, sections);

          // Exactly one classification is present on the result (totality).
          expect(classified.classification).toBeDefined();
          expect(typeof classified.classification).toBe("string");

          // That single classification is a member of the known 4-value set (exclusivity —
          // the type system guarantees "at most one" since `classification` is a single
          // scalar field, not a set/array; this assertion pins down "exactly one of the four").
          expect(ALL_CLASSIFICATIONS).toContain(classified.classification);

          // Never any other value smuggled in.
          const isKnownValue = ALL_CLASSIFICATIONS.includes(classified.classification);
          expect(isKnownValue).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("classifying the same section twice with the same context always yields the same single classification (deterministic totality)", () => {
    fc.assert(
      fc.property(arbSectionSet, (sections) => {
        for (const section of sections) {
          const first = classifySection(section, sections);
          const second = classifySection(section, sections);
          expect(second.classification).toBe(first.classification);
        }
      }),
      { numRuns: 100 },
    );
  });
});
