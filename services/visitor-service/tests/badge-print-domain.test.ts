/**
 * Unit tests for badge-print domain logic.
 *
 * Tests cover: print job state machine transitions, priority queue scoring,
 * retry logic with exponential backoff, and template versioning.
 */
import { describe, it, expect } from "vitest";
import {
  PrintJobStatus,
  PRINT_JOB_TRANSITIONS,
  canTransitionJob,
  PrintPriority,
  computeJobScore,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  shouldRetry,
  getNextRetryDelay,
  computeNextRetryAt,
  createNewVersion,
} from "../src/modules/badge-print/domain.js";

// ---------------------------------------------------------------------------
// Print Job State Machine
// ---------------------------------------------------------------------------

describe("Print job state machine", () => {
  it("allows queued → in_progress", () => {
    expect(canTransitionJob("queued", "in_progress")).toBe(true);
  });

  it("allows queued → failed", () => {
    expect(canTransitionJob("queued", "failed")).toBe(true);
  });

  it("does not allow queued → completed", () => {
    expect(canTransitionJob("queued", "completed")).toBe(false);
  });

  it("does not allow queued → queued (self-loop)", () => {
    expect(canTransitionJob("queued", "queued")).toBe(false);
  });

  it("allows in_progress → completed", () => {
    expect(canTransitionJob("in_progress", "completed")).toBe(true);
  });

  it("allows in_progress → failed", () => {
    expect(canTransitionJob("in_progress", "failed")).toBe(true);
  });

  it("allows in_progress → queued (retry re-enqueue)", () => {
    expect(canTransitionJob("in_progress", "queued")).toBe(true);
  });

  it("does not allow any transition from completed (terminal)", () => {
    const statuses: PrintJobStatus[] = ["queued", "in_progress", "completed", "failed"];
    for (const target of statuses) {
      expect(canTransitionJob("completed", target)).toBe(false);
    }
  });

  it("does not allow any transition from failed (terminal)", () => {
    const statuses: PrintJobStatus[] = ["queued", "in_progress", "completed", "failed"];
    for (const target of statuses) {
      expect(canTransitionJob("failed", target)).toBe(false);
    }
  });

  it("returns false for an unknown from status", () => {
    expect(canTransitionJob("unknown" as PrintJobStatus, "queued")).toBe(false);
  });

  it("PRINT_JOB_TRANSITIONS defines all four statuses", () => {
    expect(Object.keys(PRINT_JOB_TRANSITIONS).sort()).toEqual(
      ["completed", "failed", "in_progress", "queued"],
    );
  });
});

// ---------------------------------------------------------------------------
// Priority Queue Scoring
// ---------------------------------------------------------------------------

describe("computeJobScore", () => {
  it("high priority jobs have lower scores than standard priority", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const highScore = computeJobScore("high", now);
    const standardScore = computeJobScore("standard", now);
    expect(highScore).toBeLessThan(standardScore);
  });

  it("earlier jobs within the same priority have lower scores (FIFO)", () => {
    const earlier = new Date("2024-06-15T12:00:00Z");
    const later = new Date("2024-06-15T12:01:00Z");
    const scoreEarlier = computeJobScore("standard", earlier);
    const scoreLater = computeJobScore("standard", later);
    expect(scoreEarlier).toBeLessThan(scoreLater);
  });

  it("high priority job created later still has lower score than any standard job", () => {
    const muchLater = new Date("2030-01-01T00:00:00Z");
    const veryEarly = new Date("2020-01-01T00:00:00Z");
    const highLate = computeJobScore("high", muchLater);
    const standardEarly = computeJobScore("standard", veryEarly);
    expect(highLate).toBeLessThan(standardEarly);
  });

  it("returns a numeric score suitable for Redis ZADD", () => {
    const score = computeJobScore("high", new Date("2024-06-15T12:00:00Z"));
    expect(typeof score).toBe("number");
    expect(Number.isFinite(score)).toBe(true);
  });

  it("standard priority base offset is 1 billion", () => {
    const epoch = new Date(0); // Unix epoch
    const standardScore = computeJobScore("standard", epoch);
    const highScore = computeJobScore("high", epoch);
    expect(standardScore - highScore).toBe(1_000_000_000);
  });
});

// ---------------------------------------------------------------------------
// Retry Logic
// ---------------------------------------------------------------------------

describe("shouldRetry", () => {
  it("returns true for retryCount 0 (first retry eligible)", () => {
    expect(shouldRetry(0)).toBe(true);
  });

  it("returns true for retryCount 1", () => {
    expect(shouldRetry(1)).toBe(true);
  });

  it("returns true for retryCount 2", () => {
    expect(shouldRetry(2)).toBe(true);
  });

  it("returns false for retryCount 3 (max retries exhausted)", () => {
    expect(shouldRetry(3)).toBe(false);
  });

  it("returns false for retryCount above MAX_RETRIES", () => {
    expect(shouldRetry(5)).toBe(false);
    expect(shouldRetry(100)).toBe(false);
  });
});

describe("getNextRetryDelay", () => {
  it("returns 30s for retryCount 0 (first retry)", () => {
    expect(getNextRetryDelay(0)).toBe(30_000);
  });

  it("returns 60s for retryCount 1 (second retry)", () => {
    expect(getNextRetryDelay(1)).toBe(60_000);
  });

  it("returns 120s for retryCount 2 (third retry)", () => {
    expect(getNextRetryDelay(2)).toBe(120_000);
  });

  it("returns the last delay for retryCount beyond defined delays", () => {
    expect(getNextRetryDelay(3)).toBe(120_000);
    expect(getNextRetryDelay(10)).toBe(120_000);
  });

  it("handles negative retryCount by returning first delay", () => {
    expect(getNextRetryDelay(-1)).toBe(30_000);
  });
});

describe("computeNextRetryAt", () => {
  const baseTime = new Date("2024-06-15T12:00:00Z");

  it("adds 30s delay for retryCount 0", () => {
    const result = computeNextRetryAt(0, baseTime);
    expect(result.getTime()).toBe(baseTime.getTime() + 30_000);
  });

  it("adds 60s delay for retryCount 1", () => {
    const result = computeNextRetryAt(1, baseTime);
    expect(result.getTime()).toBe(baseTime.getTime() + 60_000);
  });

  it("adds 120s delay for retryCount 2", () => {
    const result = computeNextRetryAt(2, baseTime);
    expect(result.getTime()).toBe(baseTime.getTime() + 120_000);
  });

  it("returns a Date object", () => {
    const result = computeNextRetryAt(0, baseTime);
    expect(result).toBeInstanceOf(Date);
  });

  it("uses current time when now is not provided", () => {
    const before = Date.now();
    const result = computeNextRetryAt(0);
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(result.getTime()).toBeLessThanOrEqual(after + 30_000);
  });
});

describe("Retry constants", () => {
  it("MAX_RETRIES is 3", () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it("RETRY_DELAYS_MS has 3 entries matching exponential backoff", () => {
    expect(RETRY_DELAYS_MS).toEqual([30_000, 60_000, 120_000]);
  });

  it("each delay doubles the previous (exponential pattern)", () => {
    expect(RETRY_DELAYS_MS[1]).toBe(RETRY_DELAYS_MS[0] * 2);
    expect(RETRY_DELAYS_MS[2]).toBe(RETRY_DELAYS_MS[1] * 2);
  });
});

// ---------------------------------------------------------------------------
// Template Versioning
// ---------------------------------------------------------------------------

describe("createNewVersion", () => {
  it("increments templateVersion by 1", () => {
    const result = createNewVersion({ templateVersion: 1, id: "abc-123" });
    expect(result.templateVersion).toBe(2);
  });

  it("sets previousVersionId to the current template ID", () => {
    const result = createNewVersion({ templateVersion: 3, id: "uuid-456" });
    expect(result.previousVersionId).toBe("uuid-456");
  });

  it("works with version 0", () => {
    const result = createNewVersion({ templateVersion: 0, id: "first-version" });
    expect(result.templateVersion).toBe(1);
    expect(result.previousVersionId).toBe("first-version");
  });

  it("works with high version numbers", () => {
    const result = createNewVersion({ templateVersion: 99, id: "many-versions" });
    expect(result.templateVersion).toBe(100);
  });
});
