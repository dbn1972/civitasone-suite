import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const vendorMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getProcurementVendorById: (...a: unknown[]) => vendorMock(...a),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["procurement_officer"],
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
  PROCUREMENT_APPROVER_ROLES: ["procurement_admin", "super_admin"],
}));

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
  beforeEach(() => vendorMock.mockReset());

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
});
