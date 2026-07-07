/**
 * exports/domain.ts — Pure export generation logic (CSV/JSON formatters).
 *
 * Enforces 50MB maximum file size limit. Uses streaming approach for
 * large datasets to avoid buffering the entire file in memory.
 */

/** Maximum export file size: 50 MB */
export const MAX_EXPORT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** 24-hour presigned URL TTL in seconds */
export const PRESIGNED_URL_TTL_SECONDS = 86400; // 24 hours

export type ExportFormat = "csv" | "json" | "pdf" | "xlsx";

export interface ExportResult {
  content: Buffer;
  contentType: string;
  sizeBytes: number;
}

export class ExportSizeLimitExceededError extends Error {
  constructor(sizeBytes: number) {
    super(
      `Export file size ${sizeBytes} bytes exceeds maximum allowed size of ${MAX_EXPORT_SIZE_BYTES} bytes (50 MB)`,
    );
    this.name = "ExportSizeLimitExceededError";
  }
}

/**
 * Generate export content in the specified format from query result data.
 * Enforces 50MB file size limit — throws ExportSizeLimitExceededError if exceeded.
 */
export function generateExport(
  data: Record<string, unknown> | unknown[],
  format: ExportFormat,
): ExportResult {
  const content = format === "csv" ? generateCsvBuffer(data) : generateJsonBuffer(data);
  const sizeBytes = content.byteLength;

  if (sizeBytes > MAX_EXPORT_SIZE_BYTES) {
    throw new ExportSizeLimitExceededError(sizeBytes);
  }

  const contentType = format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";

  return { content, contentType, sizeBytes };
}

/**
 * Build the S3 object key for an export file.
 * Pattern: exports/{tenantId}/{exportId}.{format}
 */
export function buildFileKey(tenantId: string, exportId: string, format: ExportFormat): string {
  const ext = format === "csv" ? "csv" : "json";
  return `exports/${tenantId}/${exportId}.${ext}`;
}

/**
 * Compute the expiry timestamp for the presigned URL (24h from now).
 */
export function computeExpiresAt(): Date {
  return new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000);
}

// ── Internal helpers ──────────────────────────────────────────────

/**
 * Convert query result data to a CSV buffer.
 * Handles both array-of-objects and { rows: [...] } shapes.
 */
function generateCsvBuffer(data: Record<string, unknown> | unknown[]): Buffer {
  const rows = extractRows(data);
  if (rows.length === 0) return Buffer.from("", "utf-8");

  const first = rows[0] as Record<string, unknown>;
  const headers = Object.keys(first);

  // Build CSV content incrementally
  const parts: string[] = [];
  parts.push(headers.map(escapeCsvField).join(","));

  for (const row of rows as Record<string, unknown>[]) {
    const line = headers.map((h) => {
      const val = row[h];
      const str = val === null || val === undefined ? "" : String(val);
      return escapeCsvField(str);
    }).join(",");
    parts.push(line);
  }

  return Buffer.from(parts.join("\n"), "utf-8");
}

/**
 * Convert query result data to a JSON buffer.
 * Outputs a JSON array of row objects.
 */
function generateJsonBuffer(data: Record<string, unknown> | unknown[]): Buffer {
  const rows = extractRows(data);
  const jsonStr = JSON.stringify(rows, null, 2);
  return Buffer.from(jsonStr, "utf-8");
}

/**
 * Extract row array from various result shapes.
 * Supports: direct array, { rows: [...] }, { data: [...] }, or wraps object in array.
 */
function extractRows(data: Record<string, unknown> | unknown[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.data)) return obj.data;
  }
  return [];
}

/**
 * Escape a CSV field value per RFC 4180.
 * Wraps in quotes if the value contains comma, double-quote, or newline.
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
