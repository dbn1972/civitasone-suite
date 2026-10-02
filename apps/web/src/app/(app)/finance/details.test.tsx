import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const loaders = vi.hoisted(() => ({
  getFinanceBillById: vi.fn(),
  getFinancePaymentById: vi.fn(),
  getFinanceVendorById: vi.fn(),
  getFinanceSchemeById: vi.fn(),
}));
vi.mock("@/app/_data/loaders", () => loaders);
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  // GAP-FINANCE-PAYMENTS-DETAIL-05: the payment detail hands a real 404 to the route-level not-found page.
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => <div>raise-eoffice</div> }));
vi.mock("./expenditure/bills/[id]/BillLineItemsTable", () => ({ BillLineItemsTable: () => <div>lines</div> }));

import BillDetailPage from "./expenditure/bills/[id]/page";
import PaymentDetailPage from "./payments/[id]/page";
import VendorDetailPage from "./vendors/[id]/page";
import SchemeDetailPage from "./expenditure/scheme-tracking/[id]/page";

const err500 = { data: null, source: "error" as const, status: 500 };
const err404 = { data: null, source: "error" as const, status: 404 };
const err403 = { data: null, source: "error" as const, status: 403, errorMessage: "no access" };

describe("detail pages: a failed load is not 'not found' (FAILMASK)", () => {
  beforeEach(() => Object.values(loaders).forEach((m) => m.mockReset()));

  const cases: [string, keyof typeof loaders, () => Promise<React.ReactElement>, RegExp][] = [
    ["bill", "getFinanceBillById", () => BillDetailPage({ params: { id: "b1" } }), /emptyTitleNotFound/],
    ["payment", "getFinancePaymentById", () => PaymentDetailPage({ params: { id: "p1" } }), /Payment not found/],
    ["vendor", "getFinanceVendorById", () => VendorDetailPage({ params: { id: "v1" } }), /Vendor not found/],
    ["scheme", "getFinanceSchemeById", () => SchemeDetailPage({ params: { id: "s1" } }), /emptyTitleNotAvailable/],
  ];

  for (const [name, loader, page, notFound] of cases) {
    it(`${name}: 500 shows a retry error state, not the not-found copy`, async () => {
      loaders[loader].mockResolvedValue(err500);
      render(await page());
      expect(screen.queryByText(notFound)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    });
    it(`${name}: 404 shows the not-found copy`, async () => {
      loaders[loader].mockResolvedValue(err404);
      if (name === "payment") {
        await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
        return;
      }
      render(await page());
      expect(screen.getByText(notFound)).toBeInTheDocument();
    });
    it(`${name}: 403 shows permission denied`, async () => {
      loaders[loader].mockResolvedValue(err403);
      render(await page());
      expect(screen.getByText("Access restricted")).toBeInTheDocument();
      expect(screen.queryByText(notFound)).not.toBeInTheDocument();
    });
  }
});

describe("vendor detail masks PAN and account number (GAP-FINANCE-VENDORS-DETAIL-01)", () => {
  beforeEach(() => loaders.getFinanceVendorById.mockReset());
  it("never prints the full PAN or bank account", async () => {
    loaders.getFinanceVendorById.mockResolvedValue({
      data: { name: "Acme", pan: "ABCDE1234F", bankAccount: "123456789012", ifsc: "HDFC0001", bankName: "HDFC", status: "active", bills: [] },
      source: "api",
    });
    const { container } = render(await VendorDetailPage({ params: { id: "v1" } }));
    expect(container.textContent).not.toContain("ABCDE1234F");
    expect(container.textContent).not.toContain("123456789012");
    expect(container.textContent).toContain("ABCDE****F");
    expect(container.textContent).toContain("9012");
  });
});
