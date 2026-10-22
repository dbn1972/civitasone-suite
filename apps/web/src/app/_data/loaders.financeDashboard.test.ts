import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { getFinanceDashboard } from "./loaders";

const BASE = { budgetUtilisationPct: 50, pendingSanctions: 1, paymentsThisMonth: 2, totalExpenditure: 300 };

async function mapper() {
  fetchJsonMock.mockResolvedValue({ data: null, source: "api" });
  await getFinanceDashboard("2026-27");
  return (fetchJsonMock.mock.calls[0]![2] as { mapResponse: (p: unknown) => Record<string, unknown> | null }).mapResponse;
}

// GAP-FINANCE-DASHBOARD-01
describe("getFinanceDashboard categoryBreakdown mapping", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("carries a well-formed breakdown through unchanged (paise strings)", async () => {
    const map = await mapper();
    const out = map({ ...BASE, categoryBreakdown: [{ label: "Works", amountMinor: "123456" }, { label: "Grants", amountMinor: "0" }] });
    expect(out?.categoryBreakdown).toEqual([{ label: "Works", amountMinor: "123456" }, { label: "Grants", amountMinor: "0" }]);
  });

  it("leaves it out when the service sends none (older API) or an empty list", async () => {
    const map = await mapper();
    expect(map(BASE)).not.toHaveProperty("categoryBreakdown");
    expect(map({ ...BASE, categoryBreakdown: [] })).not.toHaveProperty("categoryBreakdown");
    expect(map({ ...BASE, categoryBreakdown: "nope" })).not.toHaveProperty("categoryBreakdown");
  });

  it.each([
    ["a number amount (could be rupees)", { label: "Works", amountMinor: 1234 }],
    ["a decimal amount", { label: "Works", amountMinor: "12.50" }],
    ["a negative amount", { label: "Works", amountMinor: "-5" }],
    ["a blank label", { label: "  ", amountMinor: "5" }],
    ["a missing label", { amountMinor: "5" }],
    ["a non-object entry", "Works"],
  ])("one bad entry (%s) drops the WHOLE breakdown instead of drawing a partial split", async (_n, bad) => {
    const map = await mapper();
    const out = map({ ...BASE, categoryBreakdown: [{ label: "Fine", amountMinor: "100" }, bad] });
    expect(out).not.toHaveProperty("categoryBreakdown");
    // the rest of the dashboard is unaffected
    expect(out).toMatchObject({ budgetUtilisationPct: 50, totalExpenditure: 300 });
  });
});
