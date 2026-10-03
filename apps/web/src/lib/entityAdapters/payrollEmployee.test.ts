import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchPayrollEmployees, resolvePayrollEmployees } from "./payrollEmployee";

describe("entityAdapters/payrollEmployee (GAP-PAYROLL-LOANS-01)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("search hits the PAYROLL lookup (not the HR-only directory) and maps to {id,label,sublabel}", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance" }] }), { status: 200 }));
    const controller = new AbortController();
    const out = await searchPayrollEmployees("Asha", controller.signal);
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/payroll/employee-lookup?q=Asha&limit=20", expect.objectContaining({ signal: controller.signal }));
    expect(out).toEqual([{ id: "e1", label: "Asha Rao (EMP001)", sublabel: "Finance" }]);
  });

  it("a payroll_admin-only user is NOT told 'no results' for a 403: onForbidden fires", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    const onForbidden = vi.fn();
    expect(await searchPayrollEmployees("x", new AbortController().signal, { onForbidden })).toEqual([]);
    expect(onForbidden).toHaveBeenCalledTimes(1);
  });

  it("resolve passes ids, skips the network for none, and tolerates failure", async () => {
    expect(await resolvePayrollEmployees([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "e2", name: "Vikram Singh" }] }), { status: 200 }));
    expect(await resolvePayrollEmployees(["e2", "e3"])).toEqual([{ id: "e2", label: "Vikram Singh", sublabel: undefined }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/payroll/employee-lookup?ids=e2,e3");
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await resolvePayrollEmployees(["e2"])).toEqual([]);
  });
});
