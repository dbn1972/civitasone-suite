import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import NewAnnualPlanPage from "./page";
import { estimatedValueRupees } from "./estimatedValueRupees";

const DEPT_ID = "33333333-3333-4333-8333-000000000001";
const DEPT_NAME = "Finance Department";

/**
 * GAP-PROCUREMENT-PLANNING-NEW-02: the department field is now an EntityPicker
 * over GET /v1/hrms/departments, so a fetch stub must answer that endpoint with
 * a department list, and the plan POST separately. `planResponse` is the
 * Response the /procurement/plans POST should return.
 */
function routedFetch(planResponse: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/hrms/departments")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: DEPT_ID, name: DEPT_NAME, code: "FIN" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(planResponse.clone());
  });
}

/** Select the canonical department in the EntityPicker (search → pick option). */
async function selectDepartment() {
  const combo = screen.getByRole("combobox", { name: /department/i });
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: "Fin" } });
  const option = await screen.findByText(DEPT_NAME);
  fireEvent.mouseDown(option);
}

async function fillRequiredFields() {
  // FY is a <select>; pick the next FY start year relative to "now".
  const now = new Date();
  const fyStart = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  fireEvent.change(screen.getByLabelText(/financial year/i), { target: { value: String(fyStart + 1) } });
  await selectDepartment();
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
    routedFetch(
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
    await fillRequiredFields();
    fillFirstLine();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    expect(
      await screen.findByText("Department must match an active office."),
    ).toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code or raw server error text", async () => {
    routedFetch(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/plans.js:33:7)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    render(<NewAnnualPlanPage />);
    await fillRequiredFields();
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
    const fetchSpy = routedFetch(
      new Response(JSON.stringify({ id: "plan-123", status: "accepted", correlationId: "c1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewAnnualPlanPage />);
    await fillRequiredFields();
    fillFirstLine();
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() =>
      expect(screen.getByText(/saved as draft/i)).toBeInTheDocument(),
    );
    const postCall = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/proxy/v1/procurement/plans")!;
    expect(postCall).toBeTruthy();
    // GAP-PROCUREMENT-PLANNING-NEW-02: the canonical department NAME is sent,
    // not a free-typed string.
    expect(JSON.parse((postCall[1] as RequestInit).body as string).department).toBe(DEPT_NAME);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/procurement/planning/plan-123"), { timeout: 2000 });
  });

  it("still submits successfully (202, empty body) and shows the success message", async () => {
    const fetchSpy = routedFetch(new Response(null, { status: 202 }));

    render(<NewAnnualPlanPage />);
    await fillRequiredFields();
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

  it("blocks submit (no plan POST) when every line is blank", async () => {
    const fetchSpy = routedFetch(new Response(null, { status: 202 }));
    render(<NewAnnualPlanPage />);
    await fillRequiredFields(); // but no line filled
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(screen.getByText(/at least one line item/i)).toBeInTheDocument();
    // The department picker may have fetched its list, but no plan POST happened.
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/procurement/plans"))).toBe(false);
  });

  it("disables Remove when there is a single line", () => {
    render(<NewAnnualPlanPage />);
    expect(screen.getByRole("button", { name: "Remove line" })).toBeDisabled();
  });

  it("sends the chosen category and no stray 'quantity' key for a works line", async () => {
    const fetchSpy = routedFetch(
      new Response(JSON.stringify({ id: "p1", status: "accepted", correlationId: "c" }), {
        status: 202, headers: { "content-type": "application/json" },
      }),
    );
    render(<NewAnnualPlanPage />);
    await fillRequiredFields();
    fillFirstLine();
    fireEvent.change(screen.getByLabelText(/Category, line 1/i), { target: { value: "works" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/proxy/v1/procurement/plans")).toBe(true),
    );
    const postCall = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/proxy/v1/procurement/plans")!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
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
