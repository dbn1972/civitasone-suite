import { describe, it, expect } from "vitest";
import { nextStageStatus } from "../src/modules/stages/domain.js";

describe("stage lifecycle transitions", () => {
  it("run: pending/active/skipped -> in_progress, nothing else", () => {
    for (const s of ["pending", "active", "skipped"]) expect(nextStageStatus("run", s)).toBe("in_progress");
    for (const s of ["in_progress", "completed", "failed"]) expect(nextStageStatus("run", s)).toBeNull();
  });
  it("retry: only failed -> in_progress", () => {
    expect(nextStageStatus("retry", "failed")).toBe("in_progress");
    for (const s of ["pending", "active", "in_progress", "completed", "skipped"]) expect(nextStageStatus("retry", s)).toBeNull();
  });
  it("skip: pending/active/failed -> skipped, never from a running or finished step", () => {
    for (const s of ["pending", "active", "failed"]) expect(nextStageStatus("skip", s)).toBe("skipped");
    for (const s of ["in_progress", "completed", "skipped"]) expect(nextStageStatus("skip", s)).toBeNull();
  });
  it("complete/fail: only in_progress -> completed/failed (Q9)", () => {
    expect(nextStageStatus("complete", "in_progress")).toBe("completed");
    expect(nextStageStatus("fail", "in_progress")).toBe("failed");
    for (const s of ["pending", "active", "failed", "completed", "skipped"]) {
      expect(nextStageStatus("complete", s)).toBeNull();
      expect(nextStageStatus("fail", s)).toBeNull();
    }
  });
});
