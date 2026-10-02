import { describe, it, expect, vi, afterEach } from "vitest";
import { assetToOption, searchAssets, resolveAssets } from "./asset";

// GAP-ASSETS-INSURANCE-03
describe("asset entity adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("labels with code · name, reading assetCode before code, and never a UUID", () => {
    expect(assetToOption({ id: "a1", assetCode: "AST-9", code: "old", name: "Server Rack" })).toEqual({ id: "a1", label: "AST-9 · Server Rack" });
    expect(assetToOption({ id: "a2", code: "AST-2", name: "" })).toEqual({ id: "a2", label: "AST-2" });
    expect(assetToOption({ id: "a3" })?.label).toBe("Unnamed asset");
    expect(assetToOption({ name: "no id" })).toBeNull();
  });

  it("searches the server by name/code so an asset beyond the first 200 is found", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "a250", code: "AST-250", name: "Generator 250" }] }), { status: 200 }),
    );
    const out = await searchAssets("Generator 25", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/assets/assets?search=Generator%2025&limit=20");
    expect(out).toEqual([{ id: "a250", label: "AST-250 · Generator 250" }]);
  });

  it("throws on a failed search so the picker does not show a false 'no match'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }));
    await expect(searchAssets("x", new AbortController().signal)).rejects.toThrow();
  });

  it("resolves ids to labels via the detail endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1", code: "AST-1", name: "Laptop" }), { status: 200 }));
    expect(await resolveAssets(["a1"])).toEqual([{ id: "a1", label: "AST-1 · Laptop" }]);
  });
});
