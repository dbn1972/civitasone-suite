import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJsonMock = vi.fn();
vi.mock("./apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apiClient")>()),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { getEstabDashboard } from "./loaders";

// The loader's mapResponse is applied by fetchJson; emulate that so the field mapping is what is tested.
function serve(payload: unknown) {
  fetchJsonMock.mockImplementation(async (_path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
    data: opts.mapResponse(payload),
    source: "api",
  }));
}

const REST = { meetingsToday: 1, vehiclesInUse: 2, complianceItemsDue: 3, slaBreached: 4, dakPending: 5, avgPendencyDays: 6 };

// GAP-ESTAB-DASHBOARD-02: the count of status=active files is `filesActive`; `filesPending` is only the old alias.
describe("getEstabDashboard field names", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("reads filesActive", async () => {
    serve({ filesActive: 9, filesPending: 9, ...REST });
    const { data } = await getEstabDashboard();
    expect(data.filesActive).toBe(9);
  });

  it("falls back to the deprecated filesPending alias from a service that does not send filesActive yet", async () => {
    serve({ filesPending: 4, ...REST });
    const { data } = await getEstabDashboard();
    expect(data.filesActive).toBe(4);
  });

  it("prefers filesActive over the alias when both are present", async () => {
    serve({ filesActive: 3, filesPending: 99, ...REST });
    expect((await getEstabDashboard()).data.filesActive).toBe(3);
  });

  it("reads 0 when neither is a number", async () => {
    serve({ filesActive: "x", ...REST });
    expect((await getEstabDashboard()).data.filesActive).toBe(0);
  });

  it("maps the other counts unchanged", async () => {
    serve({ filesActive: 1, ...REST });
    expect((await getEstabDashboard()).data).toMatchObject(REST);
  });
});
