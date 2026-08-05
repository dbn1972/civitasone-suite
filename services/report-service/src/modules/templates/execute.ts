/**
 * Template execution — runs the report template against its data source,
 * applies formula engine for computed columns, and returns results with chart config.
 */
import type { TemplateView, TemplateFormula, TemplateChartConfig } from "./schema.js";
import { evaluateFormulas } from "./formula-engine.js";

export interface ExecutionResult {
  templateId: string;
  rows: Record<string, unknown>[];
  formulas: TemplateFormula[];
  chartConfig: TemplateChartConfig | null;
  outputFormat: string;
  meta: {
    rowCount: number;
    computedColumns: string[];
    executedAt: string;
  };
}

/**
 * Execute a template against fetched data rows.
 * After fetching rows from the data source, applies formulas to produce computed columns,
 * and attaches chart configuration for frontend rendering.
 */
export function executeWithFormulas(
  template: TemplateView,
  rows: Record<string, unknown>[],
  outputFormatOverride?: string,
): ExecutionResult {
  const formulas = template.formulas ?? [];
  const processedRows = formulas.length > 0
    ? evaluateFormulas(rows, formulas)
    : rows;

  return {
    templateId: template.id,
    rows: processedRows,
    formulas,
    chartConfig: template.chartConfig ?? null,
    outputFormat: outputFormatOverride ?? template.outputFormat,
    meta: {
      rowCount: processedRows.length,
      computedColumns: formulas.map((f) => f.name),
      executedAt: new Date().toISOString(),
    },
  };
}
