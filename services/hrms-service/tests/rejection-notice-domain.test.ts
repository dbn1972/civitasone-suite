/**
 * R-RA-0118 — candidate-facing rejection notice domain (pure).
 * The critical guarantee: internal scoring/remarks/screener identity never leak.
 */
import { describe, it, expect } from "vitest";
import {
  buildRejectionNotice, candidateOutcome, REJECTION_REASON_LABELS, INTERNAL_ONLY_FIELDS,
} from "../src/modules/recruitment/rejection-notice.js";

const baseApp = {
  id: "app-1", applicantName: "A Candidate", applicationNo: "APP-001",
  jobOpeningId: "job-1", screeningDecision: "ineligible", screeningReasonCode: "experience",
};

describe("candidateOutcome", () => {
  it("maps internal decisions to neutral candidate outcomes", () => {
    expect(candidateOutcome("ineligible")).toBe("not_selected");
    expect(candidateOutcome("shortlisted")).toBe("shortlisted");
    expect(candidateOutcome("waitlisted")).toBe("waitlisted");
    expect(candidateOutcome("eligible")).toBe("under_consideration");
    expect(candidateOutcome("manual_review")).toBe("under_consideration");
    expect(candidateOutcome("pending")).toBe("under_review");
  });
});

describe("buildRejectionNotice", () => {
  it("never emits any internal-only field, even when passed extra internal data", () => {
    const polluted = { ...baseApp, screeningRemarks: "weak; scored 32/100", screenedBy: "officer-9", eligibilityResult: { eligible: false, score: 32 }, rank: 7 } as never;
    const notice = buildRejectionNotice(polluted, { discloseReason: true });
    const keys = Object.keys(notice);
    for (const f of INTERNAL_ONLY_FIELDS) expect(keys).not.toContain(f);
    const blob = JSON.stringify(notice);
    expect(blob).not.toContain("32");        // no numeric score leaks
    expect(blob).not.toContain("officer-9"); // no screener identity
    expect(blob).not.toContain("weak");      // no internal remark text
  });

  it("omits the reason when the policy flag is off", () => {
    const notice = buildRejectionNotice(baseApp, { discloseReason: false });
    expect(notice.outcome).toBe("not_selected");
    expect(notice.reason).toBeUndefined();
  });

  it("includes only the friendly reason CATEGORY label when policy allows", () => {
    const notice = buildRejectionNotice(baseApp, { discloseReason: true });
    expect(notice.reason).toBe(REJECTION_REASON_LABELS.experience);
    expect(notice.reason).toContain("minimum experience requirement"); // friendly sentence, not a raw code/score
  });

  it("never includes a reason for a non-rejection outcome even if policy is on", () => {
    const notice = buildRejectionNotice({ ...baseApp, screeningDecision: "shortlisted" }, { discloseReason: true });
    expect(notice.outcome).toBe("shortlisted");
    expect(notice.reason).toBeUndefined();
  });

  it("falls back to the generic label for an unknown/absent reason code", () => {
    const notice = buildRejectionNotice({ ...baseApp, screeningReasonCode: null }, { discloseReason: true });
    expect(notice.reason).toBe(REJECTION_REASON_LABELS.other);
  });
});
