import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PayBillForm } from "./PayBillForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function fillForm() {
  fireEvent.change(screen.getByLabelText(/Assessee Identifier/), { target: { value: "PROP-001" } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "150.50" } });
  fireEvent.change(screen.getByLabelText(/BBPS Transaction ID/), { target: { value: "TXN-9001" } });
}

function mockFetchRouting(statusBody: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
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

  it("requires all fields before opening the confirm dialog", () => {
    render(<PayBillForm />);
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    expect(screen.getByText(/Enter the assessee identifier/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid payment amount/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the BBPS transaction ID/)).toBeInTheDocument();
  });

  it("shows human channel labels, not raw codes (BBPS-04)", () => {
    render(<PayBillForm />);
    const select = screen.getByLabelText(/Channel/) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Net banking");
    expect(labels).toContain("UPI");
    expect(labels).not.toContain("netbanking");
  });

  it("records the payment and polls to success, linking to the receipt (BBPS-02/05)", async () => {
    mockFetchRouting({ messageId: "msg-2", status: "success", receiptId: "rc-1" });

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    expect(screen.getByText(/₹150.50/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/tracking its outcome below/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("View the receipt")).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it("shows a failure with the reason and an invitation to retry on a failed outcome (BBPS-02)", async () => {
    mockFetchRouting({ messageId: "msg-2", status: "failed", failureReason: "exceeds outstanding" });

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));
    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/exceeds outstanding/)).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BBPS_OVERPAYMENT", message: "exceeds outstanding" } }), { status: 422 }),
    );

    render(<PayBillForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Record BBPS payment" }));

    await waitFor(() => expect(screen.getByText("Record this BBPS payment?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record payment"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/BBPS_OVERPAYMENT: exceeds outstanding/)).not.toBeInTheDocument();
  });
});
