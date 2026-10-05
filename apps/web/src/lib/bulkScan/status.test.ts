import { describe, it, expect } from "vitest";
import {
  confidenceBand, describeReviewReason, failureReasonKey, fileIssueKey, fileStateMeta, formatBytes, groupedCounts, hasActiveWork, isRetryable, isSkippable,
  linkStateMeta, pollDelayMs, progressFromCounts,
} from "./status";

describe("failure reasons", () => {
  it("maps the documented reason codes to human sentences and never leaks an unknown raw code", () => {
    for (const c of ["FILE_TOO_LARGE", "ENCRYPTED_PDF", "UNSUPPORTED_TYPE", "MAX_ATTEMPTS"]) expect(failureReasonKey(c)).toBe(`reason.${c}`);
    expect(failureReasonKey("SOMETHING_NEW")).toBe("reason.unknown");
    expect(failureReasonKey(null)).toBe("reason.unknown");
  });
  it("explains quarantined, scan_pending, duplicates and dead-lettered files", () => {
    expect(fileIssueKey({ state: "quarantined", failureReason: null, deadLetter: false })).toBe("reason.quarantined");
    expect(fileIssueKey({ state: "scan_pending", failureReason: null, deadLetter: false })).toBe("reason.scan_pending");
    expect(fileIssueKey({ state: "skipped_duplicate", failureReason: null, deadLetter: false })).toBe("reason.skipped_duplicate");
    expect(fileIssueKey({ state: "failed", failureReason: "MAX_ATTEMPTS", deadLetter: true })).toBe("reason.MAX_ATTEMPTS");
    expect(fileIssueKey({ state: "failed", failureReason: null, deadLetter: true })).toBe("reason.MAX_ATTEMPTS");
    expect(fileIssueKey({ state: "filed", failureReason: null, deadLetter: false })).toBeNull();
  });
  it("retry only for transient failures; skip only from the skippable states", () => {
    expect(isRetryable({ state: "failed", failureReason: "MAX_ATTEMPTS" })).toBe(true);
    expect(isRetryable({ state: "failed", failureReason: "ENCRYPTED_PDF" })).toBe(false);
    expect(isRetryable({ state: "failed", failureReason: null })).toBe(false);
    expect(isRetryable({ state: "queued", failureReason: "MAX_ATTEMPTS" })).toBe(false);
    expect(isSkippable({ state: "needs_review" })).toBe(true);
    expect(isSkippable({ state: "filed" })).toBe(false);
    expect(isSkippable({ state: "pending_upload" })).toBe(true);
    expect(failureReasonKey("UPLOAD_EXPIRED")).toBe("reason.UPLOAD_EXPIRED");
    expect(isRetryable({ state: "failed", failureReason: "UPLOAD_EXPIRED" })).toBe(false);
  });
});

describe("state presentation", () => {
  it("every state has an icon (status is not colour-only) and unknown states fall back safely", () => {
    expect(fileStateMeta("failed")).toMatchObject({ tone: "bad", icon: "✕", key: "state.failed" });
    expect(fileStateMeta("nonsense")).toMatchObject({ key: "state.unknown" });
    expect(linkStateMeta("flagged_mismatch").icon).toBeTruthy();
    expect(linkStateMeta("???").key).toBe("linkState.unknown");
  });
  it("confidence bands honour the review threshold", () => {
    expect(confidenceBand(0.9)).toBe("high");
    expect(confidenceBand(0.65)).toBe("medium");
    expect(confidenceBand(0.4)).toBe("low");
    expect(confidenceBand(null)).toBe("unknown");
    expect(confidenceBand(0.85, 0.9)).toBe("medium");
  });
});

describe("progress and polling math", () => {
  it("counts settled states over the total", () => {
    expect(progressFromCounts({ queued: 2, filed: 3, failed: 1, needs_review: 4 })).toEqual({ total: 10, settled: 8, percent: 80 });
    expect(progressFromCounts({})).toEqual({ total: 0, settled: 0, percent: 0 });
  });
  it("groups counts in display order and detects active work", () => {
    const g = groupedCounts({ queued: 1, ocr_running: 2, failed: 1, quarantined: 1 });
    expect(g.find((x) => x.id === "processing")?.count).toBe(3);
    expect(g.find((x) => x.id === "failed")?.count).toBe(2);
    expect(hasActiveWork({ queued: 1 })).toBe(true);
    expect(hasActiveWork({ needs_review: 5, filed: 2 })).toBe(false);
    expect(hasActiveWork({ queued: 1 }, "cancelled")).toBe(false);
  });
  it("backs off exponentially up to a cap", () => {
    expect(pollDelayMs(0)).toBe(3000);
    expect(pollDelayMs(1)).toBe(4800);
    expect(pollDelayMs(2)).toBeGreaterThan(pollDelayMs(1));
    expect(pollDelayMs(50)).toBe(30000);
    expect(pollDelayMs(-3)).toBe(3000);
  });
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("review reason descriptors", () => {
  it("parses parameterised and link reasons", () => {
    expect(describeReviewReason("LOW_CONFIDENCE")).toEqual({ key: "reviewReason.LOW_CONFIDENCE", params: {} });
    expect(describeReviewReason("MISSING_FIELD:date")).toEqual({ key: "reviewReason.MISSING_FIELD", params: { field: "date" } });
    expect(describeReviewReason("LINK_TARGET_NOT_FOUND").key).toBe("linkReason.TARGET_NOT_FOUND");
    expect(describeReviewReason("LINK_WEIRD").key).toBe("linkReason.unknown");
    expect(describeReviewReason("WHATEVER").key).toBe("reviewReason.unknown");
  });
});
