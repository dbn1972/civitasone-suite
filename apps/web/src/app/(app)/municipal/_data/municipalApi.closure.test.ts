import { describe, it, expect, vi } from "vitest";

// CLOS-S2-03-sibling (CLOS-S2-06 municipal site): a history row with no createdAt
// must keep an unknown timestamp (null), never "now".
let capturedMap: ((payload: unknown) => unknown) | null = null;
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (_path: string, empty: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    capturedMap = opts.mapResponse;
    return Promise.resolve({ data: empty, source: "error" });
  },
}));

import { fetchMunicipalHistory } from "./municipalApi";

describe("fetchMunicipalHistory mapper (CLOS-S2-06)", () => {
  it("does not fabricate createdAt for a row without one", async () => {
    await fetchMunicipalHistory(
      { workflow: { historyBasePath: "/api/v1/trade/applications" } } as never,
      "app-1",
    );
    const rows = capturedMap!({ data: [{ id: "h1", action: "approve", toStatus: "approved" }] }) as Array<{ createdAt: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toBeNull();
  });
});
