import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AmendForm } from "./AmendForm";

const PO_ID = "55555555-5555-5555-5555-555555555555";
const LINES = [
  { itemCode: "IC-1", itemName: "Widget", quantity: 10, unit: "nos", unitPrice: 10000, totalPrice: 100000 },
  { itemCode: "IC-2", itemName: "Gadget", quantity: 5, unit: "nos", unitPrice: 20000, totalPrice: 100000 },
];
const CURRENT_TOTAL = 200000; // ₹2,000.00

function renderForm() {
  return render(<AmendForm poId={PO_ID} currentTotalMinor={CURRENT_TOTAL} lineItems={LINES} />);
}

describe("AmendForm — AMEND-04 money + validation", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("a change-order delta of 0 is rejected with an error", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Amendment type *"), { target: { value: "change_order" } });
    fireEvent.change(screen.getByLabelText(/Value change/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Reason for amendment *"), { target: { value: "no-op" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit amendment" }));
    expect(await screen.findByText(/must change the PO value/)).toBeInTheDocument();
  });

  it("a negative delta larger than the PO total is rejected (revised total cannot be negative)", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Amendment type *"), { target: { value: "change_order" } });
    // -2000.01 on a ₹2,000.00 PO -> revised total negative.
    fireEvent.change(screen.getByLabelText(/Value change/), { target: { value: "-2000.01" } });
    fireEvent.change(screen.getByLabelText("Reason for amendment *"), { target: { value: "too big a cut" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit amendment" }));
    expect(await screen.findByText(/revised total cannot be negative/)).toBeInTheDocument();
  });

  it("shows the revised total as current + delta", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Amendment type *"), { target: { value: "change_order" } });
    fireEvent.change(screen.getByLabelText(/Value change/), { target: { value: "5000" } });
    // current ₹2,000 + ₹5,000 = ₹7,000
    expect(await screen.findByText("₹7,000.00")).toBeInTheDocument();
  });
});

describe("AmendForm — AMEND-02 structured amendments", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("a quantity amendment on line 2 posts a computed delta and the line detail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText("Amendment type *"), { target: { value: "quantity" } });
    // Select line 2 (IC-2: qty 5 @ ₹200). New qty 8 -> delta (8-5)*20000 = 60000 paise.
    fireEvent.change(screen.getByLabelText("Line item *"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("New quantity *"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Reason for amendment *"), { target: { value: "more units needed" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit amendment" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.amendmentType).toBe("quantity");
    expect(body.deltaMinor).toBe(60000);
    expect(body.reason).toMatch(/\[Line IC-2\] qty 5 → 8/);
  });

  it("a schedule amendment requires a new date", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Amendment type *"), { target: { value: "schedule" } });
    fireEvent.change(screen.getByLabelText("Reason for amendment *"), { target: { value: "slip delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit amendment" }));
    expect(await screen.findByText(/Choose the new delivery/)).toBeInTheDocument();
  });
});

describe("AmendForm — AMEND-05 navigation & success", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("Cancel is a link to the PO (not history.back)", () => {
    renderForm();
    const cancel = screen.getByRole("link", { name: "Cancel" });
    expect(cancel).toHaveAttribute("href", `/procurement/orders/${PO_ID}`);
  });

  it("after a successful submit, a persistent success panel with a back link is shown (no auto-redirect)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText("Amendment type *"), { target: { value: "scope" } });
    fireEvent.change(screen.getByLabelText("Reason for amendment *"), { target: { value: "scope note" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit amendment" }));

    expect(await screen.findByText("Amendment submitted for approval.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to purchase order" })).toHaveAttribute("href", `/procurement/orders/${PO_ID}`);
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("AmendForm — amendment type labels (regression)", () => {
  // Regression: the old label formatter used a corrupted regex (a raw 0x08 byte
  // instead of \b), so multi-word options were never capitalised. Labels are
  // now an explicit map; they must read as human labels, never raw snake_case,
  // and each must start with a capital letter.
  it("renders human-readable, capitalised labels for every amendment type (incl. multi-word)", () => {
    renderForm();
    const select = screen.getByLabelText("Amendment type *") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels).toEqual([
      "Quantity change",
      "Price change",
      "Schedule change",
      "Scope change",
      "Change order (value)",
    ]);
    for (const l of labels) {
      expect(l).not.toMatch(/_/);
      expect(l).toMatch(/^[A-Z]/);
      // eslint-disable-next-line no-control-regex
      expect(l).not.toMatch(/[\x00-\x1f]/);
    }
  });
});
