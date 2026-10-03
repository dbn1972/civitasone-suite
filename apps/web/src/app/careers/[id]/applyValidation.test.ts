import { describe, it, expect } from "vitest";
import {
  CATEGORY_VALUES, RESUME_MAX_BYTES, composeQualification, isPastIsoDate, validateApply, validateResume, type ApplyValues,
} from "./applyValidation";

const base: ApplyValues = { vacancyType: "regular", name: "Priya Das", email: "p@example.com", mobile: "", experience: "", graduationYear: "", stipendExpected: "", availabilityHours: "", consent: true, today: "2026-10-03" };

describe("self-declared category (CAREERS-DETAIL-03)", () => {
  it("accepts the five service categories and blank, rejects anything else", () => {
    for (const c of CATEGORY_VALUES) expect(validateApply({ ...base, category: c }).category).toBeUndefined();
    expect(validateApply({ ...base, category: "" }).category).toBeUndefined();
    expect(validateApply({ ...base, category: "ph" }).category).toMatch(/listed categories/i);
  });
});

describe("date of birth (CAREERS-DETAIL-03)", () => {
  it("must be a real date strictly in the past", () => {
    expect(isPastIsoDate("1995-03-04", "2026-10-03")).toBe(true);
    expect(isPastIsoDate("2026-10-03", "2026-10-03")).toBe(false); // today is not in the past
    expect(isPastIsoDate("2099-01-01", "2026-10-03")).toBe(false);
    expect(isPastIsoDate("1990-02-30", "2026-10-03")).toBe(false);
    expect(isPastIsoDate("03/04/1995", "2026-10-03")).toBe(false);
    expect(isPastIsoDate("1899-12-31", "2026-10-03")).toBe(false);
  });
  it("a future date of birth is a field error; blank is fine", () => {
    expect(validateApply({ ...base, dateOfBirth: "2099-01-01" }).dateOfBirth).toMatch(/date in the past/i);
    expect(validateApply({ ...base, dateOfBirth: "" }).dateOfBirth).toBeUndefined();
  });
});

describe("resume (CAREERS-DETAIL-04)", () => {
  it("accepts PDF, DOC and DOCX up to 5 MB", () => {
    for (const type of ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
      expect(validateResume({ name: "cv", size: 1000, type })).toBeNull();
    }
    expect(validateResume({ name: "cv.pdf", size: RESUME_MAX_BYTES, type: "application/pdf" })).toBeNull();
  });
  it("rejects a 6 MB file and an .exe with clear messages", () => {
    expect(validateResume({ name: "cv.pdf", size: 6 * 1024 * 1024, type: "application/pdf" })).toMatch(/larger than 5 MB/);
    expect(validateResume({ name: "setup.exe", size: 100, type: "application/x-msdownload" })).toMatch(/PDF, DOC or DOCX/);
    expect(validateResume({ name: "cv.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/);
  });
  it("a bad file surfaces as the resume field error in validateApply", () => {
    expect(validateApply({ ...base, resume: { name: "x.exe", size: 5, type: "application/x-msdownload" } }).resume).toBeTruthy();
  });
});

describe("composeQualification (CAREERS-DETAIL-04)", () => {
  it("joins the level and the free-text course / institution", () => {
    expect(composeQualification("Graduate", " B.Com (Hons), State University ")).toBe("Graduate — B.Com (Hons), State University");
    expect(composeQualification("Graduate", "")).toBe("Graduate");
    expect(composeQualification("", "B.Sc.")).toBe("B.Sc.");
    expect(composeQualification("", "")).toBeUndefined();
  });
  it("never exceeds the service's 500 character limit", () => {
    expect(composeQualification("Graduate", "x".repeat(900))!.length).toBe(500);
  });
});

describe("localisable messages (HOME-07)", () => {
  it("validateApply asks the supplied resolver for every message", () => {
    const e = validateApply({ ...base, name: "", email: "bad", consent: false }, (key) => `<<${key}>>`);
    expect(e).toMatchObject({ applicantName: "<<nameRequired>>", email: "<<emailInvalid>>", consent: "<<consentRequired>>" });
  });
});
