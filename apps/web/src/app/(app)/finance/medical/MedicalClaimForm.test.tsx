import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

  // UX-016: the failed-response branch used to show `body.message ??
  // \`Failed (${res.status})\`` -- a raw HTTP status code leak (UX-003).
  // Proves the fix: a failed submit shows a clerk-safe catalogued message,
  // never the raw status.
  it("shows a clerk-safe message when submission fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500 }),
    );

    render(<MedicalClaimForm />);
    fireEvent.change(screen.getByLabelText(/employee id/i), { target: { value: "EMP00123" } });
    fireEvent.change(screen.getByLabelText(/date of treatment/i), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/hospital \/ clinic name/i), { target: { value: "AIIMS Delhi" } });
    fireEvent.change(screen.getByLabelText(/diagnosis/i), { target: { value: "Acute gastritis" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5000" } });

    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/failed \(/i);
  });
});
