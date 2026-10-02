import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("./apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apiClient")>()),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { getAssetById } from "./loaders";

const BASE = { id: "a1", assetCode: "AST-1", name: "Laptop", depreciationSchedule: [], maintenanceHistory: [] };

function route(map: Record<string, { data: unknown; source: "api" | "error"; status?: number }>) {
  fetchJsonMock.mockImplementation(async (path: string, fallback: unknown) => {
    for (const [suffix, res] of Object.entries(map)) {
      if (path.endsWith(suffix)) return res;
    }
    return { data: fallback, source: "error" };
  });
}

// GAP-ASSETS-DETAIL-01: a failed sub-fetch must be visible, not silently [].
describe("getAssetById parts", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); });

  it("reports depreciation as error when /depreciation fails, with an empty schedule", async () => {
    route({
      "/assets/a1": { data: BASE, source: "api" },
      "/assets/a1/depreciation": { data: [], source: "error", status: 500 },
      "/assets/a1/maintenance": { data: [], source: "api" },
    });
    const res = await getAssetById("a1");
    expect(res.source).toBe("api");
    expect(res.parts).toEqual({ depreciation: "error", maintenance: "api" });
    expect(res.data?.depreciationSchedule).toEqual([]);
  });

  it("reports maintenance as error independently", async () => {
    route({
      "/assets/a1": { data: BASE, source: "api" },
      "/assets/a1/depreciation": { data: [], source: "api" },
      "/assets/a1/maintenance": { data: [], source: "error" },
    });
    const res = await getAssetById("a1");
    expect(res.parts).toEqual({ depreciation: "api", maintenance: "error" });
  });

  it("keeps the base 404 path unchanged (null data, no sub-fetches)", async () => {
    route({ "/assets/a1": { data: null, source: "error", status: 404 } });
    const res = await getAssetById("a1");
    expect(res.data).toBeNull();
    expect(res.status).toBe(404);
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });
});
