import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  activateDomainPackStage3,
  fetchDomainPacksForInstall,
  fetchDomainPacksForInstallResult,
  mergeDomainPackCatalog,
} from "./domainPackApi";

describe("mergeDomainPackCatalog", () => {
  it("always includes municipal-in-v1 even when API is empty", () => {
    const merged = mergeDomainPackCatalog([]);
    expect(merged.some((p) => p.domainPackKey === "municipal-in-v1")).toBe(true);
    expect(merged[0]?.outcomes.map((o) => o.shortLabel)).toEqual(["TL", "PGR", "Water"]);
  });

  it("merges API rows and keeps municipal outcomes", () => {
    const merged = mergeDomainPackCatalog([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        domainPackKey: "municipal-in-v1",
        name: "Municipal IN v1",
        sector: "municipal",
        jurisdiction: "IN",
        version: 2,
        packKeys: ["pack:trade-license", "pack:pgr", "pack:water-connection"],
      },
    ]);
    const municipal = merged.find((p) => p.domainPackKey === "municipal-in-v1")!;
    expect(municipal.fromApi).toBe(true);
    expect(municipal.version).toBe(2);
    expect(municipal.outcomes.map((o) => o.shortLabel)).toEqual(["TL", "PGR", "Water"]);
  });

  // GAP-INSTALL-DOMAIN-PACKS-03: the API's packKeys drive the outcome list.
  it("derives outcomes from API packKeys, labelling unknown keys with a fallback", () => {
    const merged = mergeDomainPackCatalog([
      {
        domainPackKey: "municipal-in-v1",
        name: "Municipal IN v1",
        packKeys: ["pack:trade-license", "pack:pgr", "pack:water-connection", "pack:birth-cert"],
      },
    ]);
    const municipal = merged.find((p) => p.domainPackKey === "municipal-in-v1")!;
    expect(municipal.outcomes).toHaveLength(4);
    expect(municipal.outcomes.map((o) => o.packKey)).toContain("pack:birth-cert");
    const fallback = municipal.outcomes.find((o) => o.packKey === "pack:birth-cert")!;
    expect(fallback.label).toBe("birth-cert");
  });
});

describe("domainPackApi HTTP", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchDomainPacksForInstall falls back to catalogue on error", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const packs = await fetchDomainPacksForInstall();
    expect(packs.some((p) => p.domainPackKey === "municipal-in-v1")).toBe(true);
  });

  // GAP-INSTALL-DOMAIN-PACKS-02 / HOME-07: a failed fetch is reported as error,
  // not silently masked as a healthy single-pack library.
  it("fetchDomainPacksForInstallResult reports error:true on a failed fetch", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    const { packs, error } = await fetchDomainPacksForInstallResult();
    expect(error).toBe(true);
    expect(packs.some((p) => p.domainPackKey === "municipal-in-v1")).toBe(true);
  });

  it("fetchDomainPacksForInstallResult reports error:false on a healthy empty list", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);
    const { error } = await fetchDomainPacksForInstallResult();
    expect(error).toBe(false);
  });

  it("activateDomainPackStage3 POSTs Stage 3 endpoint and parses 202", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 202,
      json: async () => ({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        status: "accepted",
        correlationId: "corr-1",
        domainPackKey: "municipal-in-v1",
        stageNumber: 3,
        packKeys: ["pack:trade-license", "pack:pgr", "pack:water-connection"],
      }),
    } as Response);

    const result = await activateDomainPackStage3("municipal-in-v1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/install/stages/3/domain-pack/activate",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.stageNumber).toBe(3);
    expect(result.packKeys).toHaveLength(3);
  });

  it("activateDomainPackStage3 surfaces a clerk-safe message, never the raw API error text (UX-016)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: "forbidden for tenant" }),
    } as Response);

    await expect(activateDomainPackStage3("municipal-in-v1")).rejects.toThrow(/couldn't save/i);
    let caught: unknown;
    try {
      await activateDomainPackStage3("municipal-in-v1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(/forbidden for tenant/i);
  });
});
