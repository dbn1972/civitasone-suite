/**
 * Property-based tests for document-scan domain logic.
 *
 * Uses fast-check to validate universal correctness properties for
 * OCR confidence threshold detection and blacklist screening contracts.
 *
 * **Validates: Requirements 6.5, 6.8**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isLowConfidence, shouldScreenBlacklist } from "../src/modules/document-scan/domain.js";
import type { OcrExtraction } from "../src/modules/document-scan/ocr-adapter.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary confidence score between 0 and 100 (inclusive). */
const arbScore = fc.integer({ min: 0, max: 100 });

/**
 * Generator for confidence score records with full_name and id_document_number
 * fields both below the threshold (80).
 */
const arbLowScores: fc.Arbitrary<Record<string, number>> = fc
  .record({
    full_name: fc.integer({ min: 0, max: 79 }),
    id_document_number: arbScore,
  })
  .map((rec) => ({ ...rec }));

/**
 * Generator for confidence score records where full_name < 80 OR id_document_number < 80.
 * At least one critical field must be below threshold.
 */
const arbAtLeastOneLow: fc.Arbitrary<Record<string, number>> = fc.oneof(
  // full_name below threshold, id_document_number anything
  fc.record({
    full_name: fc.integer({ min: 0, max: 79 }),
    id_document_number: arbScore,
  }),
  // id_document_number below threshold, full_name anything
  fc.record({
    full_name: arbScore,
    id_document_number: fc.integer({ min: 0, max: 79 }),
  }),
);

/**
 * Generator for confidence score records where both critical fields are >= 80.
 */
const arbBothHigh: fc.Arbitrary<Record<string, number>> = fc.record({
  full_name: fc.integer({ min: 80, max: 100 }),
  id_document_number: fc.integer({ min: 80, max: 100 }),
});

/**
 * Generator for non-empty ID document numbers (alphanumeric strings).
 */
const arbDocNumber = fc.stringMatching(/^[A-Z0-9]{4,15}$/);

/**
 * Generator for an OcrExtraction with a present ID document number.
 */
const arbExtractionWithId: fc.Arbitrary<OcrExtraction> = arbDocNumber.map((num) => ({
  fullName: "Test Name",
  dateOfBirth: "01/01/1990",
  idDocumentNumber: num,
  idDocumentType: null,
  address: null,
  photoRegionKey: null,
  confidenceScores: { full_name: 85, id_document_number: 90 },
}));

/**
 * Generator for an OcrExtraction with null/empty ID document number.
 */
const arbExtractionWithoutId: fc.Arbitrary<OcrExtraction> = fc.constantFrom(null, "").map((num) => ({
  fullName: "Test Name",
  dateOfBirth: "01/01/1990",
  idDocumentNumber: num,
  idDocumentType: null,
  address: null,
  photoRegionKey: null,
  confidenceScores: { full_name: 85 },
}));

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("document-scan domain property tests", () => {
  // -------------------------------------------------------------------------
  // Property 12: OCR confidence threshold flags low-confidence results
  // -------------------------------------------------------------------------
  describe("Property 12: OCR confidence threshold flags low-confidence results", () => {
    it("returns true when full_name or id_document_number is below 80", async () => {
      /**
       * **Validates: Requirements 6.5**
       *
       * For any confidence score record where full_name < 80 OR
       * id_document_number < 80, isLowConfidence must return true.
       */
      await fc.assert(
        fc.asyncProperty(arbAtLeastOneLow, async (scores) => {
          expect(isLowConfidence(scores)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("returns false when both full_name and id_document_number are >= 80", async () => {
      /**
       * **Validates: Requirements 6.5**
       *
       * For any confidence score record where both full_name >= 80 AND
       * id_document_number >= 80, isLowConfidence must return false.
       */
      await fc.assert(
        fc.asyncProperty(arbBothHigh, async (scores) => {
          expect(isLowConfidence(scores)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("boundary: score of exactly 80 is NOT low confidence", async () => {
      /**
       * **Validates: Requirements 6.5**
       *
       * Boundary test: 80 is the threshold — score of exactly 80 should
       * NOT be flagged as low confidence.
       */
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 80, max: 100 }),
          fc.integer({ min: 80, max: 100 }),
          async (nameScore, idScore) => {
            const scores = { full_name: nameScore, id_document_number: idScore };
            expect(isLowConfidence(scores)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("boundary: score of exactly 79 IS low confidence", async () => {
      /**
       * **Validates: Requirements 6.5**
       *
       * Boundary test: 79 is below the threshold — score of exactly 79
       * on either critical field should be flagged.
       */
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("full_name", "id_document_number"),
          fc.integer({ min: 80, max: 100 }),
          async (lowField, otherScore) => {
            const scores: Record<string, number> = {
              full_name: otherScore,
              id_document_number: otherScore,
            };
            scores[lowField] = 79;
            expect(isLowConfidence(scores)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 13: OCR blacklist screening occurs for every extraction
  // -------------------------------------------------------------------------
  describe("Property 13: OCR blacklist screening occurs for every extraction", () => {
    it("screening is attempted for every extraction with an id_document_number", async () => {
      /**
       * **Validates: Requirements 6.8**
       *
       * For any OcrExtraction with a non-null, non-empty id_document_number,
       * shouldScreenBlacklist must return true (screening must be attempted).
       */
      await fc.assert(
        fc.asyncProperty(arbExtractionWithId, async (extraction) => {
          expect(shouldScreenBlacklist(extraction)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("screening is skipped when id_document_number is null or empty", async () => {
      /**
       * **Validates: Requirements 6.8**
       *
       * For any OcrExtraction without an id_document_number (null or empty),
       * shouldScreenBlacklist must return false (no screening possible).
       */
      await fc.assert(
        fc.asyncProperty(arbExtractionWithoutId, async (extraction) => {
          expect(shouldScreenBlacklist(extraction)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
