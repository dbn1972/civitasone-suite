import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@/test-utils/intl-render";

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

  it("Escape closes the change dialog and Tab stays inside it (-05)", () => {
    render(<PlansClient plansData={DATA} source="api" />);
    const trigger = screen.getByRole("button", { name: "Request upgrade" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("has no dead PDF button in the invoice table (-04)", () => {
    render(<PlansClient plansData={DATA} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.queryByRole("button", { name: /PDF/i })).toBeNull();
  });
});

describe("PlansClient - owner decision #26 payment modes by edition and GST invoice columns", () => {
  it("a government edition sees PO/GeM, treasury e-challan and online payment", () => {
    render(<PlansClient plansData={{ ...DATA, edition: "govt_dept" }} source="api" />);
    const box = screen.getByRole("region", { name: /how to pay/i });
    expect(box.textContent).toMatch(/Purchase order \/ GeM/i);
    expect(box.textContent).toMatch(/Treasury e-challan/i);
    expect(box.textContent).toMatch(/Online payment/i);
    expect(screen.queryByText(/Razorpay/i)).toBeNull();
  });

  it("any other edition sees online payment only", () => {
    render(<PlansClient plansData={{ ...DATA, edition: "small_office" }} source="api" />);
    const box = screen.getByRole("region", { name: /how to pay/i });
    expect(box.textContent).toMatch(/Online payment/i);
    expect(box.textContent).not.toMatch(/GeM|Treasury/i);
  });

  it("the invoice history shows the GST columns when the API provides them", () => {
    const data = { ...DATA, invoices: [{ id: "i1", date: "2026-01-15T00:00:00Z", amount: 11800, status: "paid", invoiceNumber: "INV-202601-AAAA1111", supplierGstin: "07AAACN1234A1Z5", recipientGstin: "27AABCD5678B1Z9", placeOfSupply: "27", cgstMinor: 0, sgstMinor: 0, igstMinor: 1800 }] } as unknown as PlansData;
    render(<PlansClient plansData={data} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const table = screen.getByRole("table", { name: /invoices/i });
    expect(table.textContent).toContain("INV-202601-AAAA1111");
    expect(table.textContent).toContain("27AABCD5678B1Z9");
    expect(table.textContent).toContain("₹18.00");
  });
});
