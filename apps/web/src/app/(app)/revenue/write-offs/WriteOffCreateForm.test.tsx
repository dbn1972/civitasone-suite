import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { WriteOffCreateForm } from "./WriteOffCreateForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1200.00" } });
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Deceased assessee, no legal heir traced" } });
}

describe("WriteOffCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires amount and reason before opening the confirm dialog", () => {
    render(<WriteOffCreateForm assesseeId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(
      screen.getByText("Enter a valid amount greater than zero, with at most 2 decimal places."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reason is required.")).toBeInTheDocument();
  });

  it("raises a write-off on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "wo-1", status: "accepted" }), { status: 202 }),
    );

    render(<WriteOffCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));

    await waitFor(() => expect(screen.getByText("Raise this write-off?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise write-off"));

    await waitFor(() => {
      expect(screen.getByText(/Write-off raised/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<WriteOffCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));

    await waitFor(() => expect(screen.getByText("Raise this write-off?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise write-off"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });

  it("shows outstanding arrears and blocks an amount above the cap (GAP-REVENUE-WRITE-OFFS-01)", async () => {
    render(
      <WriteOffCreateForm assesseeId="a1" assesseeName="Ravi Kumar" outstandingMinor="150000" />,
    );
    expect(screen.getByText("₹1,500.00")).toBeInTheDocument(); // outstanding shown
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "2000" } }); // > ₹1,500
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Irrecoverable" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));
    expect(
      await screen.findByText("Amount cannot exceed the outstanding arrears shown above."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Raise this write-off?")).not.toBeInTheDocument();
  });

  it("allows an amount within the cap and shows the balance-after (GAP-REVENUE-WRITE-OFFS-01)", async () => {
    render(
      <WriteOffCreateForm assesseeId="a1" assesseeName="Ravi Kumar" outstandingMinor="150000" />,
    );
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Irrecoverable" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));
    await waitFor(() => expect(screen.getByText("Raise this write-off?")).toBeInTheDocument());
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
  });

  it("fails closed when the DCB could not load: disables submit (GAP-REVENUE-WRITE-OFFS-01)", () => {
    render(<WriteOffCreateForm assesseeId="a1" dcbUnavailable />);
    expect(screen.getByRole("button", { name: "Raise Write-off" })).toBeDisabled();
    expect(screen.getByText(/couldn't load this assessee's outstanding balance/i)).toBeInTheDocument();
  });

  it("sends demandId + financialYear when a demand is selected (GAP-REVENUE-WRITE-OFFS-03)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "wo-9" }), { status: 202 }),
    );
    render(
      <WriteOffCreateForm
        assesseeId="a1"
        assesseeName="Ravi Kumar"
        outstandingMinor="150000"
        demands={[{ id: "demand-9", financialYear: "2024-25", netMinor: "120000", status: "pending" }]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Demand \(optional\)/), { target: { value: "demand-9" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Irrecoverable" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));
    await waitFor(() => expect(screen.getByText("Raise this write-off?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise write-off"));
    await waitFor(() => {
      const post = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.demandId).toBe("demand-9");
      expect(body.financialYear).toBe("2024-25");
    });
  });
});
