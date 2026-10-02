import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown) {
  mockedHook.mockReturnValue({ data: data as never, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
}
import { CashBankTable } from "./CashBankTable";

const E = {
  id: "1", entry_date: "2026-09-26", voucher_type: "receipt", voucher_no: "V1", particulars: "Fee",
  receipt_minor: "50000", payment_minor: "0", balance_minor: "0", bank_or_cash: "cash", reference: null, created_at: "2026-09-26T00:00:00Z",
};

describe("CashBankTable", () => {
  beforeEach(() => mockedHook.mockReset());

  it("formats the date as dd Mon yyyy (CASH-BANK-03)", () => {
    seed([E]);
    const { container } = render(<CashBankTable entries={[]} source="api" />);
    expect(container.textContent).toMatch(/26 Sep 2026/);
  });

  it("shows a dash for the empty side but a genuine zero Balance as ₹0.00 (CASH-BANK-06)", () => {
    seed([E]);
    const { container } = render(<CashBankTable entries={[]} source="api" />);
    const cells = Array.from(container.querySelectorAll("tbody tr td")).map((td) => td.textContent ?? "");
    expect(cells.some((c) => c.includes("500.00"))).toBe(true); // receipt 50000 paise
    expect(cells.filter((c) => c.includes("0.00") && !c.includes("500.00")).length).toBe(1); // balance only
    expect(cells).toContain("—"); // empty payment side
  });
});
