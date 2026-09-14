import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { OvertimeClaimForm } from "./OvertimeClaimForm";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/employee id/i), {
    target: { value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  });
  fireEvent.change(screen.getByLabelText(/date of overtime/i), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText(/hours worked ot/i), { target: { value: "2" } });
}

describe("OvertimeClaimForm", () => {
  it("renders CCS Rules policy note", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/CCS Rules/i)).toBeInTheDocument();
  });

  it("renders Employee ID, Date, and Hours fields", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of overtime/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hours worked ot/i)).toBeInTheDocument();
  });

  it("renders cash and comp-off radio buttons", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/cash payment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/compensatory leave/i)).toBeInTheDocument();
  });

  it("defaults to cash compensation", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/cash payment/i)).toBeChecked();
  });

  it("allows switching to comp-off mode", () => {
    render(<OvertimeClaimForm />);
    const compOff = screen.getByLabelText(/compensatory leave/i);
    fireEvent.click(compOff);
    expect(compOff).toBeChecked();
  });

  it("renders duty officer and purpose fields", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/duty officer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/purpose/i)).toBeInTheDocument();
  });

  it("renders Submit Claim and Cancel buttons", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByRole("button", { name: /submit claim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows error when hours is 0 on submit", async () => {
    render(<OvertimeClaimForm />);
    fireEvent.change(screen.getByLabelText(/hours worked ot/i), { target: { value: "0" } });
    // Dispatch `submit` on the form directly rather than clicking the submit
    // button: the Hours field's `min="0.5"` and the other `required` fields
    // being empty would otherwise trip the browser's own constraint
    // validation on a real click and the submit handler (where the hours<=0
    // check actually lives) would never run.
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("buttons have min 44px accessible touch targets via class", () => {
    render(<OvertimeClaimForm />);
    const btn = screen.getByRole("button", { name: /submit claim/i });
    expect(btn).toBeInTheDocument();
    // Style is set inline; check style attribute presence
    expect(btn).toHaveStyle({ minHeight: "44px" });
  });
});

/**
 * UX-016: this used to show the raw server `message` (falling back to
 * `Server error ${res.status}`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("OvertimeClaimForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<OvertimeClaimForm />);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "hoursRequested", message: "Hours must be a valid number." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    render(<OvertimeClaimForm />);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));

    expect(await screen.findByText("Hours must be a valid number.")).toBeInTheDocument();
  });
});
