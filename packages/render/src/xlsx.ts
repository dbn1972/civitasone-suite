/**
 * XLSX rendering via exceljs.
 *
 * Generates real .xlsx files (Office Open XML) from structured row/column data.
 */
import ExcelJS from "exceljs";

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number | undefined;
  style?: { numFmt?: string } | undefined;
}

export interface XlsxRenderOptions {
  /** Sheet name (default: "Report") */
  sheetName?: string | undefined;
  /** Column definitions */
  columns: XlsxColumn[];
  /** Row data (array of objects keyed by column.key) */
  rows: Record<string, unknown>[];
  /** Title row above headers */
  title?: string | undefined;
  /** Generated-at timestamp in footer */
  generatedAt?: string | undefined;
}

export interface XlsxRenderResult {
  /** XLSX buffer */
  buffer: Buffer;
  /** Row count */
  rowCount: number;
}

/**
 * Render data to a real XLSX file using exceljs.
 */
export async function renderXlsx(opts: XlsxRenderOptions): Promise<XlsxRenderResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CivitasOne Report Service";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(opts.sheetName ?? "Report");

  // Title row
  if (opts.title) {
    const titleRow = sheet.addRow([opts.title]);
    titleRow.font = { bold: true, size: 14 };
    sheet.mergeCells(1, 1, 1, opts.columns.length);
    sheet.addRow([]); // blank row after title
  }

  // Set columns
  sheet.columns = opts.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 15,
    ...(c.style?.numFmt ? { style: { numFmt: c.style.numFmt } } : {}),
  }));

  // Style header row
  const headerRowIdx = opts.title ? 3 : 1;
  const headerRow = sheet.getRow(headerRowIdx);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  // Add data rows
  for (const row of opts.rows) {
    sheet.addRow(row);
  }

  // Auto-filter on header row
  sheet.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: opts.columns.length },
  };

  // Footer
  if (opts.generatedAt) {
    sheet.addRow([]);
    const footer = sheet.addRow([`Generated: ${opts.generatedAt}`]);
    footer.font = { italic: true, size: 9, color: { argb: "FF666666" } };
  }

  // Write to buffer
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return { buffer, rowCount: opts.rows.length };
}

/**
 * Render simple CSV from the same column/row structure.
 */
export function renderCsv(columns: XlsxColumn[], rows: Record<string, unknown>[]): string {
  const escape = (val: unknown): string => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => escape(c.header)).join(",");
  const dataRows = rows.map((row) => columns.map((c) => escape(row[c.key])).join(","));
  return [header, ...dataRows].join("\n");
}
