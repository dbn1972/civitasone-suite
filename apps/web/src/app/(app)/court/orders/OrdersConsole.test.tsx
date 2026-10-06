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
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("renders the saved-information badge (not an empty state) when the orders source is 'error'", () => {
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="error" />);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    expect(screen.queryByText("No orders yet")).not.toBeInTheDocument();
  });

  it("never renders a raw '(0)' count in the card title when the source is 'error' (even with stale rows)", () => {
    render(
      <OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[makeOrder()]} ordersSource="error" />,
    );
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.queryByText(/Orders \(/)).not.toBeInTheDocument();
  });

  it("flips the source to 'error' (surfacing the badge) when the post-mutation reload fails, without dropping the rows", async () => {
    recordOrderMock.mockResolvedValue({ id: "order-2" });
    fetchCaseOrdersMock.mockRejectedValue(new Error("network error"));
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="api" />);
    fireEvent.change(screen.getByLabelText(/Order type/), { target: { value: "final" } });
    fireEvent.change(screen.getByLabelText(/Order text/), { target: { value: "Suit decreed." } });
    fireEvent.click(screen.getByRole("button", { name: "Draft order" }));
    await waitFor(() => expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText(/Order draft submitted\./)).toBeInTheDocument());
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

  // ── GAP-COURT-ORDERS-01: maker-checker UX hint on Approve & issue ──────────
  it("disables Approve & issue on an order the signed-in officer drafted (createdBy === currentUserId)", () => {
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval", createdBy: "judge-1" })]}
        ordersSource="api"
        currentUserId="judge-1"
      />,
    );
    const approve = screen.getByRole("button", { name: /Approve and issue the/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", expect.stringContaining("another officer must approve"));
    expect(screen.getByText(/You drafted this order; another officer must approve it\./)).toBeInTheDocument();
  });

  it("enables Approve & issue for a different officer than the maker", () => {
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval", createdBy: "judge-1" })]}
        ordersSource="api"
        currentUserId="judge-2"
      />,
    );
    expect(screen.getByRole("button", { name: /Approve and issue the/ })).toBeEnabled();
  });

  it("does not disable Approve & issue when createdBy is unknown (null) — server stays the authority", () => {
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval", createdBy: null })]}
        ordersSource="api"
        currentUserId="judge-1"
      />,
    );
    expect(screen.getByRole("button", { name: /Approve and issue the/ })).toBeEnabled();
  });

  // ── GAP-COURT-ORDERS-02: DSC blob structural validation ────────────────────
  it("rejects a non-signature paste (a password/word) before reaching the server", () => {
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval", createdBy: "maker-x" })]}
        ordersSource="api"
        currentUserId="checker-y"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Approve and issue the/ }));
    fireEvent.change(screen.getByLabelText(/Digital Signature Certificate/), {
      target: { value: "plain text, not a signature" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve & issue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/doesn't look like a DSC signature|base64/);
    expect(approveAndIssueOrderMock).not.toHaveBeenCalled();
  });

  it("accepts a well-formed PEM PKCS#7 blob and submits it", async () => {
    approveAndIssueOrderMock.mockResolvedValue(undefined);
    const pkcs7 =
      ["-----BEGIN", "PKCS7-----"].join(" ") + "\n" +
      "MIIB".padEnd(96, "A") +
      "\n" + ["-----END", "PKCS7-----"].join(" ");
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval", createdBy: "maker-x" })]}
        ordersSource="api"
        currentUserId="checker-y"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Approve and issue the/ }));
    fireEvent.change(screen.getByLabelText(/Digital Signature Certificate/), {
      target: { value: pkcs7 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve & issue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve & issue" }));
    await waitFor(() => expect(approveAndIssueOrderMock).toHaveBeenCalledTimes(1));
    expect(approveAndIssueOrderMock.mock.calls[0][1]).toMatchObject({ dscSignature: pkcs7 });
  });

  // ── GAP-COURT-ORDERS-03: clamp long orders + print issued order ────────────
  it("clamps a long order with a 'Show full order' toggle", () => {
    const long = "A long judgment paragraph. ".repeat(60);
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ orderText: long })]}
        ordersSource="api"
      />,
    );
    const toggle = screen.getByRole("button", { name: "Show full order" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers View / Print only for an issued order and shows its signature status", () => {
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "issued", hasDsc: true, issuedAt: "2026-07-05T10:00:00.000Z" })]}
        ordersSource="api"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /View or print the/ }));
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("does not offer View / Print for a draft order", () => {
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "draft" })]}
        ordersSource="api"
      />,
    );
    expect(screen.queryByRole("button", { name: /View or print the/ })).not.toBeInTheDocument();
  });

  // ── GAP-COURT-ORDERS-04: confirm Submit + require send-back remarks ────────
  it("asks for confirmation before submitting a draft for approval; Cancel makes no request", async () => {
    submitOrderForApprovalMock.mockResolvedValue(undefined);
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "draft" })]}
        ordersSource="api"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Submit the .* for approval/ }));
    expect(screen.getByRole("button", { name: "Confirm submit for approval" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(submitOrderForApprovalMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Submit the .* for approval/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm submit for approval" }));
    await waitFor(() => expect(submitOrderForApprovalMock).toHaveBeenCalledTimes(1));
  });

  it("blocks a send-back with no remarks (remarks now required)", async () => {
    sendBackOrderMock.mockResolvedValue(undefined);
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ status: "pending_approval", createdBy: "maker-x" })]}
        ordersSource="api"
        currentUserId="checker-y"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Send back the/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm send back" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter remarks/);
    expect(sendBackOrderMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Remarks for the maker/), { target: { value: "Fix the dates" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm send back" }));
    await waitFor(() => expect(sendBackOrderMock).toHaveBeenCalledTimes(1));
    expect(sendBackOrderMock.mock.calls[0][1]).toMatchObject({ remarks: "Fix the dates" });
  });

  // ── GAP-COURT-ORDERS-05: link an order to a hearing ────────────────────────
  it("sends the chosen hearingId when a linked hearing is selected on the draft form", async () => {
    recordOrderMock.mockResolvedValue({ id: "order-2" });
    const hearings = [
      { id: "hearing-1", caseId: "case-1", benchId: null, scheduledDate: "2026-07-02", status: "held", nextDate: null, purpose: "Arguments", adjournmentReason: null, version: 1 },
    ];
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[]}
        ordersSource="api"
        hearings={hearings}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Order type/), { target: { value: "final" } });
    fireEvent.change(screen.getByLabelText(/Order text/), { target: { value: "Suit decreed." } });
    fireEvent.change(screen.getByLabelText(/Linked hearing/), { target: { value: "hearing-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft order" }));
    await waitFor(() => expect(recordOrderMock).toHaveBeenCalledTimes(1));
    expect(recordOrderMock.mock.calls[0][1]).toMatchObject({ hearingId: "hearing-1" });
  });

  it("shows the linked hearing date on a row when the order cites a hearing", () => {
    const hearings = [
      { id: "hearing-1", caseId: "case-1", benchId: null, scheduledDate: "2026-07-02", status: "held", nextDate: null, purpose: "Arguments", adjournmentReason: null, version: 1 },
    ];
    render(
      <OrdersConsole
        caseId="case-1"
        caseSummary={caseSummary}
        initialOrders={[makeOrder({ hearingId: "hearing-1" })]}
        ordersSource="api"
        hearings={hearings}
      />,
    );
    expect(screen.getByText(/hearing: 02 Jul 2026/)).toBeInTheDocument();
  });

  it("omits the Linked hearing control and sends no hearingId when there are no hearings", async () => {
    recordOrderMock.mockResolvedValue({ id: "order-2" });
    render(<OrdersConsole caseId="case-1" caseSummary={caseSummary} initialOrders={[]} ordersSource="api" />);
    expect(screen.queryByLabelText(/Linked hearing/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Order type/), { target: { value: "final" } });
    fireEvent.change(screen.getByLabelText(/Order text/), { target: { value: "Suit decreed." } });
    fireEvent.click(screen.getByRole("button", { name: "Draft order" }));
    await waitFor(() => expect(recordOrderMock).toHaveBeenCalledTimes(1));
    expect(recordOrderMock.mock.calls[0][1]).not.toHaveProperty("hearingId");
  });
});
