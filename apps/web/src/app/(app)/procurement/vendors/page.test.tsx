import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const vendorsMock = vi.fn();
const summaryMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../../_data/loaders", () => ({
  getProcurementVendors: (...a: unknown[]) => vendorsMock(...a),
  getProcurementVendorSummary: (...a: unknown[]) => summaryMock(...a),
}));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));

import VendorsPage from "./page";

const row = (i: number) => ({ id: `v${i}`, vendorCode: `VEN-${i}`, name: `Vendor ${i}`, category: "goods", empanelmentStatus: "empanelled" });

// D4c #21 (GAP-PROCUREMENT-VENDORS-03): the directory is paged by the server.
describe("VendorsPage server paging", () => {
  beforeEach(() => { vendorsMock.mockReset(); summaryMock.mockReset(); });

  it("page 1 asks the server for the first page and offers Next when more vendors exist", async () => {
    vendorsMock.mockResolvedValue({ data: Array.from({ length: 50 }, (_, i) => row(i)), source: "api" });
    summaryMock.mockResolvedValue({ data: { total: 120, empanelled: 100, registered: 15, blacklisted: 5 }, source: "api" });
    render(await VendorsPage({ searchParams: Promise.resolve({}) }));
    expect(vendorsMock).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/procurement/vendors?page=2");
    expect(screen.queryByRole("link", { name: /Previous/ })).toBeNull();
  });

  it("page 3 passes offset=100 and offers Previous; the last page has no Next", async () => {
    vendorsMock.mockResolvedValue({ data: Array.from({ length: 20 }, (_, i) => row(100 + i)), source: "api" });
    summaryMock.mockResolvedValue({ data: { total: 120, empanelled: 100, registered: 15, blacklisted: 5 }, source: "api" });
    render(await VendorsPage({ searchParams: Promise.resolve({ page: "3" }) }));
    expect(vendorsMock).toHaveBeenCalledWith({ limit: 50, offset: 100 });
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/procurement/vendors?page=2");
    expect(screen.queryByRole("link", { name: /Next/ })).toBeNull();
    expect(screen.getByText("Page 3")).toBeInTheDocument();
  });

  it("a directory that fits one page shows no pager", async () => {
    vendorsMock.mockResolvedValue({ data: [row(1), row(2)], source: "api" });
    summaryMock.mockResolvedValue({ data: { total: 2, empanelled: 2, registered: 0, blacklisted: 0 }, source: "api" });
    render(await VendorsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("navigation", { name: "Vendor pages" })).toBeNull();
  });

  it("a nonsense page param falls back to page 1", async () => {
    vendorsMock.mockResolvedValue({ data: [row(1)], source: "api" });
    summaryMock.mockResolvedValue({ data: null, source: "api" });
    render(await VendorsPage({ searchParams: Promise.resolve({ page: "-4" }) }));
    expect(vendorsMock).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });
});
