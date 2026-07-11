/**
 * Property-based tests for badge-print domain module.
 *
 * Uses fast-check to validate universal correctness properties for
 * print job priority queue scoring and retry exhaustion logic.
 *
 * **Validates: Requirements 5.2, 5.5, 5.6, 5.7**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeJobScore,
  shouldRetry,
  MAX_RETRIES,
  type PrintPriority,
} from "../src/modules/badge-print/domain.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary print priority. */
const arbPriority: fc.Arbitrary<PrintPriority> = fc.constantFrom("high", "standard");

/** Arbitrary timestamp in a reasonable range (2020-2030). */
const arbTimestamp: fc.Arbitrary<Date> = fc
  .integer({ min: 1577836800000, max: 1893456000000 }) // 2020-01-01 to 2030-01-01
  .map((ms) => new Date(ms));

/**
 * Arbitrary print job with priority and creation timestamp.
 * Used to generate a list of jobs for queue ordering tests.
 */
interface PrintJobInput {
  priority: PrintPriority;
  createdAt: Date;
}

const arbPrintJob: fc.Arbitrary<PrintJobInput> = fc.record({
  priority: arbPriority,
  createdAt: arbTimestamp,
});

/** Arbitrary list of print jobs (at least 2 for meaningful ordering tests). */
const arbPrintJobList: fc.Arbitrary<PrintJobInput[]> = fc.array(arbPrintJob, {
  minLength: 2,
  maxLength: 50,
});

/** Arbitrary retry count in valid range [0, MAX_RETRIES + 2] to cover boundary. */
const arbRetryCount: fc.Arbitrary<number> = fc.integer({ min: 0, max: MAX_RETRIES + 2 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("badge-print domain property tests", () => {
  // -------------------------------------------------------------------------
  // Property 10: Print job queue respects priority ordering
  // -------------------------------------------------------------------------
  describe("Property 10: Print job queue respects priority ordering", () => {
    it("high-priority jobs always sort before standard-priority jobs regardless of timestamp", async () => {
      await fc.assert(
        fc.asyncProperty(arbPrintJobList, async (jobs) => {
          // Compute scores for all jobs
          const scored = jobs.map((job) => ({
            ...job,
            score: computeJobScore(job.priority, job.createdAt),
          }));

          // Sort by score ascending (lower score = higher priority in Redis ZRANGEBYSCORE)
          const sorted = [...scored].sort((a, b) => a.score - b.score);

          // Find the index of the first standard-priority job in the sorted list
          const firstStandardIdx = sorted.findIndex((j) => j.priority === "standard");

          // If there are both high and standard jobs, all high-priority must come first
          if (firstStandardIdx > 0) {
            // Every job before the first standard job must be high priority
            for (let i = 0; i < firstStandardIdx; i++) {
              expect(sorted[i]!.priority).toBe("high");
            }
          }

          // Every job from firstStandardIdx onward must be standard (no high after standard)
          if (firstStandardIdx >= 0) {
            for (let i = firstStandardIdx; i < sorted.length; i++) {
              expect(sorted[i]!.priority).toBe("standard");
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it("within the same priority level, earlier timestamps produce lower scores (FIFO)", async () => {
      await fc.assert(
        fc.asyncProperty(arbPrintJobList, async (jobs) => {
          // Compute scores for all jobs
          const scored = jobs.map((job) => ({
            ...job,
            score: computeJobScore(job.priority, job.createdAt),
          }));

          // Sort by score ascending
          const sorted = [...scored].sort((a, b) => a.score - b.score);

          // Within same priority, jobs should be in timestamp order
          for (let i = 0; i < sorted.length - 1; i++) {
            const current = sorted[i]!;
            const next = sorted[i + 1]!;

            if (current.priority === next.priority) {
              // Same priority: earlier timestamp → lower score → comes first
              expect(current.createdAt.getTime()).toBeLessThanOrEqual(next.createdAt.getTime());
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it("a high-priority job always has a lower score than any standard-priority job", async () => {
      await fc.assert(
        fc.asyncProperty(arbTimestamp, arbTimestamp, async (highTs, stdTs) => {
          const highScore = computeJobScore("high", highTs);
          const stdScore = computeJobScore("standard", stdTs);

          // High priority score must always be less than standard priority score
          expect(highScore).toBeLessThan(stdScore);
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 11: Print job retry exhaustion leads to failed state
  // -------------------------------------------------------------------------
  describe("Property 11: Print job retry exhaustion leads to failed state", () => {
    it("shouldRetry returns false when retry_count >= MAX_RETRIES", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: MAX_RETRIES, max: MAX_RETRIES + 100 }),
          async (retryCount) => {
            expect(shouldRetry(retryCount)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("shouldRetry returns true when retry_count < MAX_RETRIES", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: MAX_RETRIES - 1 }),
          async (retryCount) => {
            expect(shouldRetry(retryCount)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("no job with retry_count >= MAX_RETRIES is eligible for retry", async () => {
      await fc.assert(
        fc.asyncProperty(arbRetryCount, async (retryCount) => {
          const canRetry = shouldRetry(retryCount);

          if (retryCount >= MAX_RETRIES) {
            // Exhausted retries — must NOT be retryable
            expect(canRetry).toBe(false);
          } else {
            // Still has retries left — must be retryable
            expect(canRetry).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("MAX_RETRIES is exactly 3 (boundary verification)", () => {
      expect(MAX_RETRIES).toBe(3);
      expect(shouldRetry(0)).toBe(true);
      expect(shouldRetry(1)).toBe(true);
      expect(shouldRetry(2)).toBe(true);
      expect(shouldRetry(3)).toBe(false);
    });
  });
});
