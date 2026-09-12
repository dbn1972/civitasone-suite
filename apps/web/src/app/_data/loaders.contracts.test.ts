import { describe, it, expect } from "vitest";
import { mapContractsListRows, mapCitizenPortalMetrics } from "./loaders";

// Real GET /v1/contract/contracts response shape, captured live from the
// running contract-service dev stack (see fix/contract-frontend-field-mapping
// PR description for the exact curl output this mirrors).
const REAL_ENVELOPE = {
  data: [
    {
      id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
      tenantId: "11111111-0000-0000-0000-000000000001",
      contractNo: "CON-VERIFY-0001",
      vendorId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      poRef: null,
      title: "Deep-verify probe contract",
      valueMinor: "123456789",
      currency: "INR",
      startDate: "2026-08-27",
      expiry: "2027-08-27",
      status: "draft",
      slaTerms: null,
    },
  ],
  pagination: { hasMore: false, pageSize: 50 },
};

describe("mapContractsListRows", () => {
  it("maps the real contract-service envelope shape (title as label, vendorId as sublabel, contractNo as meta)", () => {
    expect(mapContractsListRows(REAL_ENVELOPE)).toEqual([
      {
        id: "19c91840-1e19-406a-a51e-ecdc92f8edf6",
        label: "Deep-verify probe contract",
        sublabel: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        status: "draft",
        meta: "CON-VERIFY-0001",
      },
    ]);
  });

  it("returns an empty array (not null) for a tenant with zero contracts", () => {
    // Regression: a mapper that returns null for a successfully-parsed-but-
    // empty result gets treated by fetchJson as invalid_payload / source
    // "error" -- indistinguishable from a real fetch failure. A tenant with
    // no contracts yet is a normal, successful state and must render the
    // "no contracts" empty state, not an error/couldn't-load state.
    const result = mapContractsListRows({ data: [], pagination: { hasMore: false, pageSize: 50 } });
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("accepts a bare array payload (no envelope)", () => {
    expect(mapContractsListRows([REAL_ENVELOPE.data[0]])).toHaveLength(1);
  });

  it("accepts an { items: [...] } envelope via the shared getArrayPayload helper", () => {
    expect(mapContractsListRows({ items: [REAL_ENVELOPE.data[0]] })).toHaveLength(1);
  });

  it("skips rows missing both an id and a usable label, without throwing", () => {
    const result = mapContractsListRows({
      data: [
        { id: "missing-label" },
        { title: "missing-id" },
        REAL_ENVELOPE.data[0],
      ],
    });
    expect(result).toHaveLength(1);
    expect(result?.[0]?.id).toBe("19c91840-1e19-406a-a51e-ecdc92f8edf6");
  });

  it("falls back to contractNo as the label when title is absent", () => {
    const { title: _title, ...rest } = REAL_ENVELOPE.data[0];
    expect(mapContractsListRows({ data: [rest] })).toEqual([
      expect.objectContaining({ label: "CON-VERIFY-0001" }),
    ]);
  });

  it("returns null for a payload that isn't a recognizable row list at all", () => {
    expect(mapContractsListRows(null)).toBeNull();
    expect(mapContractsListRows("not json")).toBeNull();
    expect(mapContractsListRows({ unrelated: true })).toBeNull();
  });
});

// COMP-010: real GET /v1/citizen/portal/metrics response shape, from
// citizen-service requests/routes.ts + requests/queries.ts getPortalMetrics()
// -- a single real-metrics object, not an array of per-metric rows.
const REAL_PORTAL_METRICS_ENVELOPE = {
  data: {
    totalServices: 42,
    activeRequests: 17,
    resolvedThisMonth: 128,
    avgResolutionDays: 3.4,
  },
};

describe("mapCitizenPortalMetrics", () => {
  it("maps the real citizen-service portal-metrics envelope (object, not a row array)", () => {
    // Regression for COMP-010: the loader previously ran this payload through
    // getArrayPayload(), which only recognizes arrays / {data:[...]}  /
    // {items:[...]}. Since payload.data here is an object, getArrayPayload
    // always returned null, so the page always rendered source:"error" with
    // zero metrics regardless of what the backend sent.
    expect(mapCitizenPortalMetrics(REAL_PORTAL_METRICS_ENVELOPE)).toEqual({
      totalServices: 42,
      activeRequests: 17,
      resolvedThisMonth: 128,
      avgResolutionDays: 3.4,
    });
  });

  it("accepts a tenant with genuinely zero metrics (not treated as missing data)", () => {
    const result = mapCitizenPortalMetrics({
      data: { totalServices: 0, activeRequests: 0, resolvedThisMonth: 0, avgResolutionDays: 0 },
    });
    expect(result).toEqual({ totalServices: 0, activeRequests: 0, resolvedThisMonth: 0, avgResolutionDays: 0 });
    expect(result).not.toBeNull();
  });

  it("returns null for an array payload (the old, never-matching shape)", () => {
    expect(mapCitizenPortalMetrics({ data: [{ metric: "x" }] })).toBeNull();
  });

  it("returns null when a required numeric field is missing or the wrong type", () => {
    expect(
      mapCitizenPortalMetrics({ data: { totalServices: 1, activeRequests: 2, resolvedThisMonth: 3 } }),
    ).toBeNull();
    expect(
      mapCitizenPortalMetrics({
        data: { totalServices: "1", activeRequests: 2, resolvedThisMonth: 3, avgResolutionDays: 4 },
      }),
    ).toBeNull();
  });

  it("returns null for a payload that isn't a recognizable metrics object at all", () => {
    expect(mapCitizenPortalMetrics(null)).toBeNull();
    expect(mapCitizenPortalMetrics("not json")).toBeNull();
    expect(mapCitizenPortalMetrics({ unrelated: true })).toBeNull();
  });
});
