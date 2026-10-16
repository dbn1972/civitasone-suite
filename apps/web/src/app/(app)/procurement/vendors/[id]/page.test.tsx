import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const vendorMock = vi.fn();
const ordersMock = vi.fn();
let sessionRoles: string[] = ["procurement_officer"];
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../../../_data/loaders", () => ({
  getProcurementVendorById: (...a: unknown[]) => vendorMock(...a),
  getProcurementPOs: (...a: unknown[]) => ordersMock(...a),
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
    sessionRoles = ["procurement_officer"];
  });

  it("DETAIL-01: PAN, email, phone and bank account are masked (raw value absent from DOM)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    const { container } = render(await VendorDetailPage({ params: { id: "v1" } }));
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
    const { container } = render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(container.innerHTML).toContain("22AAAAA0000A1Z5");
    expect(container.innerHTML).toContain("SBIN0001234");
  });

  it("DETAIL-03: KYC 'Verified At' uses the Indian date format, not raw ISO", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("06 Mar 2026")).toBeInTheDocument(); // 18:40Z -> IST next day
    expect(screen.queryByText("2026-03-05")).toBeNull();
  });

  it("DETAIL-03: KYC status 'in_progress' renders as 'In progress'", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("In_progress")).toBeNull();
  });

  it("DETAIL-05: empanelment appears once (header pill only, not duplicated in the details card)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByText("Empanelment")).toBeNull(); // the details-card field label is gone
    expect(screen.getAllByText("Empanelled").length).toBe(1);
  });

  it("DETAIL-05: the buyer rating pill is labelled to disambiguate from the /100 scorecard", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText(/Buyer rating/)).toBeInTheDocument();
  });

  it("NEW-03: ?registered=1 shows a confirmation banner with the honest initial status", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentStatus: "not_empanelled" }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" }, searchParams: { registered: "1" } }));
    expect(screen.getByText(/Vendor registered/)).toBeInTheDocument();
    expect(screen.getByText(/complete KYC and empanelment before ordering/)).toBeInTheDocument();
  });
  // GAP-PROCUREMENT-VENDORS-DETAIL-02: role-gated lifecycle actions.
  it("DETAIL-02: a procurement writer sees Suspend and Blacklist on an empanelled vendor (no Empanel)", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByRole("button", { name: "Suspend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blacklist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empanel" })).toBeNull();
  });

  it("DETAIL-02: a registered (not empanelled) vendor offers Empanel, not Suspend", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentStatus: "not_empanelled" }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByRole("button", { name: "Empanel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
  });

  it("DETAIL-02: a lapsed empanelment offers Re-empanel instead of Suspend", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentLapsed: true }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByRole("button", { name: "Re-empanel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
  });

  it("DETAIL-02: a viewer role sees no lifecycle controls", async () => {
    sessionRoles = ["audit_officer"];
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByTestId("vendor-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Blacklist" })).toBeNull();
  });

  it("DETAIL-02: a blacklisted vendor shows no action buttons, only the register note", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentStatus: "blacklisted" }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByRole("button", { name: "Blacklist" })).toBeNull();
    expect(screen.getByText(/Reinstate it from the vendor blacklist register/)).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-VENDORS-DETAIL-04: validity + orders history.
  it("DETAIL-04: shows the empanelment validity and an Expired pill when lapsed", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentValidTill: "2026-01-31", empanelmentLapsed: true }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Empanelment valid till")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("DETAIL-04: warns when the empanelment expires within 30 days", async () => {
    vendorMock.mockResolvedValue({ data: { ...VENDOR, empanelmentValidTill: "2026-06-30" }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
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
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(ordersMock).toHaveBeenCalledWith({ vendorId: "v1", limit: 50 });
    expect(screen.getByRole("link", { name: "PO-2026-001" })).toHaveAttribute("href", "/procurement/orders/po-1");
    expect(screen.getByText("₹12,500.00")).toBeInTheDocument();
  });

  it("DETAIL-04: a failed orders fetch shows an error state, not 'No purchase orders'", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    ordersMock.mockResolvedValue({ data: [], source: "error" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByText("No purchase orders")).toBeNull();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("DETAIL-04: no orders is an honest empty state", async () => {
    vendorMock.mockResolvedValue({ data: VENDOR, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("No purchase orders")).toBeInTheDocument();
  });
});
