/**
 * Coverage tests for disciplinary/state-machine.ts (0% → target: 100%).
 * Pure state machine — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertMajorPenaltyInquiry,
  penaltyClassOf,
  MINOR_PENALTIES,
  MAJOR_PENALTIES,
  type CaseStatus,
  type CaseAction,
} from "../src/modules/disciplinary/state-machine.js";

describe("disciplinary/state-machine — canTransition()", () => {
  // Major proceeding flow
  it("opened → issue_charge_memo → charge_memo_issued (major)", () => {
    const r = canTransition("opened", "issue_charge_memo", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("charge_memo_issued");
  });

  it("charge_memo_issued → appoint_inquiry → inquiry_appointed (major)", () => {
    const r = canTransition("charge_memo_issued", "appoint_inquiry", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("inquiry_appointed");
  });

  it("inquiry_appointed → record_finding → finding_recorded", () => {
    const r = canTransition("inquiry_appointed", "record_finding", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("finding_recorded");
  });

  it("finding_recorded → impose_penalty → penalty_imposed (major)", () => {
    const r = canTransition("finding_recorded", "impose_penalty", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("penalty_imposed");
  });

  it("finding_recorded → submit_for_approval → pending_approval", () => {
    const r = canTransition("finding_recorded", "submit_for_approval", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("pending_approval");
  });

  it("pending_approval → impose_penalty → penalty_imposed", () => {
    const r = canTransition("pending_approval", "impose_penalty", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("penalty_imposed");
  });

  it("penalty_imposed → file_appeal → appeal_filed", () => {
    const r = canTransition("penalty_imposed", "file_appeal", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("appeal_filed");
  });

  it("appeal_filed → decide_appeal → appeal_decided", () => {
    const r = canTransition("appeal_filed", "decide_appeal", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("appeal_decided");
  });

  it("penalty_imposed → close → closed", () => {
    const r = canTransition("penalty_imposed", "close", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("closed");
  });

  it("appeal_decided → close → closed", () => {
    const r = canTransition("appeal_decided", "close", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("closed");
  });

  // Minor proceeding shortcuts
  it("charge_memo_issued → impose_penalty (minor only)", () => {
    const r = canTransition("charge_memo_issued", "impose_penalty", "minor");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("penalty_imposed");
  });

  it("charge_memo_issued → submit_for_approval (minor)", () => {
    const r = canTransition("charge_memo_issued", "submit_for_approval", "minor");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("pending_approval");
  });

  // Block appoint_inquiry for minor
  it("blocks appoint_inquiry for minor proceeding", () => {
    const r = canTransition("charge_memo_issued", "appoint_inquiry", "minor");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("requires a major proceeding");
  });

  // Drop actions
  it("opened → drop → dropped", () => {
    const r = canTransition("opened", "drop", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("dropped");
  });

  it("pending_approval → drop → dropped (eOffice rejected)", () => {
    const r = canTransition("pending_approval", "drop", "major");
    expect(r.ok).toBe(true);
    expect(r.to).toBe("dropped");
  });

  // Invalid transitions
  it("rejects invalid transition from wrong state", () => {
    const r = canTransition("opened", "impose_penalty", "major");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not allowed from 'opened'");
  });

  it("rejects close from opened", () => {
    const r = canTransition("opened", "close", "major");
    expect(r.ok).toBe(false);
  });

  it("rejects file_appeal from opened", () => {
    const r = canTransition("opened", "file_appeal", "major");
    expect(r.ok).toBe(false);
  });
});

describe("disciplinary/state-machine — penaltyClassOf()", () => {
  it("classifies censure as minor", () => {
    expect(penaltyClassOf("censure")).toBe("minor");
  });

  it("classifies withholding_promotion as minor", () => {
    expect(penaltyClassOf("withholding_promotion")).toBe("minor");
  });

  it("classifies dismissal as major", () => {
    expect(penaltyClassOf("dismissal")).toBe("major");
  });

  it("classifies removal_from_service as major", () => {
    expect(penaltyClassOf("removal_from_service")).toBe("major");
  });

  it("classifies compulsory_retirement as major", () => {
    expect(penaltyClassOf("compulsory_retirement")).toBe("major");
  });

  it("returns null for unknown penalty type", () => {
    expect(penaltyClassOf("unknown_type")).toBeNull();
  });

  it("all MINOR_PENALTIES are classified as minor", () => {
    for (const p of MINOR_PENALTIES) {
      expect(penaltyClassOf(p)).toBe("minor");
    }
  });

  it("all MAJOR_PENALTIES are classified as major", () => {
    for (const p of MAJOR_PENALTIES) {
      expect(penaltyClassOf(p)).toBe("major");
    }
  });
});

describe("disciplinary/state-machine — assertMajorPenaltyInquiry()", () => {
  it("passes for minor proceeding without inquiry", () => {
    expect(assertMajorPenaltyInquiry({ proceedingType: "minor" }).ok).toBe(true);
  });

  it("passes for minor penalty type regardless of proceeding type label", () => {
    expect(assertMajorPenaltyInquiry({ proceedingType: "minor", penaltyType: "censure" }).ok).toBe(true);
  });

  it("blocks major proceeding without charge memo", () => {
    const r = assertMajorPenaltyInquiry({ proceedingType: "major", penaltyType: "dismissal" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("charge memo");
  });

  it("blocks major proceeding without inquiry officer", () => {
    const r = assertMajorPenaltyInquiry({
      proceedingType: "major", penaltyType: "dismissal",
      chargeMemoRef: "CM-1",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("inquiry officer");
  });

  it("blocks major proceeding without finding", () => {
    const r = assertMajorPenaltyInquiry({
      proceedingType: "major", penaltyType: "dismissal",
      chargeMemoRef: "CM-1", inquiryOfficerId: "officer-1",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("finding");
  });

  it("passes when all inquiry steps are complete", () => {
    const r = assertMajorPenaltyInquiry({
      proceedingType: "major", penaltyType: "dismissal",
      chargeMemoRef: "CM-1", inquiryOfficerId: "officer-1",
      finding: "guilty", findingDate: "2026-05-01",
    });
    expect(r.ok).toBe(true);
  });

  it("detects major penalty type even when proceedingType says minor", () => {
    // A major penalty proposed on a "minor" labeled case still requires inquiry
    const r = assertMajorPenaltyInquiry({
      proceedingType: "minor", penaltyType: "dismissal",
    });
    expect(r.ok).toBe(false);
  });
});
