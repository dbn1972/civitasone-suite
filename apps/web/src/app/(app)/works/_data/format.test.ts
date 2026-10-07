import { describe, it, expect } from "vitest";
import {
  progressBucket,
  modeLabel,
  billStatusLabel,
  nextFinalizeStep,
  BILL_FINALIZE_SEQUENCE,
  MB_FINALIZE_SEQUENCE,
} from "./format";

describe("progressBucket (GAP-WORKS-EXECUTION-03)", () => {
  it("places each sample percentage in exactly one bucket", () => {
    expect(progressBucket(0)).toBe("notStarted");
    expect(progressBucket(30)).toBe("atRisk");
    expect(progressBucket(50)).toBe("inProgress");
    expect(progressBucket(79)).toBe("inProgress");
    expect(progressBucket(80)).toBe("onTrack");
    expect(progressBucket(99)).toBe("onTrack");
    expect(progressBucket(100)).toBe("completed");
  });

  it("buckets a set of rows so the five counts sum to the total", () => {
    const pcts = [0, 10, 49, 50, 60, 79, 80, 95, 100, 100];
    const counts = { completed: 0, onTrack: 0, inProgress: 0, atRisk: 0, notStarted: 0 };
    for (const p of pcts) counts[progressBucket(p)] += 1;
    const sum = counts.completed + counts.onTrack + counts.inProgress + counts.atRisk + counts.notStarted;
    expect(sum).toBe(pcts.length);
    expect(counts).toEqual({ completed: 2, onTrack: 2, inProgress: 3, atRisk: 2, notStarted: 1 });
  });

  it("treats non-finite input as notStarted (never crashes a stat card)", () => {
    expect(progressBucket(Number.NaN)).toBe("notStarted");
  });
});

describe("modeLabel (GAP-WORKS-BILLING-01)", () => {
  it("renders the canonical e-MB label, not humanize's 'E mb'", () => {
    expect(modeLabel("e_mb")).toBe("e-MB");
  });
  it("renders Abstract", () => {
    expect(modeLabel("abstract")).toBe("Abstract");
  });
  it("falls back to humanize for an unknown mode", () => {
    expect(modeLabel("item_rate")).toBe("Item rate");
  });
  it("renders a dash for empty/nullish", () => {
    expect(modeLabel("")).toBe("—");
    expect(modeLabel(null)).toBe("—");
  });
});

describe("billStatusLabel (GAP-WORKS-BILLING-WORKID-06)", () => {
  it("humanizes the granular workflow status", () => {
    expect(billStatusLabel("so_finalized")).toBe("So finalized");
    expect(billStatusLabel("submitted")).toBe("Submitted");
  });
});

describe("nextFinalizeStep (GAP-WORKS-BILLING-WORKID-02)", () => {
  it("starts the sequence only from draft", () => {
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "draft")).toBe("so_finalized");
  });
  it("advances one step within the sequence", () => {
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "so_finalized")).toBe("sdo_finalized");
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "dao_finalized")).toBe("do_finalized");
  });
  it("returns null at the terminal finalize step", () => {
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "do_finalized")).toBeNull();
  });
  it("returns null for an already-submitted bill — no spurious '→ So finalized' (the old seq[0] fallback bug)", () => {
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "submitted")).toBeNull();
  });
  it("returns null for an unknown/garbage status", () => {
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "finalized")).toBeNull();
    expect(nextFinalizeStep(BILL_FINALIZE_SEQUENCE, "")).toBeNull();
  });
  it("works for the MB sequence too", () => {
    expect(nextFinalizeStep(MB_FINALIZE_SEQUENCE, "draft")).toBe("so_finalized");
    expect(nextFinalizeStep(MB_FINALIZE_SEQUENCE, "estimator_finalized")).toBe("do_finalized");
    expect(nextFinalizeStep(MB_FINALIZE_SEQUENCE, "do_finalized")).toBeNull();
  });
});
