import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadMaps, loadOperatorRoster, __resetOfficerMapsCacheForTest } from "./OfficerName";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("operator roster read is shared (UX-R5 perf, S-14)", () => {
  beforeEach(() => __resetOfficerMapsCacheForTest());
  afterEach(() => vi.restoreAllMocks());

  it("the forward picker and the name maps loading together make ONE roster request, not two in series", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      json({ data: [{ employeeId: "00000000-0000-4000-8000-000000000001", division: "Admin", deskRole: "section_officer", employeeName: "Asha Rao", active: true }] }));
    const [roster, maps] = await Promise.all([loadOperatorRoster(), loadMaps()]);
    const rosterCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/v1/estab/operators"));
    expect(rosterCalls).toHaveLength(1);
    expect(roster).toHaveLength(1);
    expect(maps.names.get("00000000-0000-4000-8000-000000000001")).toBe("Asha Rao");
  });

  it("a failed roster read is not remembered: the next mount asks again", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(json({ data: [] }));
    expect(await loadOperatorRoster()).toBeNull();
    expect(await loadOperatorRoster()).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
