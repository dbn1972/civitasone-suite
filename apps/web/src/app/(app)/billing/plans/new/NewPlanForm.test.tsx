import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const browserFetchMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...args: unknown[]) => browserFetchMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { NewPlanForm } from "./NewPlanForm";

function okResponse() {
  return { ok: true, status: 202, json: async () => ({ id: "x", status: "accepted" }), headers: new Headers() };
}

describe("NewPlanForm (GAP-BILLING-PLANS-NEW-01..06)", () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
    pushMock.mockReset();
  });

  it("NEW-01: renders no Billing Interval control (the backend has no interval field)", () => {
    render(<NewPlanForm />);
    expect(screen.queryByText(/billing interval/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Quarterly")).not.toBeInTheDocument();
  });

  it("NEW-04: Government exempt defaults to UNCHECKED and has help text", () => {
    render(<NewPlanForm />);
    const cb = screen.getByRole("checkbox", { name: /government exempt/i });
    expect(cb).not.toBeChecked();
    expect(screen.getByText(/exempt from gst/i)).toBeInTheDocument();
  });

  it("NEW-03: currency picker offers INR only (Government edition)", () => {
    render(<NewPlanForm />);
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["INR"]);
  });

  it("NEW-02: submitting an empty form moves focus to the name field and links its error", () => {
    render(<NewPlanForm />);
    fireEvent.click(screen.getByRole("button", { name: /create plan/i }));
    const name = screen.getByLabelText("Plan Name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    const describedby = name.getAttribute("aria-describedby");
    expect(describedby).toBeTruthy();
    expect(document.getElementById(describedby as string)?.textContent).toMatch(/at least 2 characters/i);
  });

  it("NEW-03: a valid submit opens a confirm dialog and only POSTs after Confirm", async () => {
    browserFetchMock.mockResolvedValueOnce(okResponse());
    render(<NewPlanForm />);
    fireEvent.change(screen.getByLabelText("Plan Name"), { target: { value: "Standard" } });
    fireEvent.change(screen.getByLabelText("Plan Code"), { target: { value: "Standard_Monthly" } });
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "499.00" } });
    fireEvent.click(screen.getByRole("button", { name: /create plan/i }));

    // Dialog is open, no POST yet.
    expect(browserFetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/create this billing plan/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm & create/i }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalledTimes(1));

    const [path, init] = browserFetchMock.mock.calls[0];
    expect(path).toBe("v1/billing/plans");
    const body = JSON.parse((init as RequestInit).body as string);
    // NEW-06: code lowercased. NEW-03: priceMinor computed via string parse (no
    // float), sent as a number to match the backend z.number().int() schema.
    expect(body.code).toBe("standard_monthly");
    expect(body.priceMinor).toBe(49900);
    expect(typeof body.priceMinor).toBe("number");
    expect(body.currency).toBe("INR");
    expect(body.govtExempt).toBe(false);
    // NEW-01: interval is never sent.
    expect(body).not.toHaveProperty("interval");
  });

  it("NEW-03: rejects a 3-decimal amount without POSTing", () => {
    render(<NewPlanForm />);
    fireEvent.change(screen.getByLabelText("Plan Name"), { target: { value: "Standard" } });
    fireEvent.change(screen.getByLabelText("Plan Code"), { target: { value: "std" } });
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: /create plan/i }));
    expect(screen.queryByText(/create this billing plan/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount (₹)")).toHaveFocus();
  });
});
