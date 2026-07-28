/**
 * Recruitment requisition approval-chain state machine (pure).
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_GOVT_CHAIN, currentStageRole, isFinalStage, canPublish, isEditable, cloneFields, toVacancyType,
} from "../src/modules/recruitment/requisition-domain.js";

const JOB_OPENING_VACANCY_TYPES = new Set(["regular", "internship", "apprenticeship", "contractual", "deputation"]);

describe("toVacancyType", () => {
  it("only ever produces a value the job_openings CHECK constraint accepts", () => {
    const modes = ["direct", "deputation", "absorption", "promotion", "contract", "consultant"];
    const campaigns = ["direct", "campus", "walkin", "referral", "lateral", "apprenticeship", "mass"];
    for (const m of modes) for (const c of campaigns) {
      expect(JOB_OPENING_VACANCY_TYPES.has(toVacancyType(m, c))).toBe(true);
    }
  });
  it("maps the unambiguous cases and defaults to regular", () => {
    expect(toVacancyType("deputation", "direct")).toBe("deputation");
    expect(toVacancyType("contract", "direct")).toBe("contractual");
    expect(toVacancyType("consultant", "direct")).toBe("contractual");
    expect(toVacancyType("direct", "apprenticeship")).toBe("apprenticeship");
    expect(toVacancyType("direct", "campus")).toBe("regular");
    expect(toVacancyType("promotion", "referral")).toBe("regular");
  });
});

describe("currentStageRole", () => {
  it("returns the role for the active stage, null when out of range", () => {
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, 0)).toBe("hiring_manager");
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, 3)).toBe("competent_authority");
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, -1)).toBeNull();
    expect(currentStageRole(DEFAULT_GOVT_CHAIN, 4)).toBeNull();
  });
});

describe("isFinalStage", () => {
  it("is true only at the last chain index", () => {
    expect(isFinalStage(DEFAULT_GOVT_CHAIN, 3)).toBe(true);
    expect(isFinalStage(DEFAULT_GOVT_CHAIN, 2)).toBe(false);
    expect(isFinalStage(DEFAULT_GOVT_CHAIN, -1)).toBe(false);
  });
  it("handles a single-stage chain", () => {
    expect(isFinalStage([{ stage: "HR", role: "hr_admin" }], 0)).toBe(true);
  });
});

describe("canPublish", () => {
  it("only allows publication of a fully-approved requisition (R-RA-0056)", () => {
    expect(canPublish("approved")).toBe(true);
    for (const s of ["draft", "pending_approval", "returned", "on_hold", "cancelled", "closed", "published"]) {
      expect(canPublish(s)).toBe(false);
    }
  });
});

describe("isEditable", () => {
  it("permits edits only for draft/returned", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("returned")).toBe(true);
    expect(isEditable("pending_approval")).toBe(false);
    expect(isEditable("approved")).toBe(false);
  });
});

describe("cloneFields", () => {
  it("carries the hiring spec but drops dates, approvals, status and requisition number (R-RA-0059)", () => {
    const src = {
      title: "SDE", vacancies: 3, recruitmentMode: "direct", reservation: { OBC: 1 },
      requisitionNo: "REQ-OLD", status: "published", currentStage: 3, approvedAt: new Date(),
      publishedOpeningId: "x", submittedAt: new Date(), id: "old",
    };
    const c = cloneFields(src);
    expect(c.title).toBe("SDE");
    expect(c.vacancies).toBe(3);
    expect(c.reservation).toEqual({ OBC: 1 });
    // dropped:
    expect(c.requisitionNo).toBeUndefined();
    expect(c.status).toBeUndefined();
    expect(c.currentStage).toBeUndefined();
    expect(c.approvedAt).toBeUndefined();
    expect(c.publishedOpeningId).toBeUndefined();
    expect(c.id).toBeUndefined();
  });
});
