import { describe, it, expect, vi } from "vitest";

// getGrantSchemes calls fetchJson, which needs a gateway base URL + auth cookie.
// We stub apiClient.fetchJson so these tests exercise OUR mapper via the public
// loader, feeding it raw payloads through the captured mapResponse.
let capturedMap: ((payload: unknown) => unknown) | null = null;
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (_path: string, empty: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    capturedMap = opts.mapResponse;
    return Promise.resolve({ data: empty, source: "error" });
  },
}));

import { getGrantSchemes } from "./_data";

async function mapPayload(payload: unknown) {
  await getGrantSchemes(); // captures the mapper
  if (!capturedMap) throw new Error("mapper not captured");
  return capturedMap(payload) as
    | Array<{ status: string; applicationCount: number | null }>
    | null;
}

describe("mapGrantSchemeSummaries (GAP-GRANTS-SCHEMES-04/05)", () => {
  it("drops rows missing id/code/name and keeps the valid ones", async () => {
    const rows = await mapPayload([
      { id: "a", code: "C1", name: "Scheme One", status: "open" },
      { id: "b", code: "C2" }, // missing name -> dropped
      { id: "c", code: "C3", name: "Scheme Three", status: "closed" },
    ]);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
  });

  it("does NOT relabel an unknown status as 'draft'", async () => {
    const rows = await mapPayload([
      { id: "a", code: "C1", name: "Scheme One", status: "suspended" },
    ]);
    expect(rows?.[0]?.status).toBe("unknown");
  });

  it("returns null (=> error state) when rows were received but all invalid", async () => {
    const rows = await mapPayload([{ id: "", code: "", name: "" }, { foo: 1 }]);
    expect(rows).toBeNull();
  });

  it("applicationCount is null when absent, 0 when the API sends 0", async () => {
    const rows = await mapPayload([
      { id: "a", code: "C1", name: "No count", status: "open" },
      { id: "b", code: "C2", name: "Zero count", status: "open", applicationCount: 0 },
    ]);
    expect(rows?.[0]?.applicationCount).toBeNull();
    expect(rows?.[1]?.applicationCount).toBe(0);
  });

  it("does not use projectCount as an application count", async () => {
    const rows = await mapPayload([
      { id: "a", code: "C1", name: "Has projects", status: "open", projectCount: 9 },
    ]);
    expect(rows?.[0]?.applicationCount).toBeNull();
  });
});
