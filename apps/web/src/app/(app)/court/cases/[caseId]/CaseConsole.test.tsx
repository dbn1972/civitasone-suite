import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// The shared order dialogs translate some copy client-side, so every render needs an intl provider.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const transitionCaseMock = vi.fn();
const adjournHearingMock = vi.fn();
const recordHearingOutcomeMock = vi.fn();
const recallOrderMock = vi.fn();
const submitOrderForApprovalMock = vi.fn();
const approveAndIssueOrderMock = vi.fn();
const verifyOrderDscMock = vi.fn();
const sendBackOrderMock = vi.fn();
const scheduleHearingMock = vi.fn();
const fetchCaseOrdersMock = vi.fn();
const fetchCaseHearingsMock = vi.fn();

vi.mock("../../_data/client", () => ({
  transitionCase: (...a: unknown[]) => transitionCaseMock(...a),
  adjournHearing: (...a: unknown[]) => adjournHearingMock(...a),
  recordHearingOutcome: (...a: unknown[]) => recordHearingOutcomeMock(...a),
  recallOrder: (...a: unknown[]) => recallOrderMock(...a),
  approveAndIssueOrder: (...a: unknown[]) => approveAndIssueOrderMock(...a),
  sendBackOrder: (...a: unknown[]) => sendBackOrderMock(...a),
  verifyOrderDsc: (...a: unknown[]) => verifyOrderDscMock(...a),
  submitOrderForApproval: (...a: unknown[]) => submitOrderForApprovalMock(...a),
  recordOrder: vi.fn(),
  scheduleHearing: (...a: unknown[]) => scheduleHearingMock(...a),
  fetchCaseOrders: (...a: unknown[]) => fetchCaseOrdersMock(...a),
  fetchCaseHearings: (...a: unknown[]) => fetchCaseHearingsMock(...a),
  // CertifiedCopiesPanel also imports from this module:
  requestCertifiedCopy: vi.fn(),
  transitionCertifiedCopy: vi.fn(),
  fetchCaseCertifiedCopies: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { CaseConsole } from "./CaseConsole";
import type { CourtCaseDetail, CourtOrder, Hearing } from "../../_data/types";

function caseDetail(overrides: Partial<CourtCaseDetail> = {}): CourtCaseDetail {
  return {
    id: "case-1",
    cnrNumber: "DLHC010000012026",
    caseType: "civil",
    filingNumber: "F-1",
    filingDate: "2026-01-01",
    title: "State vs. Sharma",
    status: "pending",
    stage: null,
    courtId: null,
    benchId: null,
    disposalDate: null,
    targetDisposalDate: "2026-06-01",
    version: 3,
    parties: [
      {
        id: "p1",
        caseId: "case-1",
        partyRole: "advocate",
        name: "Adv. Rao",
        advocateName: "Adv. Rao",
        advocateBarId: "D/1234/2010",
        version: 1,
      },
    ],
    ...overrides,
  };
}

const issuedOrder: CourtOrder = {
  id: "o1",
  caseId: "case-1",
  hearingId: null,
  orderType: "final",
  orderText: "Final order",
  status: "issued",
  orderDate: "2026-02-01",
  signedBy: null,
  approvedBy: null,
  issuedAt: "2026-02-01T10:00:00Z",
  recallReason: null,
  hasDsc: true,
  createdBy: null,
  version: 2,
};

const pendingOrder: CourtOrder = { ...issuedOrder, id: "o3", status: "pending_approval", issuedAt: null, hasDsc: false, version: 5 };
const draftOrder: CourtOrder = { ...issuedOrder, id: "o2", status: "draft", issuedAt: null, hasDsc: false, version: 4 };

const scheduledHearing: Hearing = {
  id: "h1",
  caseId: "case-1",
  benchId: null,
  scheduledDate: "2099-01-15T10:00:00.000Z",
  status: "scheduled",
  nextDate: null,
  purpose: "arguments",
  adjournmentReason: null,
  version: 1,
};

function renderConsole(detail = caseDetail(), orders: CourtOrder[] = [], hearings: Hearing[] = []) {
  return render(
    <CaseConsole
      caseDetail={detail}
      initialOrders={orders}
      ordersSource="api"
      initialHearings={hearings}
      hearingsSource="api"
      initialCertifiedCopies={[]}
      certifiedCopiesSource="api"
    />,
  );
}

describe("CaseConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCaseOrdersMock.mockResolvedValue([]);
    fetchCaseHearingsMock.mockResolvedValue([]);
  });

  it("CASEID-04: masks the advocate Bar ID (not shown in the clear)", () => {
    renderConsole();
    // Masked last4 → "•••• 2010"; full id not rendered.
    expect(screen.getByText(/•••• 2010/)).toBeInTheDocument();
    expect(screen.queryByText("D/1234/2010")).not.toBeInTheDocument();
  });

  it("CASEID-05: disposing a case opens a danger confirm with required reason and no PATCH until confirmed", async () => {
    renderConsole();
    fireEvent.change(screen.getByLabelText("Move to status"), { target: { value: "disposed" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply transition" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(transitionCaseMock).not.toHaveBeenCalled();
    // Confirm is gated on a reason (requireReason) — type one.
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Matter decided on merits" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dispose case" }));
    await waitFor(() => expect(transitionCaseMock).toHaveBeenCalledTimes(1));
    expect(transitionCaseMock).toHaveBeenCalledWith(
      "case-1",
      expect.objectContaining({ toStatus: "disposed", reason: "Matter decided on merits", expectedVersion: 3 }),
    );
  });

  it("CASEID-06: switches to the Orders tab to reveal order actions", async () => {
    renderConsole(caseDetail(), [issuedOrder], []);
    // Orders panel hidden on the default Overview tab.
    expect(screen.queryByRole("button", { name: /^Recall the/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    expect(screen.getByRole("button", { name: /^Recall the/ })).toBeInTheDocument();
  });

  it("CASEID-01: recalling an issued order requires a reason, then a danger ConfirmDialog, then calls the API once", async () => {
    recallOrderMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [issuedOrder], []);
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Recall the final order/i }));
    // No dialog and no API call until a reason is entered.
    fireEvent.click(screen.getByRole("button", { name: "Recall order" }));
    expect(screen.getByText("Enter the reason for recalling this order.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(recallOrderMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Recall reason/), { target: { value: "Issued in error" } });
    fireEvent.click(screen.getByRole("button", { name: "Recall order" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(recallOrderMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm recall" }));
    await waitFor(() => expect(recallOrderMock).toHaveBeenCalledTimes(1));
    expect(recallOrderMock).toHaveBeenCalledWith("o1", expect.objectContaining({ recallReason: "Issued in error", expectedVersion: 2 }));
  });

  it("CASEID-01: adjourning a hearing requires a reason, then a danger ConfirmDialog, then adjourns once", async () => {
    adjournHearingMock.mockResolvedValue(undefined);
    scheduleHearingMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [], [scheduledHearing]);
    fireEvent.click(screen.getByRole("tab", { name: /Hearings/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Adjourn the hearing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adjourn hearing" }));
    expect(screen.getByText("Enter the reason for adjournment.")).toBeInTheDocument();
    expect(adjournHearingMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Adjournment reason/), { target: { value: "Counsel unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Adjourn hearing" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(adjournHearingMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Adjourn hearing" }));
    await waitFor(() => expect(adjournHearingMock).toHaveBeenCalledTimes(1));
    expect(adjournHearingMock).toHaveBeenCalledWith("h1", expect.objectContaining({ reason: "Counsel unavailable", expectedVersion: 1 }));
  });

  it("CASEID-01: recording a hearing outcome goes through the shared ConfirmDialog and calls the API once", async () => {
    recordHearingOutcomeMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [], [scheduledHearing]);
    fireEvent.click(screen.getByRole("tab", { name: /Hearings/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Record outcome for the hearing/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(recordHearingOutcomeMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm outcome" }));
    await waitFor(() => expect(recordHearingOutcomeMock).toHaveBeenCalledTimes(1));
    expect(recordHearingOutcomeMock).toHaveBeenCalledWith("h1", expect.objectContaining({ outcome: "held", expectedVersion: 1 }));
  });

  // The case page now uses the SAME approve & issue component as /court/orders:
  // the DSC must verify on the server before the irreversible issue is offered.
  it("CASEID-01: Approve & issue on the case page requires a server-verified DSC before the confirm dialog", async () => {
    verifyOrderDscMock.mockResolvedValue({ ok: true, issues: [], signerCN: "Registrar", trustStoreConfigured: false, chainTrusted: false });
    approveAndIssueOrderMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [pendingOrder], []);
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Approve and issue the final order/i }));
    const blob = "-----BEGIN PKCS7-----\nMIIB\n-----END PKCS7-----";
    fireEvent.change(screen.getByLabelText(/Digital Signature Certificate/), { target: { value: blob } });
    // Not verified yet: approving is disabled and nothing is sent.
    const approve = screen.getByRole("button", { name: /^Approve & issue$/ });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verify signature" }));
    await waitFor(() => expect(verifyOrderDscMock).toHaveBeenCalledWith("o3", blob));
    await waitFor(() => expect(approve).toBeEnabled());
    expect(approveAndIssueOrderMock).not.toHaveBeenCalled();
    fireEvent.click(approve);
    const dialog = await screen.findByRole("alertdialog");
    expect(approveAndIssueOrderMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm approve & issue" }));
    await waitFor(() => expect(approveAndIssueOrderMock).toHaveBeenCalledTimes(1));
    expect(approveAndIssueOrderMock).toHaveBeenCalledWith("o3", expect.objectContaining({ dscSignature: blob, expectedVersion: 5 }));
  });

  it("CASEID-01: Send back on the case page requires remarks (same contract as /court/orders)", async () => {
    sendBackOrderMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [pendingOrder], []);
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Send back the final order/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm send back" }));
    expect(screen.getByText("Enter remarks so the maker knows what to revise.")).toBeInTheDocument();
    expect(sendBackOrderMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Remarks for the maker/), { target: { value: "Fix clause 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm send back" }));
    await waitFor(() => expect(sendBackOrderMock).toHaveBeenCalledTimes(1));
    expect(sendBackOrderMock).toHaveBeenCalledWith("o3", expect.objectContaining({ remarks: "Fix clause 2", expectedVersion: 5 }));
  });

  function openSubmitDialog() {
    renderConsole(caseDetail(), [draftOrder], []);
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Submit the .*for approval/ }));
    return screen.getByRole("alertdialog");
  }

  it("CASEID-01: Submit for approval opens a ConfirmDialog and does not call the API until confirmed", () => {
    openSubmitDialog();
    expect(submitOrderForApprovalMock).not.toHaveBeenCalled();
  });

  it("CASEID-01: cancelling the submit dialog closes it without calling the API", () => {
    const dialog = openSubmitDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(submitOrderForApprovalMock).not.toHaveBeenCalled();
  });

  it("CASEID-01: confirming submits once with the order id and version; double-click is blocked by busy", async () => {
    let resolve!: () => void;
    submitOrderForApprovalMock.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const dialog = openSubmitDialog();
    const confirm = within(dialog).getByRole("button", { name: "Confirm submit" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(submitOrderForApprovalMock).toHaveBeenCalledTimes(1);
    expect(submitOrderForApprovalMock).toHaveBeenCalledWith("o2", 4);
    resolve();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("CASEID-01: a failed submit keeps the dialog open and shows an error inside it", async () => {
    submitOrderForApprovalMock.mockRejectedValue(new Error("raw backend detail"));
    const dialog = openSubmitDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm submit" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText("Could not submit the order. Please try again.")).toBeInTheDocument());
  });
});
