import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchEmployees, resolveEmployees } from "./employee";

describe("entityAdapters/employee", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searchEmployees calls the directory route with q/limit and the given AbortSignal, mapping to {id,label,sublabel}", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const controller = new AbortController();
    const result = await searchEmployees("Asha", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees?q=Asha&limit=20",
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(result).toEqual([{ id: "e1", label: "Asha Rao (EMP001)", sublabel: "Finance" }]);
  });

  it("searchEmployees returns an empty list on a non-ok response rather than throwing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const result = await searchEmployees("x", new AbortController().signal);
    expect(result).toEqual([]);
  });

  it("resolveEmployees batches ids into one comma-separated request", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "e1", name: "Asha Rao" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await resolveEmployees(["e1", "e2"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/employees?ids=e1,e2");
    expect(result).toEqual([{ id: "e1", label: "Asha Rao", sublabel: undefined }]);
  });

  it("resolveEmployees short-circuits to an empty list without calling fetch for an empty id list", async () => {
    const result = await resolveEmployees([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
