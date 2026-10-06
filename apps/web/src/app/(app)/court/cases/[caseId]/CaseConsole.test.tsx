import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const transitionCaseMock = vi.fn();
const adjournHearingMock = vi.fn();
const recordHearingOutcomeMock = vi.fn();
const recallOrderMock = vi.fn();
const approveAndIssueOrderMock = vi.fn();
const fetchCaseOrdersMock = vi.fn();
const fetchCaseHearingsMock = vi.fn();

vi.mock("../../_data/client", () => ({
  transitionCase: (...a: unknown[]) => transitionCaseMock(...a),
  adjournHearing: (...a: unknown[]) => adjournHearingMock(...a),
  recordHearingOutcome: (...a: unknown[]) => recordHearingOutcomeMock(...a),
  recallOrder: (...a: unknown[]) => recallOrderMock(...a),
  approveAndIssueOrder: (...a: unknown[]) => approveAndIssueOrderMock(...a),
  sendBackOrder: vi.fn(),
  submitOrderForApproval: vi.fn(),
  recordOrder: vi.fn(),
  scheduleHearing: vi.fn(),
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
    expect(screen.queryByRole("button", { name: "Recall" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    expect(screen.getByRole("button", { name: "Recall" })).toBeInTheDocument();
  });

  it("CASEID-01: recalling an issued order uses a danger ConfirmDialog gated on a reason", async () => {
    recallOrderMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [issuedOrder], []);
    fireEvent.click(screen.getByRole("tab", { name: /Orders/ }));
    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    const dialog = screen.getByRole("alertdialog");
    // Confirm disabled until a reason is entered.
    const confirm = within(dialog).getByRole("button", { name: "Confirm recall" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason for recall"), { target: { value: "Issued in error" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm recall" }));
    await waitFor(() => expect(recallOrderMock).toHaveBeenCalledTimes(1));
    expect(recallOrderMock).toHaveBeenCalledWith("o1", expect.objectContaining({ recallReason: "Issued in error", expectedVersion: 2 }));
  });

  it("CASEID-01: adjourning a hearing uses a ConfirmDialog with a mandatory reason", async () => {
    adjournHearingMock.mockResolvedValue(undefined);
    renderConsole(caseDetail(), [], [scheduledHearing]);
    fireEvent.click(screen.getByRole("tab", { name: /Hearings/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adjourn" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm adjourn" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Adjournment reason"), { target: { value: "Counsel unavailable" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(adjournHearingMock).toHaveBeenCalledTimes(1));
    expect(adjournHearingMock).toHaveBeenCalledWith("h1", expect.objectContaining({ reason: "Counsel unavailable", expectedVersion: 1 }));
  });
});
