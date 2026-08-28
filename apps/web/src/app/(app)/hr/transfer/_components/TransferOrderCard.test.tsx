import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TransferOrderCard, type TransferRow } from "./TransferOrderCard";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function row(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "t-123",
    employee: "Ramesh Kumar",
    fromOffice: "Collectorate, Pune",
    toOffice: "DM Office, Nashik",
    status: "pending",
    ...overrides,
  };
}

describe("TransferOrderCard", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
  });

  it("does not call the API when 'Issue Order' is clicked -- it opens a confirmation first", () => {
    // Regression test: this action used to fire the real lifecycle-transition
    // request directly from the button's onClick, with no confirmation step,
    // even though issuing a transfer order is a hard-to-reverse official action.
    render(<TransferOrderCard transfer={row()} />);

    fireEvent.click(screen.getByText("Issue Order"));

    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Issue the transfer order?")).toBeInTheDocument();
    // Consequence-explaining copy names the employee and the from/to offices
    // (checked within the dialog -- the employee name also appears in the
    // card header behind it).
    expect(within(dialog).getByText(/Ramesh Kumar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Collectorate, Pune/)).toBeInTheDocument();
  });

  it("only calls the API after the dialog is confirmed, and shows the result", async () => {
    render(<TransferOrderCard transfer={row()} />);

    fireEvent.click(screen.getByText("Issue Order"));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Issue Order"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/hrms/lifecycle/transfers/t-123/issue-order");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("lets the officer back out via Cancel without calling the API", () => {
    render(<TransferOrderCard transfer={row({ status: "order_issued" })} />);

    fireEvent.click(screen.getByText("Mark Relieved"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not render the pipeline as actively progressing for a cancelled transfer", () => {
    // Regression test: stageIndex() has no "cancelled" entry and defaulted to
    // 0, so the timeline highlighted "Initiated" as the current/active stage
    // for a cancelled transfer -- directly contradicting the "Cancelled"
    // status pill shown right next to it.
    render(<TransferOrderCard transfer={row({ status: "cancelled" })} />);

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByLabelText("Transfer status timeline")).not.toBeInTheDocument();
    expect(screen.getByText(/cancelled before completing the pipeline/)).toBeInTheDocument();
  });

  it("falls back to the employee id when no resolved employee name is present", () => {
    render(<TransferOrderCard transfer={row({ employee: undefined, employeeId: "emp-999" })} />);
    expect(screen.getByText("emp-999")).toBeInTheDocument();
  });
});
