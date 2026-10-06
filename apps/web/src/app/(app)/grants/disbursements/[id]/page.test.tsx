import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getGrantDisbursementByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getGrantDisbursementById: (id: string) => getGrantDisbursementByIdMock(id),
}));

const raiseSpy = vi.fn();
vi.mock("@/app/_components/RaiseEOfficeNote", () => ({
  RaiseEOfficeNote: (props: Record<string, unknown>) => {
    raiseSpy(props);
    return <div data-testid="raise-eoffice" />;
  },
}));

const rolesMock = vi.fn<() => string[]>(() => ["grant_officer"]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

import GrantDisbursementDetailPage from "./page";

const DISB = {
  id: "disb-1",
  releaseNo: "REL-2026-00001",
  grantId: "grant-1",
  grantNo: "GNT-2026-27-00001",
  granteeName: "Gram Panchayat Alpha",
  amount: 1000000, // paise (₹10,000.00) — money is bigint paise end to end
  releaseDate: "2026-08-20",
  bankRef: "UTR123456",
  status: "credited",
};

describe("GrantDisbursementDetailPage", () => {
  beforeEach(() => {
    getGrantDisbursementByIdMock.mockReset();
    raiseSpy.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantDisbursementByIdMock.mockResolvedValue({ data: DISB, source: "api" });
  });

  it("renders exactly one breadcrumb back-link when the disbursement is found", async () => {
    render(await GrantDisbursementDetailPage({ params: { id: "disb-1" } }));
    const backLinks = screen.getAllByRole("link", { name: "Back" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/releases");
  });

  // GAP-GRANTS-DISBURSEMENTS-DETAIL-08 (money unit): amount is MINOR units
  // (paise) end to end. 1000000 paise => ₹10,000.00 (NOT ₹1,000,000.00 if it
  // were wrongly treated as rupees). The same paise value is forwarded straight
  // to the eOffice note (no float *100, no rupees→paise conversion).
  it("shows the amount from paise and forwards the same paise to the eOffice note", async () => {
    render(await GrantDisbursementDetailPage({ params: { id: "disb-1" } }));
    expect(screen.getAllByText("₹10,000.00").length).toBeGreaterThan(0);
    expect(raiseSpy).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1000000 }));
  });

  // GAP-GRANTS-DISBURSEMENTS-DETAIL-01: no maker role → no RaiseEOfficeNote.
  it("hides the eOffice note for a non-maker role", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    render(await GrantDisbursementDetailPage({ params: { id: "disb-1" } }));
    expect(screen.queryByTestId("raise-eoffice")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-DISBURSEMENTS-DETAIL-04: a failed fetch shows a retry state,
  // not the "Disbursement not found … ID is invalid" empty state.
  it("renders a retry state (not 'not found') on a failed fetch", async () => {
    getGrantDisbursementByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await GrantDisbursementDetailPage({ params: { id: "disb-1" } }));
    expect(screen.queryByText(/Disbursement not found/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/try again|couldn't load|couldn’t load|retry/i).length).toBeGreaterThan(0);
  });

  // A genuine not-found (successful api, no match) still shows the empty state.
  it("shows 'Disbursement not found' for a successful null (api source)", async () => {
    getGrantDisbursementByIdMock.mockResolvedValue({ data: null, source: "api" });
    render(await GrantDisbursementDetailPage({ params: { id: "missing" } }));
    expect(screen.getByText("Disbursement not found")).toBeInTheDocument();
  });
});
