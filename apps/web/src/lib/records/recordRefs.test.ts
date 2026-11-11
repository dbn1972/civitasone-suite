import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchJson = vi.fn();
const resolveUsers = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJson(...a) }));
vi.mock("@/lib/directory/resolveUsers", () => ({ resolveUsers: (...a: unknown[]) => resolveUsers(...a) }));

import { mergePeople, resolveRecordRefs, toNameEntries, toOfficerEntries } from "./recordRefs";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  fetchJson.mockReset();
  resolveUsers.mockReset();
});

describe("recordRefs: the shared people / record-reference resolver (UX-R5)", () => {
  it("maps endpoint payloads, dropping rows without a usable name", () => {
    expect(toOfficerEntries({ data: [{ id: "a", name: " Asha Rao ", designation: "Section Officer" }, { id: "b", name: "" }, { name: "x" }] }))
      .toEqual([["a", { name: "Asha Rao", designation: "Section Officer" }]]);
    expect(toOfficerEntries({ data: [{ id: "a", name: "Asha", designation: null }] })).toEqual([["a", { name: "Asha", designation: null }]]);
    expect(toNameEntries({ data: [{ id: "v", name: "Dell India" }, { id: "w" }] })).toEqual([["v", "Dell India"]]);
    expect(toNameEntries("garbage")).toBeNull();
  });

  it("an officer entry (with designation) wins over a directory-only name", () => {
    const merged = mergePeople(new Map([["a", { name: "Asha Rao", designation: "SO" }]]), new Map([["a", "asha"], ["b", "Bimal Das"]]));
    expect(merged.get("a")).toEqual({ name: "Asha Rao", designation: "SO" });
    expect(merged.get("b")).toEqual({ name: "Bimal Das", designation: null });
  });

  it("one parallel batched pass: officers + directory + vendors, non-UUIDs and duplicates dropped", async () => {
    fetchJson.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/hrms/employees/officers")) return { data: [[uid(1), { name: "Asha Rao", designation: "Section Officer" }]], source: "api" };
      if (path.startsWith("/v1/procurement/vendors/names")) return { data: [[uid(9), "Dell India"]], source: "api" };
      return { data: [], source: "error" };
    });
    resolveUsers.mockResolvedValue(new Map([[uid(2), "N. Gupta"]]));

    const refs = await resolveRecordRefs({ people: [uid(1), uid(1), uid(2), "not-an-id", null], vendors: [uid(9), undefined] });

    expect(refs.people.get(uid(1))).toEqual({ name: "Asha Rao", designation: "Section Officer" });
    expect(refs.people.get(uid(2))).toEqual({ name: "N. Gupta", designation: null });
    expect(refs.vendors.get(uid(9))).toBe("Dell India");
    const paths = fetchJson.mock.calls.map((c) => c[0] as string);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(`/v1/hrms/employees/officers?ids=${uid(1)},${uid(2)}`);
    expect(resolveUsers).toHaveBeenCalledWith([uid(1), uid(2)]);
    // Cached across renders (Next fetch data cache) and memoised within one.
    for (const c of fetchJson.mock.calls) expect((c[2] as { revalidateSeconds?: number }).revalidateSeconds).toBeGreaterThan(0);
  });

  it("batches at 100 ids per request, never one per row", async () => {
    fetchJson.mockResolvedValue({ data: [], source: "api" });
    resolveUsers.mockResolvedValue(new Map());
    await resolveRecordRefs({ people: Array.from({ length: 250 }, (_, i) => uid(i + 1)) });
    const officerCalls = fetchJson.mock.calls.filter((c) => String(c[0]).startsWith("/v1/hrms/employees/officers"));
    expect(officerCalls).toHaveLength(3);
  });

  it("makes no request when there is nothing to resolve", async () => {
    const refs = await resolveRecordRefs({ people: [null, "x"], vendors: [] });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(resolveUsers).not.toHaveBeenCalled();
    expect(refs.people.size).toBe(0);
  });

  it("fails soft: a failed lookup leaves ids out, never throws", async () => {
    fetchJson.mockRejectedValue(new Error("down"));
    resolveUsers.mockRejectedValue(new Error("down"));
    const refs = await resolveRecordRefs({ people: [uid(1)], vendors: [uid(2)] });
    expect(refs.people.size).toBe(0);
    expect(refs.vendors.size).toBe(0);
  });
});
