import { describe, it, expect, vi, afterEach } from "vitest";
import { searchDepartments } from "./department";
import { searchLocations } from "./location";
import { searchIdentityUsers } from "./identityUser";
import { searchEmployees } from "./employee";
import { searchPayrollEmployees } from "./payrollEmployee";
import { searchWarehouses, resolveWarehouses } from "./warehouse";

// SF-06: a failed lookup must be distinguishable from "nothing matches".
// Default behaviour is unchanged ([] on non-ok); { strict: true } throws.
const signal = () => new AbortController().signal;

const ADAPTERS: Array<[string, (q: string, s: AbortSignal, o?: { strict?: boolean }) => Promise<unknown>]> = [
  ["departments", searchDepartments],
  ["locations", searchLocations],
  ["identity users", searchIdentityUsers],
  ["employees", searchEmployees],
  ["payroll employees", searchPayrollEmployees],
  ["warehouses", searchWarehouses],
];

describe("entity adapters: strict search", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(ADAPTERS)("%s: non-ok resolves [] by default (back-compat)", async (_n, search) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(search("a", signal())).resolves.toEqual([]);
  });

  it.each(ADAPTERS)("%s: non-ok throws with { strict: true }", async (_n, search) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 503 }));
    await expect(search("a", signal(), { strict: true })).rejects.toThrow(/HTTP 503/);
  });

  it.each(ADAPTERS)("%s: a 200 with strict does not throw", async (_n, search) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(search("a", signal(), { strict: true })).resolves.toEqual([]);
  });
});

describe("warehouse adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  const body = { data: [{ id: "w1", name: "Central Store", code: "CS-1" }, { id: "w2", name: "Depot North", code: "DN" }] };

  it("filters name/code client-side from the tenant-scoped list", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const out = await searchWarehouses("depot", signal());
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/inventory/warehouses?limit=200");
    expect(out).toEqual([{ id: "w2", label: "Depot North", sublabel: "DN" }]);
  });

  it("resolves ids to labels and short-circuits on []", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await resolveWarehouses(["w1"])).toEqual([{ id: "w1", label: "Central Store", sublabel: "CS-1" }]);
    spy.mockClear();
    expect(await resolveWarehouses([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
