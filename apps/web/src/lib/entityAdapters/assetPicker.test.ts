import { describe, it, expect, vi, afterEach } from "vitest";
import { assetOptionLabel, resolveAssets, searchAssets } from "./assetPicker";

afterEach(() => vi.restoreAllMocks());

describe("assetOptionLabel (GAP-ASSETS-MAINTENANCE-NEW-05)", () => {
  it("uses code and name, accepting assetCode as well", () => {
    expect(assetOptionLabel({ id: "x", code: "DG-1", name: "Generator" })).toBe("DG-1 · Generator");
    expect(assetOptionLabel({ id: "x", assetCode: "DG-2" })).toBe("DG-2");
  });
  it("never shows a raw UUID", () => {
    const id = "11111111-2222-3333-4444-555555a1b2c3";
    const label = assetOptionLabel({ id });
    expect(label).toBe("Unnamed asset (ref a1b2c3)");
    expect(label).not.toContain(id);
  });
});

describe("searchAssets (GAP-ASSETS-MAINTENANCE-NEW-01/-02)", () => {
  it("queries the server-side search with the typed text", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "a300", code: "AST-300", name: "Pump 300" }] }), { status: 200 }));
    const out = await searchAssets("pump 3", new AbortController().signal);
    expect(String(spy.mock.calls[0]?.[0])).toContain("search=pump%203");
    expect(out).toEqual([{ id: "a300", label: "AST-300 · Pump 300" }]);
  });
  it("reports the HTTP status on failure instead of silently returning nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    const onError = vi.fn();
    expect(await searchAssets("x", new AbortController().signal, { onError })).toEqual([]);
    expect(onError).toHaveBeenCalledWith(403);
  });
  it("resolves a deep-linked id to a label", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1", code: "C1", name: "N1" }), { status: 200 }));
    expect(await resolveAssets(["a1"])).toEqual([{ id: "a1", label: "C1 · N1" }]);
  });
});
