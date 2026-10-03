import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { CashBankTable, voucherHref } from "./CashBankTable";

const mockedHook = vi.mocked(useSeededResource);
const E = (over: Record<string, unknown>) => ({
  id: "1", entry_date: "2026-09-26", voucher_type: "receipt", voucher_no: "RCPT/1", particulars: "Fee",
  receipt_minor: "50000", payment_minor: "0", balance_minor: "50000", bank_or_cash: "cash", reference: null, created_at: "2026-09-26T00:00:00Z", ...over,
});

describe("CashBankTable voucher link (GAP-FINANCE-TREASURY-CASH-BANK-05)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("builds the voucher URL only when a journal id exists", () => {
    expect(voucherHref("j-1")).toBe("/api/proxy/v1/finance/journals/j-1/pdf");
    expect(voucherHref(null)).toBeNull();
    expect(voucherHref(undefined)).toBeNull();
  });

  it("links the voucher number to the voucher when the entry has a journal, and leaves it as text otherwise", () => {
    mockedHook.mockReturnValue({ data: [E({ journal_id: "j-1" }), E({ id: "2", voucher_no: "ORPHAN" })], offline: false, cachedAt: null, provenance: "live" } as never);
    render(<CashBankTable entries={[]} source="api" />);
    const link = screen.getByRole("link", { name: "Open voucher RCPT/1" });
    expect(link.getAttribute("href")).toBe("/api/proxy/v1/finance/journals/j-1/pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("ORPHAN").closest("a")).toBeNull();
  });
});
