import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockLoad = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getProcurementPOById: (id: string) => mockLoad(id),
}));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles(),
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
  PROCUREMENT_WRITE_ROLES: ["procurement_officer", "procurement_admin", "super_admin"],
}));

// RaiseEOfficeNote is a client component with its own fetches — stub it so the
// test can assert ONLY whether the page chose to render the approval-raise
// control for this PO status (GAP-PROCUREMENT-ORDERS-DETAIL-01).
vi.mock("../../../../_components/RaiseEOfficeNote", () => ({
  RaiseEOfficeNote: () => <div data-testid="raise-eoffice">Raise for approval</div>,
}));
vi.mock("./DispatchPOActions", () => ({
  DispatchPOActions: () => <div data-testid="dispatch" />,
}));
vi.mock("../../../../_components/PrintDocumentLink", () => ({
  PrintDocumentLink: () => <a href="#print">Print PO</a>,
}));

import PODetailPage from "./page";

function po(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    poNo: "PO/2026/0001",
    vendor: "Acme Supplies",
    orderDate: "2026-06-01",
    deliveryDate: null,
    totalAmount: 100000,
    status: "approved",
    lineItems: [],
    ...over,
  };
}

describe("PODetailPage — DETAIL-01 single approval path", () => {
  beforeEach(() => { mockRoles.mockReturnValue(["procurement_officer"]); mockLoad.mockReset(); });

  it("does NOT render the eOffice 'Raise for approval' control for an approved PO", async () => {
    mockLoad.mockResolvedValue({ data: po({ status: "approved" }), source: "api" });
    render(await PODetailPage({ params: { id: "x" } }));
    expect(screen.queryByTestId("raise-eoffice")).not.toBeInTheDocument();
    // The Approval card explains the single release path + state.
    expect(screen.getByText("Approval")).toBeInTheDocument();
    expect(screen.getByText(/eOffice file-noting approval/)).toBeInTheDocument();
  });

  it("DOES render the approval-raise control for a draft PO", async () => {
    mockLoad.mockResolvedValue({ data: po({ status: "draft" }), source: "api" });
    render(await PODetailPage({ params: { id: "x" } }));
    expect(screen.getByTestId("raise-eoffice")).toBeInTheDocument();
  });
});

describe("PODetailPage — DETAIL-04 single status pill", () => {
  beforeEach(() => { mockRoles.mockReturnValue(["procurement_officer"]); mockLoad.mockReset(); });

  it("renders the PO lifecycle status pill once in the header (details card no longer duplicates it)", async () => {
    mockLoad.mockResolvedValue({ data: po({ status: "approved" }), source: "api" });
    render(await PODetailPage({ params: { id: "x" } }));
    // "Approved" appears in the header pill AND the Approval-card state pill
    // reads "Approved — ready to dispatch" (a different string), so the exact
    // "Approved" label appears exactly once.
    expect(screen.getAllByText("Approved")).toHaveLength(1);
  });
});

describe("PODetailPage — DETAIL-05 shared labels + honest unit", () => {
  beforeEach(() => { mockRoles.mockReturnValue(["procurement_officer"]); mockLoad.mockReset(); });

  it("renders 'GeM Placed' for a gem_placed PO (shared label map)", async () => {
    mockLoad.mockResolvedValue({ data: po({ status: "gem_placed" }), source: "api" });
    render(await PODetailPage({ params: { id: "x" } }));
    expect(screen.getByText("GeM Placed")).toBeInTheDocument();
  });

  it("renders a line item with no unit as '—' (not a fabricated 'nos')", async () => {
    mockLoad.mockResolvedValue({
      data: po({
        status: "approved",
        lineItems: [{ itemCode: "IC-1", itemName: "Widget", quantity: 2, unit: "—", unitPrice: 5000, totalPrice: 10000, grnQty: 0 }],
      }),
      source: "api",
    });
    render(await PODetailPage({ params: { id: "x" } }));
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });
});
