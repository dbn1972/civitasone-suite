import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCrmAccounts, resolveCrmAccounts } from "./crmAccount";

// GAP-CRM-ACCOUNTS-DETAIL-01: account pickers ask the SERVER for matches, so they work
// for a tenant with more accounts than the capped list endpoint returns.
describe("crmAccount entity adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  const list = (data: unknown[]) => new Response(JSON.stringify({ data }), { status: 200 });

  it("queries the accounts endpoint with search, a small limit and the subtree exclusion", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      list([{ id: "a1", name: "Ministry of Power", industry: "Energy" }]),
    );
    const out = await searchCrmAccounts(" power ", new AbortController().signal, { excludeSubtreeOf: "me-1" });
    const url = new URL(String(spy.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toBe("/api/proxy/v1/crm/accounts");
    expect(url.searchParams.get("search")).toBe("power");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("excludeSubtreeOf")).toBe("me-1");
    expect(out).toEqual([{ id: "a1", label: "Ministry of Power", sublabel: "Energy" }]);
  });

  it("omits search/exclusion params when not given and drops hidden ids", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      list([{ id: "me", name: "Me Org" }, { id: "a2", name: "Other Org" }]),
    );
    const out = await searchCrmAccounts("", new AbortController().signal, { excludeIds: ["me"] });
    const url = new URL(String(spy.mock.calls[0]![0]), "http://x");
    expect(url.searchParams.has("search")).toBe(false);
    expect(url.searchParams.has("excludeSubtreeOf")).toBe(false);
    expect(out.map((o) => o.id)).toEqual(["a2"]);
  });

  it("never labels an account with its id: nameless rows are dropped", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(list([{ id: "a1", name: "  " }, { id: "a2", name: null }, { id: "a3", name: "Real" }]));
    expect((await searchCrmAccounts("x", new AbortController().signal)).map((o) => o.label)).toEqual(["Real"]);
  });

  it("degrades to [] on a failed fetch, or throws when strict so the picker can show an alert", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(searchCrmAccounts("x", new AbortController().signal)).resolves.toEqual([]);
    await expect(searchCrmAccounts("x", new AbortController().signal, { strict: true })).rejects.toThrow();
  });

  it("resolves ids to labelled options through the by-id endpoint, skipping ones it cannot find", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/a1")) return new Response(JSON.stringify({ data: { id: "a1", name: "Found Org" } }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    expect(await resolveCrmAccounts(["a1", "gone"])).toEqual([{ id: "a1", label: "Found Org" }]);
    expect(spy.mock.calls.map((c) => String(c[0]))).toContain("/api/proxy/v1/crm/accounts/a1");
  });

  it("resolve([]) makes no request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await resolveCrmAccounts([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
