import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const getPaymentsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getPayments: () => getPaymentsMock() }));
const rolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, provenance: "live", offline: false, cachedAt: null }),
}));

import PaymentsPage from "./page";
import { ToastProvider } from "@/app/_components/ds";

async function renderPage() {
  return render(<ToastProvider>{await PaymentsPage()}</ToastProvider>);
}

const ROWS = [
  { id: "p1", referenceId: "EFT-1", beneficiary: "ACME", amountDisplay: "₹1,00,00,000.00", amountMinor: "1000000000", status: "Released" },
  { id: "p2", referenceId: "EFT-2", beneficiary: "Beta", amountDisplay: "₹99,99,999.00", amountMinor: "999999900", status: "Pending Approval" },
  { id: "p3", referenceId: "EFT-3", beneficiary: "Gamma", amountDisplay: "₹10.00", amountMinor: "1000", status: "Queued" },
];

describe("PaymentsPage", () => {
  beforeEach(() => {
    getPaymentsMock.mockReset();
    rolesMock.mockReset();
    getPaymentsMock.mockResolvedValue({ data: ROWS, source: "api" });
  });

  // GAP-FINANCE-PAYMENTS-06
  it("is titled 'Payments', matching the tile and breadcrumb", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(screen.queryByText("Payment Gateway")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PAYMENTS-04
  it("offers the (disabled) PFMS Sync and + New Payment to a role the API admits", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    await renderPage();
    expect(screen.getByRole("button", { name: /PFMS Sync/ })).toBeDisabled();
    expect(screen.getByRole("link", { name: "+ New Payment" })).toBeInTheDocument();
  });

  it.each(["audit_officer", "budget_officer", "accounts_officer"])("hides both actions from %s (read-only register)", async (role) => {
    rolesMock.mockReturnValue([role]);
    await renderPage();
    expect(screen.queryByRole("button", { name: /PFMS Sync/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ New Payment" })).not.toBeInTheDocument();
    expect(screen.getByText("ACME")).toBeInTheDocument();
  });

  // GAP-FINANCE-PAYMENTS-03
  it("colours Released green, Pending Approval amber, Queued grey in the register", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    const { container } = await renderPage();
    const tones = Array.from(container.querySelectorAll("table .pill")).map((el) => [el.textContent, [...el.classList].find((c) => c !== "pill")]);
    expect(tones).toEqual(
      expect.arrayContaining([
        ["Released", "good"],
        ["Pending Approval", "warn"],
        ["Queued", "mut"],
      ]),
    );
  });

  // GAP-FINANCE-PAYMENTS-05
  it("sorts the Amount column numerically: 99,99,999 before 1,00,00,000", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    const { container } = await renderPage();
    const amountHeader = screen.getByRole("columnheader", { name: /Amount/ });
    fireEvent.click(amountHeader);
    const firstDataCol = Array.from(container.querySelectorAll("tbody tr")).map((tr) => tr.textContent ?? "");
    const idxSmall = firstDataCol.findIndex((t) => t.includes("₹99,99,999.00"));
    const idxBig = firstDataCol.findIndex((t) => t.includes("₹1,00,00,000.00"));
    expect(idxSmall).toBeGreaterThanOrEqual(0);
    expect(idxSmall).toBeLessThan(idxBig);
  });
});
