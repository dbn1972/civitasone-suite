import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const requestCertifiedCopyMock = vi.fn();
const transitionCertifiedCopyMock = vi.fn();
const fetchCaseCertifiedCopiesMock = vi.fn();

vi.mock("../../_data/client", () => ({
  requestCertifiedCopy: (...args: unknown[]) => requestCertifiedCopyMock(...args),
  transitionCertifiedCopy: (...args: unknown[]) => transitionCertifiedCopyMock(...args),
  fetchCaseCertifiedCopies: (...args: unknown[]) => fetchCaseCertifiedCopiesMock(...args),
}));

import { CertifiedCopiesPanel } from "./CertifiedCopiesPanel";
import type { CertifiedCopy } from "../../_data/types";

function makeCopy(overrides: Partial<CertifiedCopy> = {}): CertifiedCopy {
  return {
    id: "copy-1",
    caseId: "case-1",
    orderId: null,
    documentRef: "order-99",
    applicantName: "Ravi Kumar",
    copiesCount: 2,
    urgent: false,
    feeMinor: "1500",
    feeSource: "config",
    paymentRef: null,
    receiptMinor: null,
    status: "requested",
    requestedBy: "clerk-1",
    issuedBy: null,
    issuedAt: null,
    deliveryMode: null,
    remarks: null,
    version: 1,
    ...overrides,
  };
}

describe("CertifiedCopiesPanel", () => {
  beforeEach(() => {
    requestCertifiedCopyMock.mockReset();
    transitionCertifiedCopyMock.mockReset();
    fetchCaseCertifiedCopiesMock.mockReset();
    fetchCaseCertifiedCopiesMock.mockResolvedValue([]);
  });

  it("renders the certified-copies list", () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    expect(screen.getByText("Certified copies (1)")).toBeInTheDocument();
    expect(screen.getByText("order-99")).toBeInTheDocument();
  });

  it("renders a genuine empty state (not the saved-information badge) when there are no copies", () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[]} source="api" />);
    expect(screen.getByText("No certified copies yet")).toBeInTheDocument();
  });

  it("renders a degraded empty state when the source is 'error' and there are no rows", () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[]} source="error" />);
    expect(screen.getByText("Could not load certified copies")).toBeInTheDocument();
  });

  it("applies for a certified copy (happy path)", async () => {
    requestCertifiedCopyMock.mockResolvedValue({ copyId: "copy-2" });
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[]} source="api" />);
    fireEvent.change(screen.getByLabelText(/Document \/ order ref/), { target: { value: "order-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply for certified copy" }));
    await waitFor(() => expect(requestCertifiedCopyMock).toHaveBeenCalledTimes(1));
    expect(requestCertifiedCopyMock.mock.calls[0][0]).toBe("case-1");
    expect(requestCertifiedCopyMock.mock.calls[0][1]).toMatchObject({ documentRef: "order-1", copiesCount: 1 });
    await waitFor(() => expect(screen.getByText(/Certified copy application submitted\./)).toBeInTheDocument());
  });

  it("offers the fee_paid and reject actions on a requested copy", () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    expect(screen.getByRole("button", { name: "Record fee paid" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark Prepared/ })).not.toBeInTheDocument();
  });

  it("requires BOTH a payment reference and receipted amount before recording fee_paid", async () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Record fee paid" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm fee paid" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter both the payment reference/);
    expect(transitionCertifiedCopyMock).not.toHaveBeenCalled();
  });

  it("records fee_paid with a payment reference and receipted amount", async () => {
    transitionCertifiedCopyMock.mockResolvedValue(undefined);
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Record fee paid" }));
    fireEvent.change(screen.getByLabelText(/Payment reference/), { target: { value: "CHALLAN-1" } });
    fireEvent.change(screen.getByLabelText(/Receipted amount/), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm fee paid" }));
    await waitFor(() => expect(transitionCertifiedCopyMock).toHaveBeenCalledTimes(1));
    expect(transitionCertifiedCopyMock).toHaveBeenCalledWith("copy-1", expect.objectContaining({
      target: "fee_paid",
      paymentRef: "CHALLAN-1",
      receiptMinor: "1500",
      expectedVersion: 1,
    }));
  });

  it("surfaces the server's amount-mismatch rejection", async () => {
    transitionCertifiedCopyMock.mockRejectedValue(new Error("RECEIPT_AMOUNT_MISMATCH: receipted amount 1000 does not match the fee 1500"));
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Record fee paid" }));
    fireEvent.change(screen.getByLabelText(/Payment reference/), { target: { value: "CHALLAN-1" } });
    fireEvent.change(screen.getByLabelText(/Receipted amount/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm fee paid" }));
    await waitFor(() => expect(screen.getByText(/RECEIPT_AMOUNT_MISMATCH/)).toBeInTheDocument());
  });

  it("requires a reason before rejecting a certified copy", async () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejected" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter a reason/);
    expect(transitionCertifiedCopyMock).not.toHaveBeenCalled();
  });

  it("rejects a certified copy once a reason is given", async () => {
    transitionCertifiedCopyMock.mockResolvedValue(undefined);
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy()]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: "Missing supporting documents" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rejected" }));
    await waitFor(() => expect(transitionCertifiedCopyMock).toHaveBeenCalledTimes(1));
    expect(transitionCertifiedCopyMock).toHaveBeenCalledWith("copy-1", expect.objectContaining({
      target: "rejected",
      remarks: "Missing supporting documents",
      expectedVersion: 1,
    }));
  });

  it("offers prepared → issued with an optional delivery mode", async () => {
    transitionCertifiedCopyMock.mockResolvedValue(undefined);
    render(
      <CertifiedCopiesPanel
        caseId="case-1"
        initialCopies={[makeCopy({ status: "prepared", version: 3 })]}
        source="api"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark Issued" }));
    fireEvent.change(screen.getByLabelText("Delivery mode (optional)"), { target: { value: "post" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm issued" }));
    await waitFor(() =>
      expect(transitionCertifiedCopyMock).toHaveBeenCalledWith(
        "copy-1",
        expect.objectContaining({ target: "issued", deliveryMode: "post", expectedVersion: 3 }),
      ),
    );
  });

  it("renders no further actions for a terminal (issued) copy", () => {
    render(<CertifiedCopiesPanel caseId="case-1" initialCopies={[makeCopy({ status: "issued" })]} source="api" />);
    expect(screen.queryByRole("button", { name: /Confirm|Record fee paid|Reject|Mark/ })).not.toBeInTheDocument();
  });
});
