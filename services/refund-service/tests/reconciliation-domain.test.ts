import { describe, it, expect } from "vitest";
import { canComplete, canFail, canReconcile } from "../src/modules/reconciliation/domain.js";

describe("canComplete / canFail", () => {
  it("allow completing or failing from initiated or processing", () => {
    for (const status of ["initiated", "processing"]) {
      expect(canComplete(status)).toBe(true);
      expect(canFail(status)).toBe(true);
    }
  });

  it("refuse completing or failing an already-terminal disbursement", () => {
    for (const status of ["completed", "failed"]) {
      expect(canComplete(status)).toBe(false);
      expect(canFail(status)).toBe(false);
    }
  });
});

describe("canReconcile", () => {
  it("only allows reconciling a completed disbursement", () => {
    expect(canReconcile("completed")).toBe(true);
    expect(canReconcile("initiated")).toBe(false);
    expect(canReconcile("processing")).toBe(false);
    expect(canReconcile("failed")).toBe(false);
  });

  // NOTE: canReconcile is status-only by design and does NOT by itself
  // prevent reconciling the same disbursement twice — reconcile() never
  // changes `status`, so it stays "completed" after the first reconcile.
  // The actual once-only guard lives in reconciliation/repo.ts's reconcile()
  // (WHERE ... AND reconciled_at IS NULL) and is exercised by an
  // integration-level test, not this pure-function one.
});
