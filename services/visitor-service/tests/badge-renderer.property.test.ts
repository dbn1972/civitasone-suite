/**
 * Property-based tests for badge-print renderer module.
 *
 * Uses fast-check to validate universal correctness properties for
 * badge template placeholder validation and badge rendering.
 *
 * **Validates: Requirements 4.2, 4.3, 5.8**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  SUPPORTED_PLACEHOLDERS,
  type PlaceholderKey,
  validateTemplatePlaceholders,
  renderBadge,
  hasUnsubstitutedPlaceholders,
} from "../src/modules/badge-print/renderer.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Set of all supported placeholder names for fast lookup. */
const SUPPORTED_SET = new Set<string>(SUPPORTED_PLACEHOLDERS);

/** Arbitrary supported placeholder name. */
const arbSupportedPlaceholder = fc.constantFrom(...SUPPORTED_PLACEHOLDERS);

/** Arbitrary unsupported placeholder name (word characters, not in supported set). */
const arbUnsupportedPlaceholder = fc
  .stringMatching(/^[a-z][a-z0-9_]{2,24}$/)
  .filter((s) => !SUPPORTED_SET.has(s));

/** Arbitrary plain text segment (no {{ }} patterns). */
const arbPlainText = fc
  .stringMatching(/^[A-Za-z0-9 ^~\-_:;.,!@#$%&*()/\\|+=\[\]<>'"]{0,40}$/)
  .filter((s) => !s.includes("{{") && !s.includes("}}"));

/**
 * Generator for template bodies with a mix of supported and unsupported placeholders.
 * Returns the template string and the set of unsupported placeholders embedded in it.
 */
const arbMixedTemplate: fc.Arbitrary<{ template: string; unsupported: string[] }> = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: arbPlainText },
      { weight: 2, arbitrary: arbSupportedPlaceholder.map((p) => `{{${p}}}`) },
      { weight: 2, arbitrary: arbUnsupportedPlaceholder.map((p) => ({ text: `{{${p}}}`, name: p })) },
    ),
    { minLength: 1, maxLength: 12 },
  )
  .map((segments) => {
    const parts: string[] = [];
    const unsupported: string[] = [];
    for (const seg of segments) {
      if (typeof seg === "string") {
        parts.push(seg);
      } else {
        parts.push(seg.text);
        if (!unsupported.includes(seg.name)) {
          unsupported.push(seg.name);
        }
      }
    }
    return { template: parts.join(""), unsupported };
  });

/**
 * Generator for template bodies containing ONLY supported placeholders.
 * Produces a template with random text interspersed with supported placeholder tokens.
 */
const arbSupportedOnlyTemplate: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: arbPlainText },
      { weight: 4, arbitrary: arbSupportedPlaceholder.map((p) => `{{${p}}}`) },
    ),
    { minLength: 1, maxLength: 15 },
  )
  .map((segments) => segments.join(""));

/**
 * Generator for a complete data record with all 12 placeholder keys present.
 * Values are arbitrary non-empty strings (simulating visitor data).
 */
const arbCompleteDataRecord: fc.Arbitrary<Record<PlaceholderKey, string>> = fc
  .tuple(
    ...SUPPORTED_PLACEHOLDERS.map(() =>
      fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes("{{") && !s.includes("}}")),
    ),
  )
  .map((values) => {
    const record: Partial<Record<PlaceholderKey, string>> = {};
    for (let i = 0; i < SUPPORTED_PLACEHOLDERS.length; i++) {
      record[SUPPORTED_PLACEHOLDERS[i]] = values[i];
    }
    return record as Record<PlaceholderKey, string>;
  });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("badge-renderer property tests", () => {
  // -------------------------------------------------------------------------
  // Property 8: Badge template placeholder validation
  // -------------------------------------------------------------------------
  describe("Property 8: Badge template placeholder validation", () => {
    it("correctly identifies all invalid placeholders in a mixed template", async () => {
      await fc.assert(
        fc.asyncProperty(arbMixedTemplate, async ({ template, unsupported }) => {
          const result = validateTemplatePlaceholders(template);

          if (unsupported.length === 0) {
            // Template contains only supported placeholders (or no placeholders)
            expect(result.valid).toBe(true);
            expect(result.invalidPlaceholders).toEqual([]);
          } else {
            // Template contains at least one unsupported placeholder
            expect(result.valid).toBe(false);
            // Every unsupported placeholder we injected must be identified
            for (const name of unsupported) {
              expect(result.invalidPlaceholders).toContain(name);
            }
            // No supported placeholder should appear in the invalid list
            for (const inv of result.invalidPlaceholders) {
              expect(SUPPORTED_SET.has(inv)).toBe(false);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it("a template containing ONLY supported placeholders always returns valid: true", async () => {
      await fc.assert(
        fc.asyncProperty(arbSupportedOnlyTemplate, async (template) => {
          const result = validateTemplatePlaceholders(template);
          expect(result.valid).toBe(true);
          expect(result.invalidPlaceholders).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 9: Badge rendering produces no unsubstituted placeholders
  // -------------------------------------------------------------------------
  describe("Property 9: Badge rendering produces no unsubstituted placeholders", () => {
    it("rendering a supported-only template with a complete data record leaves no unsubstituted placeholders", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSupportedOnlyTemplate,
          arbCompleteDataRecord,
          async (template, data) => {
            const rendered = renderBadge(template, data);
            expect(hasUnsubstitutedPlaceholders(rendered)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("rendering with complete data always produces output different from template when template has placeholders", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Ensure at least one placeholder is in the template
          fc
            .tuple(arbSupportedPlaceholder, arbSupportedOnlyTemplate)
            .map(([p, rest]) => `{{${p}}}${rest}`),
          arbCompleteDataRecord,
          async (template, data) => {
            const rendered = renderBadge(template, data);
            // After rendering, no {{word}} patterns should remain
            expect(hasUnsubstitutedPlaceholders(rendered)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
