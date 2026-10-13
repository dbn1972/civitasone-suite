import { describe, it, expect, vi, beforeEach } from "vitest";

// SF-03 regression (citizen group): empty grievance list is [] (empty state),
// null is reserved for an unparseable payload.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { getGrievances } from "./_data";

describe("getGrievances mapper (SF-03)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  async function mapper() {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await getGrievances();
    return (fetchJsonMock.mock.calls[0]![2] as { mapResponse: (p: unknown) => unknown }).mapResponse;
  }

  it("maps an empty list to [] rather than null", async () => {
    const map = await mapper();
    expect(map([])).toEqual([]);
    expect(map({ data: [] })).toEqual([]);
  });

  it("returns null for a non-list payload", async () => {
    const map = await mapper();
    expect(map("nope")).toBeNull();
  });
});
