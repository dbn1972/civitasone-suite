import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceVendorById = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/loaders", () => ({ getFinanceVendorById: (...a: unknown[]) => getFinanceVendorById(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => [] }));
vi.mock("../VendorStatusAction", () => ({ VendorStatusAction: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import VendorDetailPage from "./page";

const base = { id: "v1", name: "Acme", category: "Goods", status: "active", version: 1 };

describe("VendorDetailPage (GAP-FINANCE-VENDORS-DETAIL-03 / -05 / -06 / -07)", () => {
  beforeEach(() => getFinanceVendorById.mockReset());

  it("Total Paid counts paid bills only, Total Billed all of them", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: {
        ...base,
        bills: [
          { id: "b1", billNo: "B-1", date: "2025-03-01", amount: "1000", tds: "100", status: "paid" },
          { id: "b2", billNo: "B-2", date: "2025-03-02", amount: "500", tds: "50", status: "pending" },
          { id: "b3", billNo: "B-3", date: "2025-03-03", amount: "200", tds: "0", status: "rejected" },
        ],
      },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).toHaveTextContent("₹10.00");
    expect(screen.getByText("Total Billed").closest(".stat")).toHaveTextContent("₹17.00");
    expect(screen.getByText("TDS Deducted (initiated payments)").closest(".stat")).toHaveTextContent("₹1.00");
  });

  it("shows an em dash, not the pending sum, when no bill is paid", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: { ...base, bills: [{ id: "b2", billNo: "B-2", date: "2025-03-02", amount: "500", tds: "50", status: "pending" }] },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).not.toHaveTextContent("₹5.00");
  });

  it("sums exactly above 2^53 paise", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: {
        ...base,
        bills: [
          { id: "b1", billNo: "B-1", date: "2025-03-01", amount: "9007199254740993", tds: "0", status: "paid" },
          { id: "b2", billNo: "B-2", date: "2025-03-01", amount: "1", tds: "0", status: "paid" },
        ],
      },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByText("Total Paid (initiated)").closest(".stat")).toHaveTextContent("₹9,00,71,99,25,47,409.94");
  });

  it("prints a single dash for a vendor with no bank data, and a formatted date", async () => {
    getFinanceVendorById.mockResolvedValue({ data: { ...base, createdAt: "2024-03-05T10:00:00Z", bills: [] }, source: "api" });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.queryByText("— (—)")).not.toBeInTheDocument();
    expect(screen.getByText("05 Mar 2024")).toBeInTheDocument();
  });

  it("links a bill row to the expenditure bill detail", async () => {
    getFinanceVendorById.mockResolvedValue({
      data: { ...base, bills: [{ id: "b1", billNo: "B-1", date: "2025-03-01", amount: "1000", tds: "0", status: "paid" }] },
      source: "api",
    });
    render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(screen.getByRole("link", { name: /Open/i })).toHaveAttribute("href", "/finance/expenditure/bills/b1");
  });
});
