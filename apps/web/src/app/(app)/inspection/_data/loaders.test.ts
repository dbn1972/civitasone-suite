import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

describe("inspection loaders", () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("calls inspections list endpoint", async () => {
    fetchJson.mockResolvedValue({ data: [{ id: "1" }], source: "api" });
    const { getInspections } = await import("./loaders");
    const res = await getInspections();
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/v1/inspection/inspections?pageSize=50",
      [],
      expect.objectContaining({ telemetryKey: "inspection.list" }),
    );
    expect(res.data).toHaveLength(1);
  });

  it("propagates error source from fetchJson", async () => {
    fetchJson.mockResolvedValue({ data: [], source: "error" });
    const { getInspections } = await import("./loaders");
    const res = await getInspections();
    expect(res.source).toBe("error");
  });

  // GAP-INSPECTION-INSPECTIONS-05: the paginated loader forwards the requested
  // page (and a fixed pageSize) to the list endpoint and maps the envelope to
  // { rows, total } via mapResponse.
  it("getInspectionsPage forwards page + pageSize and maps rows/total", async () => {
    fetchJson.mockImplementation((_url, _fallback, opts: { mapResponse: (p: unknown) => unknown }) => {
      const mapped = opts.mapResponse({ data: [{ id: "a" }, { id: "b" }], meta: { page: 2, pageSize: 20, total: 137 } });
      return Promise.resolve({ data: mapped, source: "api" });
    });
    const { getInspectionsPage, INSPECTIONS_PAGE_SIZE } = await import("./loaders");
    const res = await getInspectionsPage(2);
    expect(String(fetchJson.mock.calls[0]![0])).toContain(`page=2&pageSize=${INSPECTIONS_PAGE_SIZE}`);
    expect(res.data).toEqual({ rows: [{ id: "a" }, { id: "b" }], total: 137 });
  });

  it("getInspectionsPage clamps a non-positive page to 1", async () => {
    fetchJson.mockResolvedValue({ data: { rows: [], total: null }, source: "api" });
    const { getInspectionsPage } = await import("./loaders");
    await getInspectionsPage(0);
    expect(String(fetchJson.mock.calls[0]![0])).toContain("page=1&");
  });

  // GAP-INSPECTION-HOME-02: a payload without meta.total yields total=null so
  // the caller can fall back to an "N+" display instead of a wrong exact count.
  it("getInspectionsPage reports total=null when the envelope omits meta.total", async () => {
    fetchJson.mockImplementation((_url, _fallback, opts: { mapResponse: (p: unknown) => unknown }) => {
      const mapped = opts.mapResponse([{ id: "a" }]); // bare array, no meta
      return Promise.resolve({ data: mapped, source: "api" });
    });
    const { getInspectionsPage } = await import("./loaders");
    const res = await getInspectionsPage(1);
    expect(res.data).toEqual({ rows: [{ id: "a" }], total: null });
  });
});
