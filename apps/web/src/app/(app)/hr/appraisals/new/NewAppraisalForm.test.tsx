import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { NewAppraisalForm } from "./NewAppraisalForm";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", department: "IT", status: "active" }];

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `Request failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("NewAppraisalForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(<NewAppraisalForm employees={EMPLOYEES} />);
    fireEvent.change(screen.getByLabelText(/appraisal period/i), { target: { value: "2025-26" } });
    fireEvent.click(screen.getByRole("button", { name: /create appraisal/i }));
  }

  it("shows a clerk-safe message, never the raw server text, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("upstream hrms-service timeout at worker-3", { status: 500 }));
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/upstream hrms-service timeout/);
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "appraisalPeriod", message: "Period must match YYYY-YY." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Period must match YYYY-YY.")).toBeInTheDocument();
  });
});
