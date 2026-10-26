import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  activateDomainPackStage3,
  fetchActivationStageStatus,
  fetchDomainPackActivationStatus,
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

  it("activateDomainPackStage3 returns the stageId that tracks the activation (GAP-INSTALL-DOMAIN-PACKS-01)", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        stageId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        status: "accepted",
        stageNumber: 3,
      }),
    } as Response);
    const result = await activateDomainPackStage3("municipal-in-v1");
    expect(result.stageId).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
  });

  describe("fetchActivationStageStatus", () => {
    const get = (status: number, body: unknown) =>
      vi.mocked(fetch).mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

    it("maps a completed stage to completed", async () => {
      get(200, { id: "s1", status: "completed", errorMessage: null });
      expect(await fetchActivationStageStatus("s1")).toEqual({ state: "completed" });
    });

    it("maps a failed stage to failed without leaking the raw server error text", async () => {
      get(200, { id: "s1", status: "failed", errorMessage: "pg: relation x does not exist" });
      const r = await fetchActivationStageStatus("s1");
      expect(r.state).toBe("failed");
      expect(JSON.stringify(r)).not.toMatch(/relation x/);
    });

    it("maps active/pending/in_progress to queued", async () => {
      for (const st of ["active", "pending", "in_progress"]) {
        get(200, { id: "s1", status: st });
        expect((await fetchActivationStageStatus("s1")).state).toBe("queued");
      }
    });

    it("treats 404 as not-yet-recorded (the stage row is written asynchronously)", async () => {
      get(404, {});
      expect((await fetchActivationStageStatus("s1")).state).toBe("queued");
    });

    it("reports unknown (not queued) when the status call itself fails", async () => {
      get(500, {});
      expect((await fetchActivationStageStatus("s1")).state).toBe("unknown");
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      expect((await fetchActivationStageStatus("s1")).state).toBe("unknown");
    });
  });

  // Owner decision #28: durable per-tenant activation record via GET .../domain-pack/status.
  describe("fetchDomainPackActivationStatus", () => {
    const get = (status: number, body: unknown) =>
      vi.mocked(fetch).mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
    const rec = (over: Record<string, unknown>) => ({
      activation: {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc", domainPackKey: "municipal-in-v1", packKeys: [],
        stageId: "dddddddd-dddd-dddd-dddd-dddddddddddd", status: "accepted", draftIds: [], failureReason: null,
        completedAt: null, createdAt: "2026-10-26T09:00:00.000Z", ...over,
      },
    });

    it("calls the status endpoint for the pack key", async () => {
      get(200, { activation: null });
      await fetchDomainPackActivationStatus("municipal-in-v1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/install/stages/3/domain-pack/status?domainPackKey=municipal-in-v1",
        expect.objectContaining({ cache: "no-store" }),
      );
    });

    it("a null activation is 'none' (never activated), not an error", async () => {
      get(200, { activation: null });
      expect(await fetchDomainPackActivationStatus("municipal-in-v1")).toEqual({ state: "none" });
    });

    it("maps accepted -> queued, completed -> completed with the draft count, failed -> failed", async () => {
      get(200, rec({ status: "accepted" }));
      expect(await fetchDomainPackActivationStatus("k")).toMatchObject({ state: "queued", activationId: "cccccccc-cccc-cccc-cccc-cccccccccccc" });
      get(200, rec({ status: "completed", draftIds: ["a", "b", "c"], completedAt: "2026-10-26T10:00:00.000Z" }));
      expect(await fetchDomainPackActivationStatus("k")).toMatchObject({ state: "completed", draftCount: 3, completedAt: "2026-10-26T10:00:00.000Z" });
      get(200, rec({ status: "failed", failureReason: "pg: boom" }));
      const failed = await fetchDomainPackActivationStatus("k");
      expect(failed.state).toBe("failed");
      expect(JSON.stringify(failed)).not.toMatch(/pg: boom/);
    });

    it("reports unknown (never a guessed state) on an HTTP error, a thrown fetch or a malformed body", async () => {
      get(500, {});
      expect((await fetchDomainPackActivationStatus("k")).state).toBe("unknown");
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      expect((await fetchDomainPackActivationStatus("k")).state).toBe("unknown");
      get(200, { activation: { status: "weird" } });
      expect((await fetchDomainPackActivationStatus("k")).state).toBe("unknown");
    });
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

  // CLOS-S2-03: an offline fetch / malformed 202 body must not leak raw exception text.
  it("CLOS-S2-03: activateDomainPackStage3 maps a network failure to connection copy", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    let caught: unknown;
    try {
      await activateDomainPackStage3("municipal-in-v1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/couldn't connect/i);
    expect((caught as Error).message).not.toMatch(/failed to fetch/i);
  });

  it("CLOS-S2-03: activateDomainPackStage3 hides the raw SyntaxError of a malformed 202 body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 202,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    } as unknown as Response);
    let caught: unknown;
    try {
      await activateDomainPackStage3("municipal-in-v1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(/unexpected token/i);
  });
});
