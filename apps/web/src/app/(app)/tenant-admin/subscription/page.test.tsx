import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const { getSubscription, getTenantInvoices } = vi.hoisted(() => ({ getSubscription: vi.fn(), getTenantInvoices: vi.fn() }));
vi.mock("../../../_data/loaders", () => ({ getSubscription: () => getSubscription(), getTenantInvoices: () => getTenantInvoices() }));

import SubscriptionPage from "./page";

afterEach(() => vi.clearAllMocks());
beforeEach(() => getTenantInvoices.mockResolvedValue({ source: "api", data: [] }));

const SUB = {
  id: "s1",
  plan: "Pro",
  status: "past_due",
  currentPeriodStart: "2026-09-01",
  currentPeriodEnd: "2026-09-30",
  userLimit: 100,
  activeUsers: 72,
  moduleAccess: ["finance", "hr_payroll"],
  currency: "INR",
  amount: 499900, // paise
};

describe("SubscriptionPage (GAP-TENANT-ADMIN-SUBSCRIPTION-01/02/04/05)", () => {
  it("on error shows RefreshErrorState and hides header actions (SUBSCRIPTION-01)", async () => {
    getSubscription.mockResolvedValue({ source: "error", data: null });
    const ui = await SubscriptionPage();
    render(ui);
    expect(screen.queryByText(/Download invoice/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Upgrade plan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No active subscription/)).not.toBeInTheDocument();
  });

  it("api-null shows an honest 'No active subscription' empty state (SUBSCRIPTION-01)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: null });
    const ui = await SubscriptionPage();
    render(ui);
    expect(screen.getByText("No active subscription")).toBeInTheDocument();
  });

  it("Upgrade links to /tenant-admin/plans (SUBSCRIPTION-02)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    const ui = await SubscriptionPage();
    render(ui);
    expect(screen.getByText("Upgrade plan").closest("a")).toHaveAttribute("href", "/tenant-admin/plans");
  });

  it("renders no 'Download invoice' link: no service implements invoices/latest (SUBSCRIPTION-04, interim)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    const ui = await SubscriptionPage();
    const { container } = render(ui);
    expect(screen.queryByText("Download invoice")).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="invoices/latest"]')).toBeNull();
  });

  it("a suspended subscription shows as Suspended, not a trial (SUBSCRIPTION-06)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: { ...SUB, status: "suspended" } });
    const ui = await SubscriptionPage();
    render(ui);
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
  });

  it("quota bar has progressbar semantics and status humanizes (SUBSCRIPTION-05)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    const ui = await SubscriptionPage();
    render(ui);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "72");
    expect(bar).toHaveAttribute("aria-label", "Users usage 72%");
    expect(screen.getByText("Past Due")).toBeInTheDocument();
  });

  it("formats amount as paise money and module keys as display names (SUBSCRIPTION-03/05)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    const ui = await SubscriptionPage();
    render(ui);
    // 499900 paise -> ₹4,999.00 (not ₹499900).
    expect(screen.getByText("₹4,999.00")).toBeInTheDocument();
    expect(screen.getByText("Hr Payroll")).toBeInTheDocument();
  });
});

describe("SubscriptionPage - owner decision #27 invoice list + PDF (SUBSCRIPTION-04)", () => {
  const INV = { id: "11111111-1111-4111-8111-111111111111", invoiceNumber: "INV-202609-11111111", periodMonth: "2026-09", issuedAt: "2026-09-05T00:00:00.000Z", status: "issued", totalMinor: "11800", supplierGstin: "07AAACN1234A1Z5", recipientGstin: "07AABCD5678B1Z2", placeOfSupply: "07", cgstMinor: "900", sgstMinor: "900", igstMinor: "0" };

  it("lists the tenant's invoices with a PDF link per issued invoice", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    getTenantInvoices.mockResolvedValue({ source: "api", data: [INV] });
    render(await SubscriptionPage());
    expect(screen.getByText("INV-202609-11111111")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download invoice INV-202609-11111111 as PDF" })).toHaveAttribute("href", `/api/proxy/v1/billing/invoices/${INV.id}/pdf`);
  });

  it("no invoices yet is an empty state", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    getTenantInvoices.mockResolvedValue({ source: "api", data: [] });
    render(await SubscriptionPage());
    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });

  it("when the invoice list fails to load it says so instead of claiming there are none", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    getTenantInvoices.mockResolvedValue({ source: "error", data: [] });
    render(await SubscriptionPage());
    expect(screen.queryByText("No invoices yet")).toBeNull();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
});
