import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));

import { FundReleasesTable, releaseAmountLabel } from "./FundReleasesTable";

const rel = (o: Record<string, unknown>) => ({
  id: "r1", fy: "2026-27", fromOfficeId: "11111111-1111-4111-8111-111111111111", toOfficeId: "22222222-2222-4222-8222-222222222222",
  amountMinor: "123456", currency: "INR", status: "issued", effectiveFrom: "2026-03-31T20:00:00Z", issuedBy: "33333333-3333-4333-8333-333333333333", ...o,
});

describe("FundReleasesTable", () => {
  // GAP-FINANCE-BUDGET-FUND-RELEASES-03
  it("shows the exact paise amount: 123456 -> ₹1,234.56 (old rupees() printed ₹1235)", () => {
    render(<FundReleasesTable releases={[rel({})]} />);
    expect(screen.getByText("₹1,234.56")).toBeInTheDocument();
  });

  it("renders a crore-scale amount exactly, not as a rounded shorthand", () => {
    render(<FundReleasesTable releases={[rel({ amountMinor: "12500000000" })]} />);
    expect(screen.getByText("₹12,50,00,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/Cr\b/)).not.toBeInTheDocument();
  });

  it("an invalid or decimal amount renders — without throwing", () => {
    expect(releaseAmountLabel("abc", "INR")).toBe("—");
    expect(releaseAmountLabel(null, "INR")).toBe("—");
    expect(() => render(<FundReleasesTable releases={[rel({ amountMinor: "12.5" })]} />)).not.toThrow();
  });

  it("a non-INR release is shown under its ISO code, not a rupee sign", () => {
    expect(releaseAmountLabel("123456", "USD")).toBe("USD 1,234.56");
  });

  // GAP-FINANCE-BUDGET-FUND-RELEASES-05
  it("Effective date is the IST calendar date: 2026-03-31T20:00:00Z -> 01 Apr 2026", () => {
    render(<FundReleasesTable releases={[rel({})]} />);
    expect(screen.getByText(/01.*Apr.*2026/)).toBeInTheDocument();
    expect(screen.queryByText("2026-03-31")).not.toBeInTheDocument();
  });

  it("hides the CCY column when every release is INR, shows it otherwise", () => {
    const { unmount } = render(<FundReleasesTable releases={[rel({})]} />);
    expect(screen.queryByText("CCY")).not.toBeInTheDocument();
    unmount();
    render(<FundReleasesTable releases={[rel({}), rel({ id: "r2", currency: "USD" })]} />);
    expect(screen.getByText("CCY")).toBeInTheDocument();
  });

  it("no longer computes an unused 'issued by' id fragment (no 8-char uuid tails anywhere)", () => {
    render(<FundReleasesTable releases={[rel({})]} />);
    expect(document.body.textContent).not.toContain("33333333".slice(-8) + "3333");
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}(?![0-9a-f-])/);
  });
});
