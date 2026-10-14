/**
 * Wave 2 tenant-admin loader contracts (GAP-TENANT-ADMIN-SETTINGS-01 / PLANS-06 /
 * AUDIT-04 / COMPLIANCE-02): the loaders validate the RAW body, so each must
 * accept exactly what the service really sends and reject what it does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));

import { getTenantModules, getPlansData, getTenantAuditSummary, getComplianceOverview } from "./loaders";

function respond(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body), clone() { return respond(body); } } as unknown as Response;
}
function serve(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(body)));
}

describe("tenant-admin loaders (W2)", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("getTenantModules asks for ?detail=1 and accepts admin-service's {data:[...]} envelope with disabled rows", async () => {
    serve({ data: [
      { name: "hrms", moduleKey: "hrms", moduleName: "Hrms", enabled: true, enabledAt: "2026-01-01T00:00:00.000Z" },
      { name: "payroll", moduleKey: "payroll", moduleName: "Payroll", enabled: false },
    ] });
    const res = await getTenantModules();
    expect(res.source).toBe("api");
    expect(res.data.map((m) => [m.moduleKey, m.enabled])).toEqual([["hrms", true], ["payroll", false]]);
    const url = String((vi.mocked(fetch).mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/api/v1/admin/tenant/modules?detail=1");
  });

  it("getPlansData turns billing-service's bare plan array into an error state instead of a crashing cast", async () => {
    serve([{ id: "p1", name: "Govt", code: "govt", priceMinor: "999900", currency: "INR", govtExempt: true, active: true }]);
    const res = await getPlansData();
    expect(res.source).toBe("error");
    expect(res.data.plans).toEqual([]);
  });

  it("getPlansData accepts the {plans, currentPlanId, invoices, trialDaysLeft} shape", async () => {
    serve({ plans: [{ id: "p1", name: "Govt", pricePerMonth: 999900, maxUsers: 10, storageGb: 5, maxApiCalls: 100, modules: ["hrms"] }], currentPlanId: "p1", invoices: [], trialDaysLeft: null });
    const res = await getPlansData();
    expect(res.source).toBe("api");
    expect(res.data.plans).toHaveLength(1);
  });

  it("getTenantAuditSummary reads the server totals and rejects a malformed body", async () => {
    serve({ total: 500, success: 460, failures: 40, last24h: 3, asOf: "2026-10-14T00:00:00.000Z" });
    const ok = await getTenantAuditSummary();
    expect(ok.source).toBe("api");
    expect(ok.data).toMatchObject({ total: 500, failures: 40 });
    serve({ total: "many" });
    expect((await getTenantAuditSummary()).source).toBe("error");
  });

  it("getComplianceOverview treats a malformed body ({}) as an error state, not 'undefined%' (COMPLIANCE-03)", async () => {
    serve({});
    const res = await getComplianceOverview();
    expect(res.source).toBe("error");
    expect(res.data.dpdpScore).toBeNull();
  });

  it("getComplianceOverview keeps a genuine 0 score as 0, not null (COMPLIANCE-03)", async () => {
    serve({ dpdpScore: 0, certInReadiness: 55, retentionStatus: "Compliant", checks: [] });
    const res = await getComplianceOverview();
    expect(res.source).toBe("api");
    expect(res.data.dpdpScore).toBe(0);
  });

  it("getComplianceOverview keeps provenance and per-check evidenceCount, and a null score stays null", async () => {
    serve({
      dpdpScore: null, certInReadiness: null, retentionStatus: "Not configured",
      checks: [{ id: "c1", timestamp: "2026-02-01T10:00:00Z", title: "T", result: "pass", evidenceCount: 3 }],
      provenance: { method: "m", scope: "tenant:x", asOf: null, complete: false },
    });
    const res = await getComplianceOverview();
    expect(res.source).toBe("api");
    expect(res.data.dpdpScore).toBeNull();
    expect(res.data.checks[0]).toMatchObject({ evidenceCount: 3 });
    expect(res.data.provenance).toMatchObject({ scope: "tenant:x", asOf: null });
  });
});
