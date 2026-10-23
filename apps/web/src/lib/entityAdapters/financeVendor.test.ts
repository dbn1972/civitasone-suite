import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchFinanceVendors, resolveFinanceVendors } from "./financeVendor";

const ROWS = [
  { id: "v1", name: "M/s Acme Traders", category: "supplies", status: "active" },
  { id: "v2", name: "Beta Works", category: "works", status: "active" },
  { id: "v3", name: "Acme Dormant", category: "supplies", status: "inactive" },
  { id: "v4", name: "Acme Pending", category: "supplies", status: "pending" },
  { id: "v5", name: "Acme Rejected", category: "supplies", status: "rejected" },
];
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

// GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03
describe("finance vendor picker adapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("offers only ACTIVE vendors (the service refuses an advance to any other), matched on name or category", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok({ data: ROWS }));
    const found = await searchFinanceVendors("acme", new AbortController().signal);
    expect(found).toEqual([{ id: "v1", label: "M/s Acme Traders", sublabel: "supplies" }]);
    expect(await searchFinanceVendors("works", new AbortController().signal)).toEqual([{ id: "v2", label: "Beta Works", sublabel: "works" }]);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("/api/proxy/v1/finance/vendors");
  });

  it("is capped at 20 matches", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok({ data: Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, name: `Vendor ${i}`, status: "active" })) }));
    expect(await searchFinanceVendors("vendor", new AbortController().signal)).toHaveLength(20);
  });

  it("a failed lookup is empty by default and an error in strict mode (never silently 'no vendors')", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 500 }));
    expect(await searchFinanceVendors("acme", new AbortController().signal)).toEqual([]);
    await expect(searchFinanceVendors("acme", new AbortController().signal, { strict: true })).rejects.toThrow();
  });

  it("resolves ids to their labels, active vendors only, and does not call the API for no ids", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok(ROWS));
    expect(await resolveFinanceVendors(["v2", "v3"])).toEqual([{ id: "v2", label: "Beta Works", sublabel: "works" }]);
    fetchSpy.mockClear();
    expect(await resolveFinanceVendors([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
