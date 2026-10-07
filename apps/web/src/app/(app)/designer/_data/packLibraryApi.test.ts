import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportServicePack, importServicePack } from "./packLibraryApi";

/**
 * UX-016: packLibraryApi.ts's parseAccepted used to throw the raw response
 * body text (falling back to `Import failed (${status})`) on a failed
 * export/import call — the same class of leak useFormError closes for
 * components (UX-003). This module is a plain async data client, not a
 * component, so it can't use that hook; it now goes through the same
 * catalogued toHumanError vocabulary instead and never reads the response
 * body at all, so it structurally cannot leak it.
 */
describe("packLibraryApi — never leaks raw status or server text on failure", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exportServicePack throws a clerk-safe message, never the raw HTTP status or server text", async () => {
    fetchMock.mockResolvedValue(new Response("pack-service circuit open", { status: 502 }));
    const err = await exportServicePack("def-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b502\b/);
    expect(message).not.toContain("pack-service circuit open");
    expect(message).toMatch(/couldn't save/i);
  });

  it("importServicePack throws the same clerk-safe message on failure", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await importServicePack("pack-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/\b500\b/);
  });
});

/**
 * GAP-DESIGNER-LIBRARY-01: fetchServicePacks used to swallow every non-OK
 * response as an empty list, so an outage or a 403 rendered the innocuous
 * "No packs match the current filters." empty state. It now throws a typed
 * ServicePackLoadError carrying the status, while the human copy stays
 * catalogued (never the raw status or server body).
 */
import { fetchServicePacks, ServicePackLoadError } from "./packLibraryApi";

describe("fetchServicePacks — surfaces failures instead of swallowing them", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("throws ServicePackLoadError on a 500 (not an empty array)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const err = await fetchServicePacks().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServicePackLoadError);
    expect((err as ServicePackLoadError).status).toBe(500);
    expect((err as Error).message).not.toMatch(/\b500\b/);
    expect((err as Error).message).toMatch(/couldn.t load/i);
  });

  it("uses the forbidden vocabulary on 403", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    const err = await fetchServicePacks().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServicePackLoadError);
    expect((err as ServicePackLoadError).status).toBe(403);
    expect((err as Error).message).toMatch(/permission/i);
  });

  it("returns a mapped list on success", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "p1", packKey: "k", name: "N", status: "draft" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const packs = await fetchServicePacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.id).toBe("p1");
  });
});
