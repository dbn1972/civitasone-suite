import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import NewAnnualPlanPage from "./page";
import { estimatedValueRupees } from "./estimatedValueRupees";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/financial year/i), { target: { value: "2027" } });
  fireEvent.change(screen.getByLabelText(/department/i), { target: { value: "Finance" } });
  fireEvent.change(screen.getByLabelText(/plan title/i), { target: { value: "Annual plan FY27" } });
}

describe("NewAnnualPlanPage — server error handling (UX-003)", () => {
  beforeEach(() => {
    mockPush.mockReset();
    vi.restoreAllMocks();
  });

  it("renders inline field-level messages from a fieldErrors response, not just a raw error string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "department", message: "Department must match an active office." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    render(<NewAnnualPlanPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    expect(
      await screen.findByText("Department must match an active office."),
    ).toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code or raw server error text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/plans.js:33:7)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    render(<NewAnnualPlanPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });

  it("still submits successfully and shows the success message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }),
    );

    render(<NewAnnualPlanPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() =>
      expect(screen.getByText(/Plan submitted/i)).toBeInTheDocument(),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/procurement/plans",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// ---------------------------------------------------------------------------
// UX-018: estimatedValueMinor is always a real number in this form today (it's
// local state seeded by emptyLine()/updateLine(), never hydrated from a fetched
// row), so this is a defensive guard rather than a fix for a currently-reachable
// bug. Test the guard directly: it must never let a missing value reach the
// input as NaN, and 0 (not "—") is the correct fallback for an editable field.
// ---------------------------------------------------------------------------
describe("estimatedValueRupees (UX-018 defensive guard)", () => {
  it("falls back to 0, never NaN, for a missing minor value", () => {
    expect(estimatedValueRupees(null)).toBe(0);
    expect(estimatedValueRupees(undefined)).toBe(0);
    expect(Number.isNaN(estimatedValueRupees(null))).toBe(false);
  });

  it("converts a real minor value to rupees", () => {
    expect(estimatedValueRupees(12345)).toBeCloseTo(123.45);
  });

  it("keeps a genuine zero as 0", () => {
    expect(estimatedValueRupees(0)).toBe(0);
  });
});
