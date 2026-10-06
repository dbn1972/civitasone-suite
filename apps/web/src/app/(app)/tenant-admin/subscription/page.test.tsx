import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getSubscription } = vi.hoisted(() => ({ getSubscription: vi.fn() }));
vi.mock("../../../_data/loaders", () => ({ getSubscription: () => getSubscription() }));

import SubscriptionPage from "./page";

afterEach(() => vi.clearAllMocks());

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

  it("Upgrade links to /tenant-admin/plans and invoice goes through the proxy (SUBSCRIPTION-02/04)", async () => {
    getSubscription.mockResolvedValue({ source: "api", data: SUB });
    const ui = await SubscriptionPage();
    render(ui);
    expect(screen.getByText("Upgrade plan").closest("a")).toHaveAttribute("href", "/tenant-admin/plans");
    expect(screen.getByText("Download invoice").closest("a")).toHaveAttribute("href", "/api/proxy/v1/billing/invoices/latest?format=pdf");
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
