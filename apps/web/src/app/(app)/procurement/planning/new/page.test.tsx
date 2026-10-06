import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import NewAnnualPlanPage from "./page";
import { estimatedValueRupees } from "./estimatedValueRupees";

function fillRequiredFields() {
  // FY is a <select>; pick the next FY start year relative to "now".
  const now = new Date();
  const fyStart = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  fireEvent.change(screen.getByLabelText(/financial year/i), { target: { value: String(fyStart + 1) } });
  fireEvent.change(screen.getByLabelText(/department/i), { target: { value: "Finance" } });
  fireEvent.change(screen.getByLabelText(/plan title/i), { target: { value: "Annual plan FY" } });
}

function fillFirstLine() {
  fireEvent.change(screen.getByLabelText(/Item code, line 1/i), { target: { value: "LAP-01" } });
  fireEvent.change(screen.getByLabelText(/Description, line 1/i), { target: { value: "Laptop" } });
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
    fillFirstLine();
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
    fillFirstLine();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });

  // GAP-PROCUREMENT-PLANNING-NEW-05: copy must say the plan is a DRAFT, and the
  // user should land on the new plan's detail when the response returns an id.
  it("shows the draft success message and navigates to the new plan detail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "plan-123", status: "accepted", correlationId: "c1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewAnnualPlanPage />);
    fillRequiredFields();
    fillFirstLine();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() =>
      expect(screen.getByText(/saved as draft/i)).toBeInTheDocument(),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/procurement/plans",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/procurement/planning/plan-123"), { timeout: 2000 });
  });

  it("still submits successfully (202, empty body) and shows the success message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<NewAnnualPlanPage />);
    fillRequiredFields();
    fillFirstLine();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(screen.getByText(/saved as draft/i)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/procurement/plans",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// GAP-PROCUREMENT-PLANNING-NEW-03/04: payload shape + guards.
describe("NewAnnualPlanPage — line payload and guards", () => {
  beforeEach(() => {
    mockPush.mockReset();
    vi.restoreAllMocks();
  });

  it("blocks submit (no fetch) when every line is blank", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewAnnualPlanPage />);
    fillRequiredFields(); // but no line filled
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(screen.getByText(/at least one line item/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("disables Remove when there is a single line", () => {
    render(<NewAnnualPlanPage />);
    expect(screen.getByRole("button", { name: "Remove line" })).toBeDisabled();
  });

  it("sends the chosen category and no stray 'quantity' key for a works line", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p1", status: "accepted", correlationId: "c" }), {
        status: 202, headers: { "content-type": "application/json" },
      }),
    );
    render(<NewAnnualPlanPage />);
    fillRequiredFields();
    fillFirstLine();
    fireEvent.change(screen.getByLabelText(/Category, line 1/i), { target: { value: "works" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].procurementCategory).toBe("works");
    expect(body.lines[0]).not.toHaveProperty("quantity");
    expect(body.lines[0].aggregatedQty).toBe(1);
  });
});

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
