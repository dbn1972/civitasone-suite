import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewContractorPage from "./page";

describe("NewContractorPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw backend text, when registering a contractor fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate gst constraint" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));

    // The error banner is a plain div (no role="alert") in this component.
    await waitFor(() => expect(screen.getByText(/This contractor was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/duplicate gst/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });

  // GAP-WORKS-CONTRACTORS-NEW-01: a malformed PAN is caught client-side; fetch is never called.
  it("blocks submission and shows an inline PAN error for a malformed PAN", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.change(screen.getByLabelText("PAN"), { target: { value: "BADPAN" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));
    await waitFor(() => expect(screen.getByText(/valid 10-character PAN/i)).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-WORKS-CONTRACTORS-NEW-01: a valid body reaches the API.
  it("submits when all identifiers are valid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "x" }), { status: 202, headers: { "content-type": "application/json" } }),
    );
    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.change(screen.getByLabelText("PAN"), { target: { value: "AAAPZ1234C" } });
    fireEvent.change(screen.getByLabelText(/Mobile number/i), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(await screen.findByText(/Contractor registered\. Redirecting/i)).toBeInTheDocument();
  });

  // GAP-WORKS-CONTRACTORS-NEW-03 (DPDP): a purpose/notice is shown above the identifiers.
  it("renders a DPDP data-protection notice (role=note)", () => {
    render(<NewContractorPage />);
    const note = screen.getByRole("note", { name: /data protection notice/i });
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/empanelment/i);
  });

  // GAP-WORKS-CONTRACTORS-NEW-04: Odisha-consistent GSTIN placeholder (21..), not Karnataka (29..).
  it("uses an Odisha (21) GSTIN placeholder", () => {
    render(<NewContractorPage />);
    expect(screen.getByLabelText(/GSTIN/i)).toHaveAttribute("placeholder", "21ABCDE1234F1Z5");
  });
});
