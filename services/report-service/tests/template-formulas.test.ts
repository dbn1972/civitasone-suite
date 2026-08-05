/**
 * Template formulas + chart config integration tests.
 * Tests creating templates with formulas + chart_config, executing them,
 * and verifying computed columns appear in output with chartConfig returned.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { executeWithFormulas } from "../src/modules/templates/execute.js";
import type { TemplateView } from "../src/modules/templates/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const ACTOR = "user-formula-001";

function makeToken(roles: string[] = ["report_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-formula-001" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/reports/templates — create with formulas + chart_config", () => {
  const templateWithFormulas = {
    name: "Revenue Analysis with Margins",
    description: "Calculates margin and margin percentage",
    dataSourceId: "finance.bills",
    filters: [{ field: "status", operator: "eq", value: "paid" }],
    groups: [{ field: "department" }],
    aggregations: [{ field: "amount", function: "sum", alias: "total" }],
    parameters: [],
    formulas: [
      { name: "margin", expression: "revenue - cost", type: "number" },
      { name: "margin_pct", expression: "(revenue - cost) / revenue * 100", type: "percentage" },
    ],
    chartConfig: {
      type: "bar",
      xAxis: "department",
      yAxis: "margin",
      series: ["margin", "margin_pct"],
      colorScheme: "corporate",
      stacked: false,
    },
    outputFormat: "xlsx",
  };

  it("returns 202 with valid template including formulas and chartConfig", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: templateWithFormulas,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe("accepted");
  });

  it("returns 202 with template without formulas or chartConfig (backward compat)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        name: "Basic Template",
        dataSourceId: "finance.vouchers",
        outputFormat: "pdf",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for invalid formula type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        ...templateWithFormulas,
        formulas: [{ name: "x", expression: "a + b", type: "invalid" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid chart type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        ...templateWithFormulas,
        chartConfig: { type: "radar" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when formula name is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        ...templateWithFormulas,
        formulas: [{ name: "", expression: "a + b", type: "number" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when formula expression is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/reports/templates",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        ...templateWithFormulas,
        formulas: [{ name: "x", expression: "", type: "number" }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts all valid chart types", async () => {
    const chartTypes = ["bar", "line", "pie", "area", "scatter", "funnel", "table"] as const;
    for (const type of chartTypes) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${makeToken()}` },
        payload: {
          name: `Chart ${type}`,
          dataSourceId: "finance.bills",
          chartConfig: { type },
        },
      });
      expect(res.statusCode).toBe(202);
    }
  });
});

describe("PATCH /v1/reports/templates/:id — update with formulas + chartConfig", () => {
  it("returns 400 for invalid formula in update", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        formulas: [{ name: "x", expression: "a + b", type: "bogus" }],
        version: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts null chartConfig to clear chart settings", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/reports/templates/00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        chartConfig: null,
        version: 1,
      },
    });
    // 404 because template doesn't exist (but validates schema first → 400 would happen before 404 if invalid)
    expect(res.statusCode).toBe(404);
  });
});

describe("executeWithFormulas — execution integration", () => {
  const mockTemplate: TemplateView = {
    id: "tmpl-001",
    tenantId: TENANT,
    name: "Revenue Report",
    description: null,
    dataSourceId: "finance.bills",
    filters: [],
    groups: [],
    aggregations: [],
    parameters: [],
    formulas: [
      { name: "margin", expression: "revenue - cost", type: "number" },
      { name: "margin_pct", expression: "(revenue - cost) / revenue * 100", type: "percentage" },
    ],
    chartConfig: {
      type: "bar",
      xAxis: "department",
      yAxis: "margin",
      series: ["margin", "margin_pct"],
      stacked: false,
    },
    outputFormat: "xlsx",
    status: "active",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
  };

  it("appends computed columns to rows", () => {
    const rows = [
      { department: "HR", revenue: 1000, cost: 600 },
      { department: "IT", revenue: 2000, cost: 1500 },
    ];
    const result = executeWithFormulas(mockTemplate, rows);

    expect(result.rows[0]!["margin"]).toBe(400);
    expect(result.rows[0]!["margin_pct"]).toBe(40);
    expect(result.rows[1]!["margin"]).toBe(500);
    expect(result.rows[1]!["margin_pct"]).toBe(25);
  });

  it("returns chartConfig in the result", () => {
    const rows = [{ department: "HR", revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(mockTemplate, rows);

    expect(result.chartConfig).toEqual({
      type: "bar",
      xAxis: "department",
      yAxis: "margin",
      series: ["margin", "margin_pct"],
      stacked: false,
    });
  });

  it("returns formulas metadata in the result", () => {
    const rows = [{ department: "HR", revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(mockTemplate, rows);

    expect(result.formulas).toHaveLength(2);
    expect(result.meta.computedColumns).toEqual(["margin", "margin_pct"]);
  });

  it("handles template with no formulas", () => {
    const noFormulaTemplate: TemplateView = {
      ...mockTemplate,
      formulas: [],
      chartConfig: null,
    };
    const rows = [{ a: 1, b: 2 }];
    const result = executeWithFormulas(noFormulaTemplate, rows);

    expect(result.rows).toEqual([{ a: 1, b: 2 }]);
    expect(result.chartConfig).toBeNull();
    expect(result.meta.computedColumns).toEqual([]);
  });

  it("handles division by zero gracefully in execution", () => {
    const divZeroTemplate: TemplateView = {
      ...mockTemplate,
      formulas: [{ name: "ratio", expression: "a / b", type: "number" }],
    };
    const rows = [{ a: 10, b: 0 }];
    const result = executeWithFormulas(divZeroTemplate, rows);

    expect(result.rows[0]!["ratio"]).toBeNull();
  });

  it("respects outputFormat override", () => {
    const rows = [{ department: "HR", revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(mockTemplate, rows, "csv");
    expect(result.outputFormat).toBe("csv");
  });

  it("uses template outputFormat when no override", () => {
    const rows = [{ department: "HR", revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(mockTemplate, rows);
    expect(result.outputFormat).toBe("xlsx");
  });

  it("includes rowCount in meta", () => {
    const rows = [
      { department: "HR", revenue: 1000, cost: 600 },
      { department: "IT", revenue: 2000, cost: 1500 },
      { department: "Ops", revenue: 1500, cost: 900 },
    ];
    const result = executeWithFormulas(mockTemplate, rows);
    expect(result.meta.rowCount).toBe(3);
  });

  it("includes executedAt timestamp in meta", () => {
    const rows = [{ department: "HR", revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(mockTemplate, rows);
    expect(result.meta.executedAt).toBeDefined();
    // Verify it's a valid ISO date
    expect(new Date(result.meta.executedAt).toISOString()).toBe(result.meta.executedAt);
  });

  it("handles missing field in formula during execution", () => {
    const missingFieldTemplate: TemplateView = {
      ...mockTemplate,
      formulas: [{ name: "calc", expression: "revenue + nonexistent", type: "number" }],
    };
    const rows = [{ revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(missingFieldTemplate, rows);
    expect(result.rows[0]!["calc"]).toBeNull();
  });

  it("formula chaining: later formulas can reference earlier ones", () => {
    const chainTemplate: TemplateView = {
      ...mockTemplate,
      formulas: [
        { name: "profit", expression: "revenue - cost", type: "number" },
        { name: "profit_doubled", expression: "profit * 2", type: "number" },
      ],
    };
    const rows = [{ revenue: 1000, cost: 600 }];
    const result = executeWithFormulas(chainTemplate, rows);
    expect(result.rows[0]!["profit"]).toBe(400);
    expect(result.rows[0]!["profit_doubled"]).toBe(800);
  });
});
