/**
 * Owner decision D4c #45: the quotation table shows the server-computed deviation % against the estimate, signed
 * (+ above, - below), with the formula stated once under the table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import { ToastProvider } from "@/app/_components/ds/Toast";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["works_admin"],
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
}));

import TenderDetailPage from "./page";

const quot = (o: Record<string, unknown>) => ({
  id: "q-" + Math.random().toString(16).slice(2, 10), tenderId: "t1", contractorId: null, contractorName: "ACME", method: "item_rate",
  quotedAmountMinor: "100", quotedPercentage: null, deviationPercent: null, status: "submitted", submittedAt: null, awardId: null, ...o,
});
const TENDER = { id: "t1", workId: "11111111-1111-4111-8111-111111111111", workNumber: "WRK-1", status: "open" };

describe("TenderDetailPage: deviation % (D4c #45)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("shows the sign and a percent sign; a missing deviation stays an em dash", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [quot({ contractorName: "Above Co", deviationPercent: "12.00" }), quot({ contractorName: "Below Co", deviationPercent: "-3.25" }), quot({ contractorName: "Par Co", deviationPercent: "0.00" }), quot({ contractorName: "Hidden Co", deviationPercent: null })], source: "api" })
      .mockResolvedValueOnce({ data: TENDER, source: "api" });
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t1" }) })}</ToastProvider>);
    const rowOf = (name: string) => screen.getByText(name).closest("tr")!;
    expect(rowOf("Above Co").textContent).toContain("+12.00%");
    expect(rowOf("Below Co").textContent).toContain("-3.25%");
    expect(rowOf("Par Co").textContent).toContain("0.00%");
    expect(rowOf("Par Co").textContent).not.toContain("+0.00%");
    expect(rowOf("Hidden Co").textContent).toContain("—");
  });

  it("states how the deviation is computed", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: [quot({ deviationPercent: "1.00" })], source: "api" })
      .mockResolvedValueOnce({ data: TENDER, source: "api" });
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t1" }) })}</ToastProvider>);
    expect(screen.getByText(/quoted.*estimate.*estimate.*100/i)).toBeInTheDocument();
  });
});
