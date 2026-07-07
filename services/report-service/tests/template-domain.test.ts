/**
 * Unit tests for template domain validation logic.
 * Tests constraint enforcement: data source whitelist, filter/group/param counts, tenant limit.
 */
import { describe, it, expect } from "vitest";
import {
  validateDataSource,
  validateFilters,
  validateGroups,
  validateParameters,
  validateTemplateCount,
  validateTemplate,
  MAX_FILTERS,
  MAX_GROUPS,
  MAX_PARAMETERS,
  MAX_TEMPLATES_PER_TENANT,
  DATA_SOURCE_CATALOG,
} from "../src/modules/templates/domain.js";

describe("validateDataSource", () => {
  it("returns null for whitelisted source", () => {
    expect(validateDataSource("finance.bills")).toBeNull();
    expect(validateDataSource("hrms.employees")).toBeNull();
    expect(validateDataSource("analytics.fact_events")).toBeNull();
  });

  it("returns error for unknown source", () => {
    const err = validateDataSource("unknown.source");
    expect(err).not.toBeNull();
    expect(err!.field).toBe("dataSourceId");
    expect(err!.message).toContain("not in the whitelisted catalog");
  });

  it("returns error for empty string", () => {
    const err = validateDataSource("");
    expect(err).not.toBeNull();
  });

  it("catalog contains expected sources", () => {
    expect(DATA_SOURCE_CATALOG.has("finance.bills")).toBe(true);
    expect(DATA_SOURCE_CATALOG.has("procurement.purchase_orders")).toBe(true);
    expect(DATA_SOURCE_CATALOG.has("citizen.grievances")).toBe(true);
  });
});

describe("validateFilters", () => {
  it("returns null for ≤20 filters", () => {
    const filters = Array.from({ length: 20 }, (_, i) => ({
      field: `f${i}`, operator: "eq" as const, value: i,
    }));
    expect(validateFilters(filters)).toBeNull();
  });

  it("returns null for empty filters", () => {
    expect(validateFilters([])).toBeNull();
  });

  it("returns error for >20 filters", () => {
    const filters = Array.from({ length: 21 }, (_, i) => ({
      field: `f${i}`, operator: "eq" as const, value: i,
    }));
    const err = validateFilters(filters);
    expect(err).not.toBeNull();
    expect(err!.field).toBe("filters");
    expect(err!.message).toContain(`maximum ${MAX_FILTERS}`);
  });
});

describe("validateGroups", () => {
  it("returns null for ≤4 groups", () => {
    const groups = Array.from({ length: 4 }, (_, i) => ({ field: `g${i}` }));
    expect(validateGroups(groups)).toBeNull();
  });

  it("returns null for empty groups", () => {
    expect(validateGroups([])).toBeNull();
  });

  it("returns error for >4 groups", () => {
    const groups = Array.from({ length: 5 }, (_, i) => ({ field: `g${i}` }));
    const err = validateGroups(groups);
    expect(err).not.toBeNull();
    expect(err!.field).toBe("groups");
    expect(err!.message).toContain(`maximum ${MAX_GROUPS}`);
  });
});

describe("validateParameters", () => {
  it("returns null for ≤20 parameters", () => {
    const params = Array.from({ length: 20 }, (_, i) => ({
      name: `p${i}`, type: "string" as const, required: false,
    }));
    expect(validateParameters(params)).toBeNull();
  });

  it("returns null for empty parameters", () => {
    expect(validateParameters([])).toBeNull();
  });

  it("returns error for >20 parameters", () => {
    const params = Array.from({ length: 21 }, (_, i) => ({
      name: `p${i}`, type: "string" as const, required: false,
    }));
    const err = validateParameters(params);
    expect(err).not.toBeNull();
    expect(err!.field).toBe("parameters");
    expect(err!.message).toContain(`maximum ${MAX_PARAMETERS}`);
  });
});

describe("validateTemplateCount", () => {
  it("returns null when under limit", () => {
    expect(validateTemplateCount(0)).toBeNull();
    expect(validateTemplateCount(49)).toBeNull();
  });

  it("returns error when at limit", () => {
    const err = validateTemplateCount(50);
    expect(err).not.toBeNull();
    expect(err!.message).toContain(`maximum ${MAX_TEMPLATES_PER_TENANT}`);
  });

  it("returns error when above limit", () => {
    const err = validateTemplateCount(100);
    expect(err).not.toBeNull();
  });
});

describe("validateTemplate (combined)", () => {
  it("returns empty array for valid input", () => {
    const errors = validateTemplate({
      dataSourceId: "finance.bills",
      filters: [{ field: "status", operator: "eq", value: "active" }],
      groups: [{ field: "dept" }],
      parameters: [{ name: "start", type: "date", required: true }],
    });
    expect(errors).toEqual([]);
  });

  it("returns multiple errors for multiple violations", () => {
    const errors = validateTemplate({
      dataSourceId: "invalid.source",
      filters: Array.from({ length: 21 }, (_, i) => ({ field: `f${i}`, operator: "eq" as const, value: i })),
      groups: Array.from({ length: 5 }, (_, i) => ({ field: `g${i}` })),
      parameters: Array.from({ length: 21 }, (_, i) => ({ name: `p${i}`, type: "string" as const, required: false })),
    });
    expect(errors.length).toBe(4);
    expect(errors.map((e) => e.field).sort()).toEqual(["dataSourceId", "filters", "groups", "parameters"]);
  });

  it("returns only relevant errors", () => {
    const errors = validateTemplate({
      dataSourceId: "finance.bills",
      filters: [],
      groups: Array.from({ length: 5 }, (_, i) => ({ field: `g${i}` })),
      parameters: [],
    });
    expect(errors.length).toBe(1);
    expect(errors[0]!.field).toBe("groups");
  });
});
