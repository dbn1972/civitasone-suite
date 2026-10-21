import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchEmployees, resolveEmployees, MANAGER_INELIGIBLE_STATUSES } from "./employee";

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

  // GAP-HR-EMPLOYEES-NEW-04: a name alone cannot tell two people apart.
  it("puts the designation ahead of the department in the second line when the API returns one", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", designation: "Under Secretary" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await searchEmployees("Asha", new AbortController().signal);
    expect(result).toEqual([{ id: "e1", label: "Asha Rao (EMP001)", sublabel: "Under Secretary · Finance" }]);
  });

  it("shows the designation alone when there is no department, and no second line when there is neither", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "e1", name: "A", designation: "Director" }, { id: "e2", name: "B" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await searchEmployees("x", new AbortController().signal);
    expect(result).toEqual([{ id: "e1", label: "A", sublabel: "Director" }, { id: "e2", label: "B", sublabel: undefined }]);
  });

  it("MANAGER_INELIGIBLE_STATUSES is exactly the permanent-exit set (on_leave / suspended stay pickable)", () => {
    expect([...MANAGER_INELIGIBLE_STATUSES].sort()).toEqual(["retired", "separated", "terminated"]);
  });

  it("searchEmployees returns an empty list on a non-ok response rather than throwing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const result = await searchEmployees("x", new AbortController().signal);
    expect(result).toEqual([]);
  });

  // GAP-HR-EMPLOYEES-DETAIL-EDIT-05
  describe("excludeStatuses", () => {
    const ROWS = [
      { id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", status: "confirmed" },
      { id: "e2", employeeNo: "EMP002", name: "Vikram Singh", department: "Finance", status: "separated" },
      { id: "e3", employeeNo: "EMP003", name: "Priya Nair", department: "Finance", status: "retired" },
      { id: "e4", employeeNo: "EMP004", name: "Ravi Kumar", department: "Finance", status: "terminated" },
      { id: "e5", employeeNo: "EMP005", name: "Deepa Iyer", department: "Finance", status: "on_leave" },
    ];

    beforeEach(() => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ data: ROWS }), { status: 200, headers: { "content-type": "application/json" } }),
      );
    });

    it("drops rows whose status is in excludeStatuses, keeping everyone else", async () => {
      const result = await searchEmployees("a", new AbortController().signal, {
        excludeStatuses: ["terminated", "separated", "retired"],
      });
      expect(result.map((o) => o.id)).toEqual(["e1", "e5"]);
    });

    it("keeps on_leave/suspended (not in the exclude list) -- still legitimate manager picks", async () => {
      const result = await searchEmployees("a", new AbortController().signal, {
        excludeStatuses: ["terminated", "separated", "retired"],
      });
      expect(result.some((o) => o.id === "e5")).toBe(true);
    });

    it("without opts, behaves exactly as before (no filtering)", async () => {
      const result = await searchEmployees("a", new AbortController().signal);
      expect(result).toHaveLength(ROWS.length);
    });

    it("keeps a row with no status field at all rather than excluding it", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "e9", name: "No Status Row" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const result = await searchEmployees("a", new AbortController().signal, { excludeStatuses: ["separated"] });
      expect(result.map((o) => o.id)).toEqual(["e9"]);
    });
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

describe("searchEmployees onForbidden (GAP-PAYROLL-FNF-05 review)", () => {
  it("calls onForbidden on a 403 and still returns []", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;
    const onForbidden = vi.fn();
    try {
      await expect(searchEmployees("ab", new AbortController().signal, { onForbidden })).resolves.toEqual([]);
      expect(onForbidden).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not call onForbidden on other failures", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
    const onForbidden = vi.fn();
    try {
      await searchEmployees("ab", new AbortController().signal, { onForbidden });
      expect(onForbidden).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
