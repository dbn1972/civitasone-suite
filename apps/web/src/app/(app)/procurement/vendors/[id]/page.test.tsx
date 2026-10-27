import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const vendorMock = vi.fn();
const ordersMock = vi.fn();
const grnsMock = vi.fn();
const emdMock = vi.fn();
const pbgMock = vi.fn();
let sessionRoles: string[] = ["procurement_officer"];
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../../../_data/loaders", () => ({
  getProcurementVendorById: (...a: unknown[]) => vendorMock(...a),
  getProcurementPOs: (...a: unknown[]) => ordersMock(...a),
  getProcurementGRNs: (...a: unknown[]) => grnsMock(...a),
  getVendorEmd: (...a: unknown[]) => emdMock(...a),
  getVendorPbg: (...a: unknown[]) => pbgMock(...a),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => sessionRoles,
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
  PROCUREMENT_APPROVER_ROLES: ["procurement_admin", "super_admin"],
  PROCUREMENT_WRITE_ROLES: ["procurement_officer", "procurement_admin", "super_admin"],
}));
vi.mock("@/lib/formatters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formatters")>();
  return { ...actual, todayIST: () => "2026-06-15" };
});

import VendorDetailPage from "./page";

const VENDOR = {
  id: "v1",
  vendorCode: "VEN-001",
  name: "Acme Supplies",
  gstin: "22AAAAA0000A1Z5",
  panNo: "ABCDE1234F",
  category: "General",
  empanelmentStatus: "empanelled" as const,
  rating: 4,
  contactPerson: "R. Sharma",
  email: "accounts@acme.example",
  phone: "9876543210",
  address: "12 MG Road",
  bankAccountNo: "123456789012",
  ifscCode: "SBIN0001234",
  kycStatus: "in_progress",
  kycVerifiedAt: "2026-03-05T18:40:00.000Z",
};

describe("VendorDetailPage", () => {
  beforeEach(() => {
    vendorMock.mockReset();
    ordersMock.mockReset();
    ordersMock.mockResolvedValue({ data: [], source: "api" });
    grnsMock.mockReset(); emdMock.mockReset(); pbgMock.mockReset();
    grnsMock.mockResolvedValue({ data: [], source: "api" });
    emdMock.mockResolvedValue({ data: [], source: "api" });
    pbgMock.mockResolvedValue({ data: [], source: "api" });
    sessionRoles = ["procurement_officer"];
  });

  it("DETAIL-01: PAN, email, phone and bank account are masked (raw value absent from DOM)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    const { container } = render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    const html = container.innerHTML;
    expect(html).not.toContain("ABCDE1234F"); // raw PAN
    expect(html).not.toContain("accounts@acme.example"); // raw email
    expect(html).not.toContain("9876543210"); // raw phone
    expect(html).not.toContain("123456789012"); // raw account
    // Masked forms present.
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
    expect(screen.getByText("••••9012")).toBeInTheDocument();
  });

  it("DETAIL-01: GSTIN and IFSC remain visible (public business identifiers)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    const { container } = render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(container.innerHTML).toContain("22AAAAA0000A1Z5");
    expect(container.innerHTML).toContain("SBIN0001234");
  });

  it("DETAIL-03: KYC 'Verified At' uses the Indian date format, not raw ISO", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("06 Mar 2026")).toBeInTheDocument(); // 18:40Z -> IST next day
    expect(screen.queryByText("2026-03-05")).toBeNull();
  });

  it("DETAIL-03: KYC status 'in_progress' renders as 'In progress'", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("In_progress")).toBeNull();
  });

  it("DETAIL-05: empanelment appears once (header pill only, not duplicated in the details card)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByText("Empanelment")).toBeNull(); // the details-card field label is gone
    expect(screen.getAllByText("Empanelled").length).toBe(1);
  });

  it("DETAIL-05: the buyer rating pill is labelled to disambiguate from the /100 scorecard", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText(/Buyer rating/)).toBeInTheDocument();
  });

  it("NEW-03: ?registered=1 shows a confirmation banner with the honest initial status", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentStatus: "not_empanelled" }, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }), searchParams: Promise.resolve({ registered: "1" }) }));
    expect(screen.getByText(/Vendor registered/)).toBeInTheDocument();
    expect(screen.getByText(/complete KYC and empanelment before ordering/)).toBeInTheDocument();
  });
  // GAP-PROCUREMENT-VENDORS-DETAIL-02: role-gated lifecycle actions.
  it("DETAIL-02: a procurement writer sees Suspend and Blacklist on an empanelled vendor (no Empanel)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("button", { name: "Suspend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blacklist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empanel" })).toBeNull();
  });

  it("DETAIL-02: a registered (not empanelled) vendor offers Empanel, not Suspend", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentStatus: "not_empanelled" }, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("button", { name: "Empanel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
  });

  it("DETAIL-02: a lapsed empanelment offers Re-empanel instead of Suspend", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentLapsed: true }, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("button", { name: "Re-empanel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
  });

  it("DETAIL-02: a viewer role sees no lifecycle controls", async () => {
    sessionRoles = ["audit_officer"];
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByTestId("vendor-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Blacklist" })).toBeNull();
  });

  it("DETAIL-02: a blacklisted vendor shows no action buttons, only the register note", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentStatus: "blacklisted" }, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByRole("button", { name: "Blacklist" })).toBeNull();
    expect(screen.getByText(/Reinstate it from the vendor blacklist register/)).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-VENDORS-DETAIL-04: validity + orders history.
  it("DETAIL-04: shows the empanelment validity and an Expired pill when lapsed", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentValidTill: "2026-01-31", empanelmentLapsed: true }, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("Empanelment valid till")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("DETAIL-04: warns when the empanelment expires within 30 days", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentValidTill: "2026-06-30" }, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("Expires in 15 days")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("DETAIL-04: lists the vendor's orders with links, asking the loader for this vendor only", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    ordersMock.mockResolvedValue({
      data: [
        { id: "po-1", poNo: "PO-2026-001", vendor: "Acme", amount: 1250000, orderDate: "2026-05-01", status: "approved" },
        { id: "po-2", poNo: "PO-2026-002", vendor: "Acme", amount: 50000, orderDate: "2026-05-09", status: "draft" },
      ],
      source: "api",
    });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(ordersMock).toHaveBeenCalledWith({ vendorId: "v1", limit: 50 });
    expect(screen.getByRole("link", { name: "PO-2026-001" })).toHaveAttribute("href", "/procurement/orders/po-1");
    expect(screen.getByText("₹12,500.00")).toBeInTheDocument();
  });

  it("DETAIL-04: a failed orders fetch shows an error state, not 'No purchase orders'", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    ordersMock.mockResolvedValue({ data: [], source: "error" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByText("No purchase orders")).toBeNull();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("DETAIL-04: no orders is an honest empty state", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("No purchase orders")).toBeInTheDocument();
  });
});


describe("VendorDetailPage - GAP-PROCUREMENT-VENDORS-DETAIL-04 history", () => {
  beforeEach(() => {
    vendorMock.mockReset();
    ordersMock.mockReset();
    grnsMock.mockReset(); emdMock.mockReset(); pbgMock.mockReset();
    ordersMock.mockResolvedValue({ data: [], source: "api" });
    grnsMock.mockResolvedValue({ data: [], source: "api" });
    emdMock.mockResolvedValue({ data: [], source: "api" });
    pbgMock.mockResolvedValue({ data: [], source: "api" });
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    sessionRoles = ["procurement_officer"];
  });

  it("asks the server for THIS vendor's GRNs, EMDs and guarantees", async () => {
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(grnsMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "v1" }));
    expect(emdMock).toHaveBeenCalledWith("v1");
    expect(pbgMock).toHaveBeenCalledWith("v1");
  });

  it("lists the vendor's GRNs with links to /procurement/grn/<id>", async () => {
    grnsMock.mockResolvedValue({ data: [{ id: "g1", grnNo: "GRN-2026-0001", receivedDate: "2026-09-01", status: "accepted" }], source: "api" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByRole("link", { name: "GRN-2026-0001" })).toHaveAttribute("href", "/procurement/grn/g1");
  });

  it("a failed GRN fetch shows an error state, not 'No goods receipts'", async () => {
    grnsMock.mockResolvedValue({ data: [], source: "error" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByText("No goods receipts")).not.toBeInTheDocument();
    expect(screen.getByText(/vendor goods receipts/i)).toBeInTheDocument();
  });

  it("with no GRNs, EMD or guarantees the empty states read as empty (not as errors)", async () => {
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("No goods receipts")).toBeInTheDocument();
    expect(screen.getByText("No EMD or bank guarantees")).toBeInTheDocument();
  });

  it("shows EMD and bank guarantees together, and one register failing is an error, not 'none'", async () => {
    emdMock.mockResolvedValue({ data: [{ id: "e1", kind: "EMD", ref: "EMD-001", instrument: "dd", amountMinor: "500000", status: "held" }], source: "api" });
    pbgMock.mockResolvedValue({ data: [{ id: "b1", kind: "PBG", ref: "PBG-001", instrument: "bank_guarantee", amountMinor: "900000", status: "active", validUntil: "2027-01-31" }], source: "api" });
    const first = render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getByText("EMD-001")).toBeInTheDocument();
    expect(screen.getByText("PBG-001")).toBeInTheDocument();
    first.unmount();
    pbgMock.mockResolvedValue({ data: [], source: "error" });
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByText("EMD-001")).not.toBeInTheDocument();
    expect(screen.queryByText("No EMD or bank guarantees")).not.toBeInTheDocument();
  });
});

describe("VendorDetailPage - GAP-PROCUREMENT-VENDORS-02 audited reveal", () => {
  beforeEach(() => {
    vendorMock.mockReset();
    ordersMock.mockReset();
    ordersMock.mockResolvedValue({ data: [], source: "api" });
    grnsMock.mockResolvedValue({ data: [], source: "api" });
    emdMock.mockResolvedValue({ data: [], source: "api" });
    pbgMock.mockResolvedValue({ data: [], source: "api" });
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
  });

  it("a procurement officer gets a Reveal control for phone and email but NOT for PAN", async () => {
    sessionRoles = ["procurement_officer"];
    const { container } = render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getAllByRole("button", { name: /^Reveal$/ })).toHaveLength(2);
    expect(container.innerHTML).not.toContain("9876543210");
  });

  it("an admin can reveal PAN too; the clear value is still absent from the initial DOM", async () => {
    sessionRoles = ["procurement_admin"];
    const { container } = render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.getAllByRole("button", { name: /^Reveal$/ })).toHaveLength(3);
    expect(container.innerHTML).not.toContain("ABCDE1234F");
  });

  it("a role without reveal rights sees masked values and no Reveal control (fail closed)", async () => {
    sessionRoles = ["finance_officer"];
    render(await VendorDetailPage({ params: Promise.resolve({ id: "v1" }) }));
    expect(screen.queryByRole("button", { name: /^Reveal$/ })).not.toBeInTheDocument();
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
  });
});
