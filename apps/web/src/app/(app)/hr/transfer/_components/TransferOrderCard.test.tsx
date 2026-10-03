import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-HR-TRANSFER-10: the transfer UI is translated client-side, so every render needs a provider.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
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
    // GAP-HR-TRANSFER-07/08: "pending" was never a real backend status --
    // POST /transfers actually creates "requested" (lifecycle/consumer.ts);
    // the button gates below now match the real enum.
    status: "requested",
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

  it("does not call the API when 'Issue Order' is clicked -- it opens the order form first", () => {
    // Regression test: this action used to fire the real lifecycle-transition
    // request directly from the button's onClick, with no confirmation step,
    // even though issuing a transfer order is a hard-to-reverse official action.
    render(<TransferOrderCard transfer={row()} />);

    fireEvent.click(screen.getByText("Issue Order"));

    expect(fetchMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Issue the transfer order?")).toBeInTheDocument();
    // Consequence-explaining copy names the employee and the from/to offices
    // (checked within the dialog -- the employee name also appears in the
    // card header behind it).
    expect(within(dialog).getByText(/Ramesh Kumar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Collectorate, Pune/)).toBeInTheDocument();
  });

  // GAP-HR-TRANSFER-02: the order number is typed by the officer -- never the
  // old fabricated TO-<uuid prefix>.
  it("requires an order number and posts exactly what the officer typed (no fabricated TO-xxxx value)", async () => {
    render(<TransferOrderCard transfer={row()} />);

    fireEvent.click(screen.getByText("Issue Order"));
    const dialog = screen.getByRole("dialog");
    const orderNo = within(dialog).getByLabelText(/Order No/);
    expect((orderNo as HTMLInputElement).value).toBe("");

    // blank -> blocked, nothing sent
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));
    expect(await within(dialog).findByText("Enter the order number.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // illegal characters -> blocked
    fireEvent.change(orderNo, { target: { value: "TO 12 #" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));
    expect(await within(dialog).findByText(/Use letters, digits/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(orderNo, { target: { value: " 12/2026-Estt " } });
    fireEvent.change(within(dialog).getByLabelText(/Order reference/), { target: { value: "File 4/7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/hrms/lifecycle/transfers/t-123/issue-order");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.orderNo).toBe("12/2026-Estt");
    expect(body.orderRef).toBe("File 4/7");
    expect(body.orderNo).not.toMatch(/^TO-/);
    expect(body.orderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("refuses a future order date client-side", async () => {
    render(<TransferOrderCard transfer={row()} />);
    fireEvent.click(screen.getByText("Issue Order"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Order No/), { target: { value: "55" } });
    fireEvent.change(within(dialog).getByLabelText(/Order Date/), { target: { value: "2999-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));
    expect(await within(dialog).findByText("The order date cannot be in the future.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a clerk-safe message when the server says the order number is already used", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "ORDER_NO_EXISTS", message: "dup" }), { status: 409 }));
    render(<TransferOrderCard transfer={row()} />);
    fireEvent.click(screen.getByText("Issue Order"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Order No/), { target: { value: "55" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).not.toMatch(/ORDER_NO_EXISTS|409|dup/);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("lets the officer back out via Cancel without calling the API", () => {
    render(<TransferOrderCard transfer={row({ status: "ordered" })} />);

    fireEvent.click(screen.getByText("Mark Relieved"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not render the pipeline as actively progressing for a cancelled transfer", () => {
    // Regression test: the pipeline previously had no "cancelled" entry and
    // defaulted to index 0, so the timeline highlighted "Requested" as the
    // current/active stage for a cancelled transfer -- directly
    // contradicting the "Cancelled" status pill shown right next to it.
    render(<TransferOrderCard transfer={row({ status: "cancelled" })} />);

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByLabelText("Transfer status timeline")).not.toBeInTheDocument();
    expect(screen.getByText(/cancelled before completing the pipeline/)).toBeInTheDocument();
  });

  // GAP-HR-TRANSFER-08: an eOffice-path transfer (pending_approval/
  // pending_effective) doesn't advance through the direct 4-step pipeline
  // at all (no "Issue Order"/"Mark Relieved" backend transition applies to
  // it) -- shown as plain status text instead, with no action buttons that
  // would 409 if clicked.
  describe("eOffice-path statuses", () => {
    it("shows plain status text (no pipeline, no action buttons) while pending_approval", () => {
      render(<TransferOrderCard transfer={row({ status: "pending_approval" })} />);
      expect(screen.getByText(/Awaiting eOffice decision/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Transfer status timeline")).not.toBeInTheDocument();
      expect(screen.queryByText("Issue Order")).not.toBeInTheDocument();
    });

    it("shows plain status text while pending_effective", () => {
      render(<TransferOrderCard transfer={row({ status: "pending_effective" })} />);
      expect(screen.getByText(/effective on the recorded date/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Transfer status timeline")).not.toBeInTheDocument();
    });
  });

  it("falls back to the employee id when no resolved employee name is present", () => {
    render(<TransferOrderCard transfer={row({ employee: undefined, employeeId: "emp-999" })} />);
    expect(screen.getByText("emp-999")).toBeInTheDocument();
  });

  // UX-016: this used to show the raw response text (falling back to
  // `HTTP ${res.status}`) verbatim — the same class of leak useFormError
  // closes fleet-wide (UX-003).
  it("shows a clerk-safe message, never the raw HTTP status, when the action fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<TransferOrderCard transfer={row()} />);

    fireEvent.click(screen.getByText("Issue Order"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Order No/), { target: { value: "77/2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
    expect(dialog.textContent).not.toMatch(/^HTTP /);
  });

  it("never surfaces raw server response text on a plain-text failure", async () => {
    fetchMock.mockResolvedValue(new Response("hrms-service: lifecycle transition rejected", { status: 500 }));
    render(<TransferOrderCard transfer={row()} />);

    fireEvent.click(screen.getByText("Issue Order"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Order No/), { target: { value: "77/2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue Order" }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/hrms-service/);
  });
});
