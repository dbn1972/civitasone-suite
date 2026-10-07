/**
 * GAP-DESIGNER-DETAIL-B1-02: DPDP compliance — sensitive attributes (Aadhaar,
 * PAN, DOB) carry a sensitivity badge, a lawful-basis notice, and default to
 * optional (required:false) when first bound.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApplicantTypesForm, isSensitiveAttribute, type ApplicantTypesValues } from "./ApplicantTypesForm";

vi.mock("../_data/designerApi", () => ({
  updateServiceDefinition: vi.fn().mockResolvedValue(undefined),
}));

const initial: ApplicantTypesValues = {
  allowedApplicantTypes: ["citizen"],
  applicantTypeRejectMessage: "",
  profileAttributeBindings: [],
  servicePattern: "certificate",
};

describe("ApplicantTypesForm DPDP sensitive attribute handling (GAP-DESIGNER-DETAIL-B1-02)", () => {
  it("marks aadhaarLast4, pan and dateOfBirth as sensitive", () => {
    expect(isSensitiveAttribute("aadhaarLast4")).toBe(true);
    expect(isSensitiveAttribute("pan")).toBe(true);
    expect(isSensitiveAttribute("dateOfBirth")).toBe(true);
  });

  it("does NOT mark non-sensitive attrs like fullName or ward", () => {
    expect(isSensitiveAttribute("fullName")).toBe(false);
    expect(isSensitiveAttribute("ward")).toBe(false);
    expect(isSensitiveAttribute("mobile")).toBe(false);
  });

  it("shows a Sensitive badge on Aadhaar and PAN attributes", () => {
    render(
      <ApplicantTypesForm
        definitionId="d1"
        initial={initial}
        servicePattern="certificate"
      />,
    );
    // Aadhaar (last 4), PAN and Date of birth should have the badge
    const badges = screen.getAllByText("Sensitive");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the DPDP lawful-basis notice for sensitive attributes", () => {
    render(
      <ApplicantTypesForm
        definitionId="d1"
        initial={initial}
        servicePattern="certificate"
      />,
    );
    const notices = screen.getAllByRole("note");
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0]!.textContent).toMatch(/DPDP|Aadhaar Act/i);
  });
});
