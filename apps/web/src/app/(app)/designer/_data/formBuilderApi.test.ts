import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadFormDesign, persistFormDesign } from "./formBuilderApi";

/**
 * UX-016: formBuilderApi.ts's parseJson used to throw the raw response body
 * text (or a `Request failed (${status})` fallback) on any failed
 * metadata-entity/field/layout call — the same class of leak useFormError
 * closes for components (UX-003). This module is a plain async data
 * client, not a component, so it can't use that hook; it now goes through
 * the same catalogued toHumanError vocabulary instead and never reads the
 * response body at all, so it structurally cannot leak it.
 */
describe("formBuilderApi — never leaks raw status or server text on failure", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loadFormDesign throws a clerk-safe message, never the raw HTTP status or server text", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "metadata-service unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const err = await loadFormDesign("trade-license", "Trade License").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b503\b/);
    expect(message).not.toContain("metadata-service unavailable");
    expect(message).toMatch(/couldn't save/i);
  });

  it("persistFormDesign throws the same clerk-safe message when an existing entity's fields can't be read", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const design = { entityId: "entity-1", sections: [], fields: {} };
    const err = await persistFormDesign(design, "trade-license", "Trade License").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });
});
