import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { getChartOfAccounts } from "./loaders";

describe("getChartOfAccounts", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("requests the route maximum so the posting dropdowns are not truncated at 50 heads", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await getChartOfAccounts();
    expect(String(fetchJsonMock.mock.calls[0]![0])).toBe("/api/v1/finance/accounts?limit=500");
  });

  it("carries id and parentId through the mapper", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await getChartOfAccounts();
    const opts = fetchJsonMock.mock.calls[0]![2] as { mapResponse: (p: unknown) => unknown };
    const mapped = opts.mapResponse({
      data: [
        { id: "g", code: "2000", name: "Liab", type: "liability", status: "active" },
        { id: "c", parentId: "g", code: "2100", name: "Cr", type: "liability", status: "active" },
      ],
    }) as Array<{ id?: string; parentId?: string; code: string }>;
    expect(mapped[0]).toMatchObject({ id: "g", code: "2000" });
    expect(mapped[0]!.parentId).toBeUndefined();
    expect(mapped[1]).toMatchObject({ id: "c", parentId: "g" });
  });
});
