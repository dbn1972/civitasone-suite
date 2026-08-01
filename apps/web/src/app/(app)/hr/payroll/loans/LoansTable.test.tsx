import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { LoansTable, type LoanRow } from "./LoansTable";

const rows: LoanRow[] = [
  { id: "l1", loanNo: "LN-1", loanType: "personal", principalMinor: "100000", outstandingMinor: "100000", emiMinor: "10000", tenureMonths: 10, status: "applied" },
];

const twoRows: LoanRow[] = [
  ...rows,
  { id: "l2", loanNo: "LN-2", loanType: "vehicle", principalMinor: "200000", outstandingMinor: "200000", emiMinor: "20000", tenureMonths: 20, status: "applied" },
];

describe("LoansTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders loan rows", () => {
    render(<LoansTable rows={rows} />);
    expect(screen.getByText("LN-1")).toBeInTheDocument();
  });

  it("gives each row's Disburse button a unique accessible name", () => {
    render(<LoansTable rows={twoRows} />);
    expect(screen.getByRole("button", { name: "Disburse loan LN-1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disburse loan LN-2" })).toBeInTheDocument();
  });

  it("disburses a loan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "l1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<LoansTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /^Disburse/ }));

    await waitFor(() => expect(screen.getByText("Disburse this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Disburse loan"));

    await waitFor(() => {
      expect(screen.getByText("Loan disbursement queued.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<LoansTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /^Disburse/ }));

    await waitFor(() => expect(screen.getByText("Disburse this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Disburse loan"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
