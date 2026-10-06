import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { WaiverForm } from "./WaiverForm";
import type { DemandOption } from "./page";

const DEMANDS: DemandOption[] = [
  {
    id: "d1111111-1111-1111-1111-111111111111",
    financialYear: "2024-25",
    dueDate: "2025-03-31",
    netMinor: "500000",
    penaltyMinor: "50000", // ₹500
    interestMinor: "30000", // ₹300
    status: "pending",
  },
];

function renderForm() {
  render(<WaiverForm assesseeId="a1" assesseeName="Ravi Kumar" demands={DEMANDS} />);
}

describe("WaiverForm (GAP-REVENUE-WAIVERS-01/02/04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has no UUID inputs — assessee is shown by name and demand via a select", () => {
    renderForm();
    expect(screen.queryByPlaceholderText(/xxxxxxxx-xxxx/)).not.toBeInTheDocument();
    expect(screen.getByText(/Raise Waiver — Ravi Kumar/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Demand/)).toBeInTheDocument();
  });

  it("uses a rupees amount field, not paise", () => {
    renderForm();
    expect(screen.getByText(/Amount \(₹\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Amount \(paise\)/)).not.toBeInTheDocument();
  });

  it("caps the amount at the demand's penalty when type=penalty", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Demand/), { target: { value: DEMANDS[0].id } });
    fireEvent.change(screen.getByLabelText(/Waiver Type/), { target: { value: "penalty" } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "600" } }); // > ₹500 penalty
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Hardship" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Waiver" }));
    expect(
      await screen.findByText(/cannot exceed the outstanding penalty\/interest/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Submit this waiver for approval?")).not.toBeInTheDocument();
  });

  it("caps 'both' at penalty + interest combined and shows the helper text", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Demand/), { target: { value: DEMANDS[0].id } });
    fireEvent.change(screen.getByLabelText(/Waiver Type/), { target: { value: "both" } });
    // penalty 500 + interest 300 = 800 cap
    expect(screen.getByText(/Max waivable \(penalty \+ interest\): ₹800\.00/)).toBeInTheDocument();
    expect(screen.getByText(/applies this single amount against the demand/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "801" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Hardship" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Waiver" }));
    expect(await screen.findByText(/cannot exceed/)).toBeInTheDocument();
  });

  it("opens a ConfirmDialog with name, FY, type and amount, and posts on confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "w-1" }), { status: 202 }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(/Demand/), { target: { value: DEMANDS[0].id } });
    fireEvent.change(screen.getByLabelText(/Waiver Type/), { target: { value: "penalty" } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Hardship" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Waiver" }));

    await waitFor(() => expect(screen.getByText("Submit this waiver for approval?")).toBeInTheDocument());
    expect(screen.getByText("₹250.00")).toBeInTheDocument();
    expect(screen.getByText("2024-25")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit waiver" }));
    await waitFor(() => {
      const post = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.amountMinor).toBe("25000");
      expect(body.waiverType).toBe("penalty");
      expect(body.demandId).toBe(DEMANDS[0].id);
    });
  });

  it("cancelling the dialog sends no request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    fireEvent.change(screen.getByLabelText(/Demand/), { target: { value: DEMANDS[0].id } });
    fireEvent.change(screen.getByLabelText(/Waiver Type/), { target: { value: "interest" } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Hardship" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Waiver" }));
    await waitFor(() => expect(screen.getByText("Submit this waiver for approval?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks submit when the demand is not chosen", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Waiver Type/), { target: { value: "penalty" } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Hardship" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Waiver" }));
    expect(await screen.findByText("Select the demand to waive against.")).toBeInTheDocument();
  });
});
