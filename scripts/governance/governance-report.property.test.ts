// scripts/governance/governance-report.property.test.ts
//
// Property tests for the Governance Report Writer (tasks 14.4, 14.5).
// Uses fast-check (already a devDependency) — see design.md's "Correctness
// Properties" section for Property 8 and Property 9's full statements.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  renderGovernanceReport,
  type GovernanceReportInput,
  type HookReportEntry,
  type SkillReportEntry,
  type SpecCrossReference,
} from "./governance-report.js";
import type { HookFinalStatus } from "./types.js";

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbDocumentName = fc.constantFrom("tech.md", "structure.md", "quick-reference.md", "product.md");

// Short, printable identifier-ish text — used for section headings, skill
// files, hook file names, and reasons. Avoids characters that would make
// substring containment checks fragile (e.g. no embedded markdown table
// pipes), while still exercising a range of text shapes.
const arbWord = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{2,12}$/);

const arbHeadingText = fc.array(arbWord, { minLength: 1, maxLength: 4 }).map((words) => words.join(" "));

const arbLineCount = fc.integer({ min: 0, max: 5000 });

const arbSteeringPerDocumentEntry = fc
  .tuple(arbLineCount, fc.array(arbHeadingText, { minLength: 0, maxLength: 5 }))
  .map(([lineCountBefore, sectionsMoved]) => {
    // lineCountAfter is independent of sectionsMoved in this generator —
    // the property under test only cares that both numbers and every moved
    // section name are traceable in the rendered text, not that they're
    // arithmetically consistent with each other.
    const lineCountAfter = Math.max(0, lineCountBefore - sectionsMoved.length);
    return { lineCountBefore, lineCountAfter, sectionsMoved };
  });

const arbSteering = fc
  .uniqueArray(arbDocumentName, { minLength: 1, maxLength: 4 })
  .chain((docNames) =>
    fc.tuple(...docNames.map((doc) => arbSteeringPerDocumentEntry.map((entry) => [doc, entry] as const)))
  )
  .chain((entries) =>
    fc.tuple(arbLineCount, arbLineCount).map(([combinedLineCountBefore, combinedLineCountAfter]) => {
      const perDocument: GovernanceReportInput["steering"]["perDocument"] = {};
      for (const [doc, entry] of entries) perDocument[doc] = entry;
      return { perDocument, combinedLineCountBefore, combinedLineCountAfter };
    })
  );

const arbSkillEntry: fc.Arbitrary<SkillReportEntry> = fc
  .tuple(arbWord, fc.constantFrom("created", "updated", "unchanged"), arbHeadingText)
  .map(([file, action, reason]) => ({ file: `${file}.md`, action, reason }));

const HOOK_STATUSES: HookFinalStatus[] = ["valid", "corrected", "needs-manual-review"];

function buildHookEntry(
  file: string,
  status: HookFinalStatus,
  corrections: string[],
  flaggedReasons: string[]
): HookReportEntry {
  const base = { file, status };
  if (status === "corrected") return { ...base, corrections };
  if (status === "needs-manual-review") return { ...base, flaggedReasons };
  return base;
}

/** Generates a list of hook entries with distinct file names, since
 * Property 9 requires each hook name to appear exactly once. */
const arbUniqueHookEntries: fc.Arbitrary<HookReportEntry[]> = fc
  .uniqueArray(arbWord, { minLength: 0, maxLength: 8 })
  .chain((names) =>
    fc.tuple(
      ...names.map((name) =>
        fc
          .tuple(
            fc.constantFrom(...HOOK_STATUSES),
            fc.array(arbHeadingText, { minLength: 0, maxLength: 3 }),
            fc.array(arbHeadingText, { minLength: 0, maxLength: 3 })
          )
          .map(([status, corrections, flaggedReasons]): HookReportEntry =>
            buildHookEntry(`${name}.kiro.hook`, status, corrections, flaggedReasons)
          )
      )
    )
  );

const arbSpecCrossReference: fc.Arbitrary<SpecCrossReference> = fc
  .tuple(arbWord, arbHeadingText)
  .map(([spec, relatedTo]) => ({ spec: `civitasone-suite/.kiro/specs/${spec}/`, relatedTo }));

const arbGovernanceReportInput: fc.Arbitrary<GovernanceReportInput> = fc.record({
  steering: arbSteering,
  serviceReconciliation: fc.record({ added: fc.array(arbWord, { minLength: 0, maxLength: 5 }) }),
  portReconciliation: fc.record({
    added: fc.array(
      fc.tuple(arbWord, fc.integer({ min: 3000, max: 9999 })).map(([service, port]) => ({ service, port })),
      { minLength: 0, maxLength: 5 }
    ),
    needsManualAssignment: fc.array(arbWord, { minLength: 0, maxLength: 3 }),
  }),
  skills: fc.array(arbSkillEntry, { minLength: 0, maxLength: 6 }),
  hooks: arbUniqueHookEntries,
  specCrossReferences: fc.array(arbSpecCrossReference, { minLength: 0, maxLength: 4 }),
});

describe("Property 8: Governance_Report is faithful to its structured input", () => {
  // Feature: agent-context-governance-refresh, Property 8: For any GovernanceReportInput (generated with random line counts, moved-section names, skill actions, and hook results), the rendered markdown text produced by renderGovernanceReport contains a recognizable representation of every line-count pair, every moved-section name, every skill action + reason, and every hook status recorded in the input.

  it("renders a recognizable representation of every line-count pair, moved-section name, skill action+reason, and hook status", () => {
    fc.assert(
      fc.property(arbGovernanceReportInput, (input) => {
        const markdown = renderGovernanceReport(input);

        // Every line-count pair (before/after) per document is traceable.
        for (const entry of Object.values(input.steering.perDocument)) {
          expect(markdown).toContain(String(entry.lineCountBefore));
          expect(markdown).toContain(String(entry.lineCountAfter));
          for (const heading of entry.sectionsMoved) {
            expect(markdown).toContain(heading);
          }
        }
        expect(markdown).toContain(String(input.steering.combinedLineCountBefore));
        expect(markdown).toContain(String(input.steering.combinedLineCountAfter));

        // Every skill action + reason is traceable.
        for (const skill of input.skills) {
          expect(markdown).toContain(skill.file);
          expect(markdown).toContain(skill.action);
          expect(markdown).toContain(skill.reason);
        }

        // Every hook status is traceable (name + status).
        for (const hook of input.hooks) {
          expect(markdown).toContain(hook.file);
          expect(markdown).toContain(hook.status);
        }

        // Service/port reconciliation results are traceable too (not
        // explicitly required by Property 8's wording, but part of the same
        // "structured input -> recognizable in output" contract this
        // function implements — kept minimal to the fields Property 8 names
        // is not required, so this is left out to stay precisely scoped to
        // the property statement above).
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 9: Every hook appears in the report exactly once, with exactly one of three statuses", () => {
  // Feature: agent-context-governance-refresh, Property 9: For any list of N hook validation/correction results, the rendered Governance_Report lists exactly N hook entries, each hook name appearing exactly once, each paired with exactly one of valid, corrected, or needs-manual-review.

  it("lists exactly N hook entries, each name exactly once, each paired with exactly one of the three statuses", () => {
    fc.assert(
      fc.property(arbGovernanceReportInput, (input) => {
        const markdown = renderGovernanceReport(input);

        for (const hook of input.hooks) {
          // Each hook name appears exactly once in the rendered markdown.
          const occurrences = markdown.split(hook.file).length - 1;
          expect(occurrences).toBe(1);

          // The single row for this hook pairs it with exactly one of the
          // three statuses: find the table row line containing this hook's
          // file name and assert it contains its own status and none of
          // the other two statuses.
          const rowLine = markdown.split("\n").find((line) => line.includes(hook.file));
          expect(rowLine).toBeDefined();
          const otherStatuses = (["valid", "corrected", "needs-manual-review"] as const).filter(
            (s) => s !== hook.status
          );
          expect(rowLine ?? "").toContain(hook.status);
          for (const other of otherStatuses) {
            // A hook's own status word must appear, and since fast-check
            // guarantees unique file names above, the row for THIS hook
            // should not simultaneously claim a different status.
            // (Guards against a rendering bug that concatenates all statuses
            // onto every row.)
            if (other === hook.status) continue;
            // "needs-manual-review" is not a substring of "valid" or
            // "corrected" and vice versa, so a plain substring check on the
            // single row line is a safe, unambiguous assertion here.
            expect((rowLine ?? "").includes(other) && other !== hook.status).toBe(false);
          }
        }

        // Exactly N hook entries: the hooks table has exactly N data rows
        // (total non-empty lines mentioning a ".kiro.hook" file name equals
        // the number of hooks, given the uniqueness guarantee above).
        const hookMentionLines = markdown.split("\n").filter((line) => line.includes(".kiro.hook`"));
        expect(hookMentionLines.length).toBe(input.hooks.length);
      }),
      { numRuns: 100 }
    );
  });
});
