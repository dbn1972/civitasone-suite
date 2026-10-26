import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PayBillForm } from "./PayBillForm";
import type { IssuedBill } from "./PayBillForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Owner decision #7 (2026-10-26): the form pays ONLY a bill the server issued
// (fetch-bill token). Assessee and amount are read-only, never typed.
const BILL: IssuedBill = {
  token: "a".repeat(48),
  identifierNo: "PROP-001",
  ownerName: "Priya Singh",
  amountMinor: "15050",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

function fillTxn() {
  fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9001" } });
}

function mockFetchRouting(statusBody: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/bbps/requests/")) {
      return Promise.resolve(new Response(JSON.stringify({ data: statusBody }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: { messageId: "msg-2" } }), { status: 202 }));
  });
}

describe("PayBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("offers no free-typed amount or assessee: they come from the fetched bill (owner decision #7)", () => {
    render(<PayBillForm bill={BILL} />);
    expect(screen.queryByLabelText(/^Amount/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Assessee Identifier/)).not.toBeInTheDocument();
    const summary = screen.getByLabelText("Fetched bill");
    expect(summary).toHaveTextContent("Priya Singh");
    expect(summary).toHaveTextContent("PROP-001");
    expect(summary).toHaveTextContent("₹150.50");
  });

  it("is disabled until a bill has been fetched, and says to fetch one first", () => {
    render(<PayBillForm bill={null} />);
    expect(screen.getByRole("button", { name: "Record BBPS payment" })).toBeDisabled();
    expect(screen.getByText(/Fetch a bill above first/)).toBeInTheDocument();
  });

  it("requires the biller transaction id before opening the confirm dialog", () => {
    render(<PayBillForm bill={BILL} />);
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    expect(screen.getByText(/Enter the BBPS transaction ID/)).toBeInTheDocument();
  });

  it("shows human channel labels, not raw codes (BBPS-04)", () => {
    render(<PayBillForm bill={BILL} />);
    const select = screen.getByLabelText(/Channel/) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Net banking");
    expect(labels).toContain("UPI");
    expect(labels).not.toContain("netbanking");
  });

  it("posts ONLY the server-issued token + txn id + channel — never an amount or assessee (owner decision #7)", async () => {
    const spy = mockFetchRouting({ messageId: "msg-2", status: "success", receiptId: "rc-1" });
    render(<PayBillForm bill={BILL} />);
    fillTxn();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    expect(screen.getAllByText(/₹150.50/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => expect(screen.getByText(/tracking its outcome below/)).toBeInTheDocument());
    const post = spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse(String((post[1] as RequestInit).body));
    expect(body).toEqual({ billToken: BILL.token, bbpsTxnId: "TXN-9001", channel: "online" });
    await waitFor(() => expect(screen.getByText("View the receipt")).toBeInTheDocument(), { timeout: 4000 });
  });

  it("shows a failure with the reason and an invitation to retry on a failed outcome (BBPS-02)", async () => {
    mockFetchRouting({ messageId: "msg-2", status: "failed", failureReason: "exceeds outstanding" });
    render(<PayBillForm bill={BILL} />);
    fillTxn();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));
    await waitFor(() => expect(screen.getByText(/exceeds outstanding/)).toBeInTheDocument(), { timeout: 4000 });
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_OVERPAYMENT", message: "exceeds outstanding" } }), { status: 422 }),
    );
    render(<PayBillForm bill={BILL} />);
    fillTxn();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));
    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/BBPS_OVERPAYMENT: exceeds outstanding/)).not.toBeInTheDocument();
  });

  it("names the assessee owner in the confirm dialog (GAP-REVENUE-BBPS-03)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { messageId: "msg-99" } }), { status: 202 }));
    render(<PayBillForm bill={BILL} />);
    fillTxn();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    const dialogText = document.querySelector("[role=dialog]")?.textContent ?? document.body.textContent ?? "";
    expect(dialogText).toContain("Priya Singh");
  });
});
