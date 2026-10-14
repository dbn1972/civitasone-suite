import { describe, it, expect, vi } from "vitest";

const captured = vi.hoisted(() => ({ map: null as ((p: unknown) => unknown) | null }));
vi.mock("../../_data/apiClient", () => ({
  fetchJson: async (_path: string, empty: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    captured.map = opts.mapResponse;
    return { data: empty, source: "api" };
  },
}));

const { getAnalyticsCatalogLabels } = await import("./_data");
const { humanizeKey } = await import("./catalog-labels");

// GAP-ANALYTICS-QUERIES-04 (W2)
describe("analytics catalog labels", () => {
  it("humanizeKey turns registry keys into readable headers", () => {
    expect(humanizeKey("department_id")).toBe("Department");
    expect(humanizeKey("event_type")).toBe("Event type");
    expect(humanizeKey("source")).toBe("Source");
  });

  it("maps backend metric labels + units and dimension labels; unknown unit defaults to count", async () => {
    await getAnalyticsCatalogLabels();
    const out = captured.map!({
      metrics: [
        { key: "amount_sum", label: "Total amount", agg: "sum", unit: "paise" },
        { key: "event_count", label: "Event count", agg: "count", unit: "count" },
        { key: "weird", label: "Weird", unit: "furlongs" },
        { label: "no key" },
      ],
      dimensions: [{ key: "event_type", label: "Event type" }, { key: 3 }],
    });
    expect(out).toEqual({
      metrics: {
        amount_sum: { label: "Total amount", unit: "paise" },
        event_count: { label: "Event count", unit: "count" },
        weird: { label: "Weird", unit: "count" },
      },
      dimensions: { event_type: "Event type" },
    });
  });

  it("a malformed payload yields an empty lookup, never a throw", async () => {
    await getAnalyticsCatalogLabels();
    expect(captured.map!(null)).toEqual({ metrics: {}, dimensions: {} });
  });
});
