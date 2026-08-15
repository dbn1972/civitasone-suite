import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { MedicalClaimForm } from "./MedicalClaimForm";

describe("MedicalClaimForm", () => {
  it("renders CGHS policy note", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/CGHS \/ CS\(MA\) Rules 1944/i)).toBeInTheDocument();
  });

  it("renders Employee ID field", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });

  it("renders Date of Treatment field", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/date of treatment/i)).toBeInTheDocument();
  });

  it("renders Hospital field", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/hospital \/ clinic name/i)).toBeInTheDocument();
  });

  it("renders Diagnosis field", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/diagnosis/i)).toBeInTheDocument();
  });

  it("renders Claim Type dropdown with Indoor and Outdoor options", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/claim type/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Indoor" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Outdoor" })).toBeInTheDocument();
  });

  it("renders Amount field", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });

  it("renders CGHS Ward Entitlement dropdown", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/cghs ward entitlement/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Private" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "General" })).toBeInTheDocument();
  });

  it("renders Referral Status dropdown", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByLabelText(/referral status/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Not Required" })).toBeInTheDocument();
  });

  it("renders Submit Claim and Cancel buttons", () => {
    render(<MedicalClaimForm />);
    expect(screen.getByRole("button", { name: /submit claim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("submit button has min 44px touch target", () => {
    render(<MedicalClaimForm />);
    const btn = screen.getByRole("button", { name: /submit claim/i });
    expect(btn).toHaveStyle({ minHeight: "44px" });
  });

  it("shows validation errors for empty required fields on submit", async () => {
    render(<MedicalClaimForm />);
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("shows error when amount is 0", async () => {
    render(<MedicalClaimForm />);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => /valid amount/i.test(a.textContent ?? ""))).toBe(true);
  });

  it("defaults claim type to Outdoor", () => {
    render(<MedicalClaimForm />);
    const select = screen.getByLabelText(/claim type/i) as HTMLSelectElement;
    expect(select.value).toBe("Outdoor");
  });

  it("defaults CGHS ward to General", () => {
    render(<MedicalClaimForm />);
    const select = screen.getByLabelText(/cghs ward entitlement/i) as HTMLSelectElement;
    expect(select.value).toBe("General");
  });
});
