import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  activateDomainPackStage3,
  fetchDomainPacksForInstall,
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

  it("activateDomainPackStage3 surfaces API error message", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: "forbidden for tenant" }),
    } as Response);

    await expect(activateDomainPackStage3("municipal-in-v1")).rejects.toThrow(/forbidden for tenant/i);
  });
});
