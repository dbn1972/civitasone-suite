/**
 * CLOS3-S5-08: fetchInspectorLeave must call hrms-service's real internal leave-periods
 * route with service credentials (it used to GET a non-existent /v1/hrms/leave, unauthenticated).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchInspectorLeave } from "../src/modules/assignment/consumer.js";

const TENANT = "1a000000-dead-4000-8000-000000000508";
const SECRET = globalThis.crypto.randomUUID();
const INSPECTOR = "1a000000-dead-4000-8000-0000000005aa";

describe("fetchInspectorLeave", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.HRMS_SERVICE_URL = "http://hrms.test";
    process.env.INTERNAL_SERVICE_SECRET = SECRET;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("calls the internal leave-periods route with x-internal credentials and tenant", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ startDate: "2026-11-10", endDate: "2026-11-12" }]), { status: 200 }));
    const out = await fetchInspectorLeave(TENANT, INSPECTOR, "2026-11-01", "2026-11-30");
    expect(out).toEqual([{ startDate: "2026-11-10", endDate: "2026-11-12" }]);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    const u = new URL(String(calledUrl));
    expect(u.pathname).toBe("/v1/hrms/internal/leave-periods");
    expect(u.searchParams.get("employeeId")).toBe(INSPECTOR);
    expect(u.searchParams.get("startDate")).toBe("2026-11-01");
    expect(u.searchParams.get("endDate")).toBe("2026-11-30");
    expect(init.headers).toMatchObject({ "x-internal": "1", "x-service-secret": SECRET, "x-tenant-id": TENANT });
  });

  it("still accepts a {data:[...]} envelope", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ startDate: "2026-11-02", endDate: "2026-11-03" }] }), { status: 200 }));
    expect(await fetchInspectorLeave(TENANT, INSPECTOR, "2026-11-01", "2026-11-30")).toEqual([{ startDate: "2026-11-02", endDate: "2026-11-03" }]);
  });

  it("without a configured secret it does not call HRMS and yields no leave data", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(await fetchInspectorLeave(TENANT, INSPECTOR, "2026-11-01", "2026-11-30")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
