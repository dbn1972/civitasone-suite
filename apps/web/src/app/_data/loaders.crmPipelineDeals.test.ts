import { describe, it, expect, vi, beforeEach } from "vitest";

// GAP-CRM-PIPELINE-05 (W2 rescan): the pipeline board fetches a capped page of engagements, so
// the loader must (a) forward the chosen pipeline to the server, and (b) surface the server's
// pagination.total so the page can say "Showing N of M" instead of presenting the cap as whole.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { getPipelineDeals, PIPELINE_DEAL_LIMIT } from "./loaders";

type FetchOpts = { mapResponse: (p: unknown) => unknown };

/** fetchJson stand-in: runs the loader's real mapResponse over `payload`. */
function serve(payload: unknown, source: "api" | "error" = "api") {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation(async (_url: string, fallback: unknown, opts: FetchOpts) => {
    if (source === "error") return { data: fallback, source };
    return { data: opts.mapResponse(payload), source };
  });
}

const ROW = { id: "d1", name: "Engagement", stage: "Lead", valueMinor: "100", probability: 10, version: 1 };

describe("getPipelineDeals (GAP-CRM-PIPELINE-05)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("asks for the capped page unscoped when no pipeline is given", async () => {
    serve({ data: [ROW], pagination: { total: 1 } });
    await getPipelineDeals();
    const url = fetchJsonMock.mock.calls[0]![0] as string;
    expect(url).toBe(`/api/v1/crm/deals?limit=${PIPELINE_DEAL_LIMIT}`);
  });

  it("forwards the chosen pipeline id to the server", async () => {
    serve({ data: [ROW], pagination: { total: 1 } });
    await getPipelineDeals("0b3a9a4e-0000-4000-8000-00000000abcd");
    const url = fetchJsonMock.mock.calls[0]![0] as string;
    expect(url).toContain(`limit=${PIPELINE_DEAL_LIMIT}`);
    expect(url).toContain("pipelineId=0b3a9a4e-0000-4000-8000-00000000abcd");
  });

  it("surfaces pagination.total so the page can show 'Showing N of M'", async () => {
    serve({ data: [ROW], pagination: { total: 512 } });
    const res = await getPipelineDeals();
    expect(res.total).toBe(512);
    expect(res.data).toHaveLength(1);
  });

  it("reports total null when the backend sends none (page falls back to the full-page heuristic)", async () => {
    serve({ data: [ROW] });
    expect((await getPipelineDeals()).total).toBeNull();
  });

  it("never reports a total for a failed load", async () => {
    serve(null, "error");
    const res = await getPipelineDeals();
    expect(res.source).toBe("error");
    expect(res.total).toBeNull();
  });
});
