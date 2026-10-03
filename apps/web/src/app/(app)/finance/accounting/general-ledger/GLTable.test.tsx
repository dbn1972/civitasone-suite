import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { GLTable } from "./GLTable";
import { GL_PAGE_SIZE, parseGlView, type GlView } from "./glPage";

const ENTRY = (over: Record<string, unknown> = {}) => ({
  id: "j1:1000", voucherNo: "JV-1", date: "2026-06-01", accountCode: "1000", accountName: "Cash",
  narration: null, referenceNo: null, type: "journal", debit: "50000", credit: "0", ...over,
});
const totals = (over: Record<string, unknown> = {}) => ({ entryLines: 2, vouchers: 1, accountsActive: 2, debitMinor: "50000", creditMinor: "50000", ...over });
const view = (over: Partial<GlView> = {}): GlView => ({ ...parseGlView({}, new Date("2026-09-15T05:00:00Z")), ...over });
const pag = (total: number, page = 1) => ({ limit: GL_PAGE_SIZE, offset: (page - 1) * GL_PAGE_SIZE, total, hasMore: page * GL_PAGE_SIZE < total });

describe("GLTable: server-driven (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03)", () => {
  beforeEach(() => pushMock.mockReset());

  it("titles the card with the fiscal year, not 'all fiscal years'", () => {
    render(<GLTable entries={[ENTRY() as never]} pagination={pag(1)} totals={totals() as never} view={view({ fy: "2026-27" })} />);
    expect(screen.getByText("General ledger · FY 2026-27")).toBeInTheDocument();
    expect(screen.queryByText(/all fiscal years/i)).not.toBeInTheDocument();
  });

  it("the cards and footer show the WHOLE filtered set from the server, not the 25 rows on screen", () => {
    render(<GLTable entries={[ENTRY() as never]} pagination={pag(4812)} totals={totals({ entryLines: 4812, vouchers: 1900, accountsActive: 37, debitMinor: "123456789", creditMinor: "123456789" }) as never} view={view()} />);
    expect(screen.getByText("Vouchers").parentElement).toHaveTextContent("1900");
    expect(screen.getByText("Entry lines").parentElement).toHaveTextContent("4812");
    expect(screen.getByText("Accounts Active").parentElement).toHaveTextContent("37");
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText(/1–25 of 4812 entries/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 193")).toBeInTheDocument();
  });

  it("debit != credit shows 'Unbalanced'; an empty set is 'no entries', never 'Balanced'", () => {
    const { unmount } = render(<GLTable entries={[ENTRY() as never]} pagination={pag(2)} totals={totals({ creditMinor: "30000" }) as never} view={view()} />);
    expect(screen.getByText("Unbalanced")).toBeInTheDocument();
    unmount();
    render(<GLTable entries={[]} pagination={pag(0)} totals={totals({ entryLines: 0, vouchers: 0, accountsActive: 0, debitMinor: "0", creditMinor: "0" }) as never} view={view({ fy: "2026-27" })} />);
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
    expect(screen.getByText("No entries in FY 2026-27")).toBeInTheDocument();
  });

  it("a filter that matches nothing says so (different from an empty year)", () => {
    render(<GLTable entries={[]} pagination={pag(0)} totals={totals({ entryLines: 0, vouchers: 0, accountsActive: 0, debitMinor: "0", creditMinor: "0" }) as never} view={view({ q: "zzz" })} />);
    expect(screen.getByText("No entries for this filter")).toBeInTheDocument();
  });

  it("with no totals (older payload) the cards show a dash instead of zeros", () => {
    render(<GLTable entries={[ENTRY() as never]} pagination={pag(1)} totals={null} view={view()} />);
    expect(screen.getByText("Vouchers").parentElement).toHaveTextContent("—");
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
  });

  it("changing the tab or searching navigates by URL (server refetch) and resets to page 1", () => {
    render(<GLTable entries={[ENTRY() as never]} pagination={pag(60, 2)} totals={totals({ entryLines: 60 }) as never} view={view({ page: 2 })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Payment" }));
    expect(pushMock).toHaveBeenLastCalledWith("/finance/accounting/general-ledger?type=payment");
    fireEvent.change(screen.getByLabelText("Search general ledger"), { target: { value: " PV-1 " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(pushMock).toHaveBeenLastCalledWith("/finance/accounting/general-ledger?q=PV-1");
  });

  it("Previous / Next move one page and are disabled at the ends", () => {
    const { unmount } = render(<GLTable entries={[ENTRY() as never]} pagination={pag(60, 1)} totals={totals() as never} view={view({ page: 1 })} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(pushMock).toHaveBeenLastCalledWith("/finance/accounting/general-ledger?page=2");
    unmount();
    render(<GLTable entries={[ENTRY() as never]} pagination={pag(60, 3)} totals={totals() as never} view={view({ page: 3 })} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(pushMock).toHaveBeenLastCalledWith("/finance/accounting/general-ledger?page=2");
  });

  it("keeps the filtered-total wording only when a filter is active", () => {
    const a = render(<GLTable entries={[ENTRY() as never]} pagination={pag(2)} totals={totals() as never} view={view()} />);
    const footer = () => screen.getByRole("navigation", { name: "General ledger pages" });
    expect(footer()).toHaveTextContent(/— Total Debit:/);
    expect(footer()).not.toHaveTextContent(/Filtered total/);
    a.unmount();
    render(<GLTable entries={[ENTRY() as never]} pagination={pag(2)} totals={totals() as never} view={view({ tab: "Payment" })} />);
    expect(footer()).toHaveTextContent(/Filtered total Debit:/);
  });
});
