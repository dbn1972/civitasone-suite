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
});
