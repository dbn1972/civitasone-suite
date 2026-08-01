import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const recordOrderMock = vi.fn();
const submitOrderForApprovalMock = vi.fn();
const approveAndIssueOrderMock = vi.fn();
const sendBackOrderMock = vi.fn();
const recallOrderMock = vi.fn();
const fetchCaseOrdersMock = vi.fn();

vi.mock("../_data/client", () => ({
  recordOrder: (...args: unknown[]) => recordOrderMock(...args),
  submitOrderForApproval: (...args: unknown[]) => submitOrderForApprovalMock(...args),
  approveAndIssueOrder: (...args: unknown[]) => approveAndIssueOrderMock(...args),
  sendBackOrder: (...args: unknown[]) => sendBackOrderMock(...args),
  recallOrder: (...args: unknown[]) => recallOrderMock(...args),
  fetchCaseOrders: (...args: unknown[]) => fetchCaseOrdersMock(...args),
}));

import { OrdersConsole } from "./OrdersConsole";
import type { CourtOrder } from "../_data/types";

const caseSummary = { title: "State vs. Sharma", cnrNumber: "DLHC010000012026" };

function makeOrder(overrides: Partial<CourtOrder> = {}): CourtOrder {
  return {
    id: "order-1",
    caseId: "case-1",
    hearingId: null,
    orderType: "interim",
    orderText: "Stay granted pending final hearing.",
    status: "draft",
    orderDate: "2026-07-01",
    signedBy: null,
    approvedBy: null,
    issuedAt: null,
    recallReason: null,
    hasDsc: false,
    createdBy: "judge-1",
    version: 1,
    ...overrides,
  };
}

describe("OrdersConsole", () => {
  beforeEach(() => {
    recordOrderMock.mockReset();
    submitOrderForApprovalMock.mockReset();
    approveAndIssueOrderMock.mockReset();
    sendBackOrderMock.mockReset();
    recallOrderMock.mockReset();
    fetchCaseOrdersMock.mockReset();
    fetchCaseOrdersMock.mockResolvedValue([]);
  });

  it("renders the orders list", () => {
    render(
      <OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[makeOrder()]} ordersSource="api" />,
    );
    expect(screen.getByText("Orders (1)")).toBeInTheDocument();
    expect(screen.getByText(/Stay granted/)).toBeInTheDocument();
  });

  it("renders a genuine empty state (not the saved-information badge) when there are no orders", () => {
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="api" />);
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
    expect(screen.queryByText("Showing saved information")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge (not an empty state) when the orders source is 'error'", () => {
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="error" />);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
    expect(screen.queryByText("No orders yet")).not.toBeInTheDocument();
  });

  it("rejects an empty order type/text via the custom validator without calling the server", () => {
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Draft order" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(recordOrderMock).not.toHaveBeenCalled();
  });

  it("drafts an order (happy path)", async () => {
    recordOrderMock.mockResolvedValue({ id: "order-2" });
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="api" />);
    fireEvent.change(screen.getByLabelText(/Order type/), { target: { value: "final" } });
    fireEvent.change(screen.getByLabelText(/Order text/), { target: { value: "Suit decreed." } });
    fireEvent.click(screen.getByRole("button", { name: "Draft order" }));
    await waitFor(() => expect(recordOrderMock).toHaveBeenCalledTimes(1));
    expect(recordOrderMock.mock.calls[0][0]).toBe("case-1");
    await waitFor(() => expect(screen.getByText("Order drafted.")).toBeInTheDocument());
  });

  it("requires a DSC signature before approve & issue reaches the server, then surfaces a server error", async () => {
    approveAndIssueOrderMock.mockRejectedValue(new Error("SELF_APPROVAL_REJECTED: approver must differ from maker"));
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval" })]}
        ordersSource="api"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Approve and issue the/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve & issue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Paste the DSC signature/);
    expect(approveAndIssueOrderMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Digital Signature Certificate/), {
      target: { value: "-----BEGIN PKCS7----- abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve & issue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve & issue" }));
    await waitFor(() =>
      expect(screen.getByText(/SELF_APPROVAL_REJECTED: approver must differ from maker/)).toBeInTheDocument(),
    );
  });

  it("recalls an issued order with a mandatory reason", async () => {
    recallOrderMock.mockResolvedValue(undefined);
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "issued", hasDsc: true, issuedAt: "2026-07-05T10:00:00.000Z" })]}
        ordersSource="api"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Recall the/ }));
    fireEvent.click(screen.getByRole("button", { name: "Recall order" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter the reason/);
    expect(recallOrderMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Recall reason/), { target: { value: "Clerical error in dates" } });
    fireEvent.click(screen.getByRole("button", { name: "Recall order" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm recall" }));
    await waitFor(() => expect(recallOrderMock).toHaveBeenCalledTimes(1));
    expect(recallOrderMock.mock.calls[0][1]).toMatchObject({ recallReason: "Clerical error in dates" });
  });
});
