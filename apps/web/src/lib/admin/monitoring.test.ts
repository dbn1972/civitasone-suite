import { describe, it, expect } from "vitest";
import { normaliseStatus, countApiStatuses, countEditions, toApiEndpointRow, toEditionRow } from "./monitoring";

// GAP-ADMIN-API-MONITORING-04
describe("countApiStatuses", () => {
  it("does not count maintenance / unknown / missing statuses as Down", () => {
    const c = countApiStatuses([
      { status: "healthy" },
      { status: "degraded" },
      { status: "down" },
      { status: "maintenance" },
      { status: undefined },
    ]);
    expect(c).toEqual({ endpoints: 5, healthy: 1, degraded: 1, down: 1, other: 2 });
  });

  it("normalises case and separators", () => {
    const c = countApiStatuses([{ status: "HEALTHY" }, { status: "partial_outage" }, { status: "Unhealthy" }]);
    expect(c).toMatchObject({ healthy: 1, degraded: 1, down: 1, other: 0 });
  });
});

// GAP-ADMIN-EDITIONS-04
describe("countEditions", () => {
  it("separates active, deprecated and draft; sums tenants without float math surprises", () => {
    const c = countEditions([
      { status: "active", tenants: 3 },
      { status: "draft", tenants: "0" },
      { status: "deprecated", tenants: 2 },
    ]);
    expect(c).toEqual({ total: 3, active: 1, deprecated: 1, other: 1, tenants: 5 });
  });

  it("ignores a non-numeric tenants value instead of producing NaN", () => {
    expect(countEditions([{ status: "active", tenants: "n/a" }]).tenants).toBe(0);
  });
});

// GAP-ADMIN-API-MONITORING-05 / GAP-ADMIN-EDITIONS-06
describe("row mappers", () => {
  it("default a missing status to 'unknown' and keep extra fields", () => {
    expect(toApiEndpointRow({ service: "x", endpoint: "/a", extra: 1 })).toMatchObject({ status: "unknown", extra: 1, service: "x" });
    expect(toEditionRow({ name: "Pro" })).toMatchObject({ status: "unknown", tenants: 0, name: "Pro" });
  });
});

describe("normaliseStatus", () => {
  it("passes real values through and maps missing / blank / non-scalar to 'unknown'", () => {
    expect(normaliseStatus("healthy")).toBe("healthy");
    expect(normaliseStatus(1)).toBe("1");
    expect(normaliseStatus(null)).toBe("unknown");
    expect(normaliseStatus(undefined)).toBe("unknown");
    expect(normaliseStatus("  ")).toBe("unknown");
    expect(normaliseStatus({ a: 1 })).toBe("unknown");
  });
});
