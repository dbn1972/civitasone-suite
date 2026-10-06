import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, seed: unknown) => ({ data: seed, provenance: "live", offline: false, cachedAt: null }),
}));

import { PlansClient } from "./PlansClient";
import type { PlansData } from "@/app/_data/loaders";

// Deliberately UNSORTED (Enterprise before Basic) to exercise price-based
// Upgrade/Downgrade labelling (GAP-TENANT-ADMIN-PLANS-05).
const DATA: PlansData = {
  currentPlanId: "basic",
  trialDaysLeft: null,
  plans: [
    { id: "enterprise", name: "Enterprise", pricePerMonth: 500000, maxUsers: 500, storageGb: 500, maxApiCalls: 1000000, modules: ["finance", "hrms", "payroll"] },
    { id: "basic", name: "Basic", pricePerMonth: 100000, maxUsers: 50, storageGb: 50, maxApiCalls: 100000, modules: ["finance"] },
  ],
  invoices: [{ id: "i1", date: "2026-01-15T00:00:00Z", amount: 100000, status: "paid" }],
} as unknown as PlansData;

describe("PlansClient — GAP-TENANT-ADMIN-PLANS-01/-02/-03/-04/-05", () => {
  it("labels the higher-priced plan as Upgrade regardless of array order (-05)", () => {
    render(<PlansClient plansData={DATA} source="api" />);
    // Enterprise (higher price) → Request upgrade; current = Basic.
    expect(screen.getByRole("button", { name: "Request upgrade" })).toBeInTheDocument();
  });

  it("never shows a fake payment/success — no Razorpay, no 'Upgrade Successful' (-01/-04)", () => {
    render(<PlansClient plansData={DATA} source="api" />);
    expect(screen.queryByText(/Razorpay/i)).toBeNull();
    expect(screen.queryByText(/Upgrade Successful/i)).toBeNull();
  });

  it("confirming a change shows an honest 'administrator' message and no success state (-01/-02)", () => {
    render(<PlansClient plansData={DATA} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Request upgrade" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/platform administrator/i);
    expect(within(dialog).getByRole("button", { name: "Contact administrator" })).toBeInTheDocument();
    // Confirming just closes the dialog — no "success" is ever shown.
    fireEvent.click(within(dialog).getByRole("button", { name: "Contact administrator" }));
    expect(screen.queryByText(/Upgrade Successful/i)).toBeNull();
  });

  it("has no dead PDF button in the invoice table (-04)", () => {
    render(<PlansClient plansData={DATA} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.queryByRole("button", { name: /PDF/i })).toBeNull();
  });
});
