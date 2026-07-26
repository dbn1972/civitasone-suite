/**
 * Numbering domain (CAP-032) — the bridge between a persisted `number_formats`
 * row and the shared `@civitasone/numbering` core. All formatting and gapless
 * allocation logic lives in the shared package so the exact same primitives
 * back this generic service AND per-service adopters (e.g. procurement).
 */
import { normalizeSpec, type NumberFormatSpec, type GaplessSeqConfig } from "@civitasone/numbering";
import type { numberFormats } from "./schema.js";

export type NumberFormatRow = typeof numberFormats.$inferSelect;

/** The counter table this service owns; shape passed to the gapless allocator. */
export const METADATA_SEQ_CONFIG: GaplessSeqConfig = {
  schema: "metadata",
  table: "number_sequences",
  tenantCol: "tenant_id",
  keyCol: "format_key",
  bucketCol: "bucket",
  valueCol: "current_value",
};

/** A tenant format key: dotted lowercase segments, e.g. "procurement.po". */
export const FORMAT_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isValidFormatKey(key: string): boolean {
  return FORMAT_KEY_RE.test(key) && key.length <= 128;
}

/** Convert a persisted format row into the pure `NumberFormatSpec` (validated). */
export function rowToSpec(row: NumberFormatRow): NumberFormatSpec {
  return normalizeSpec({
    prefix: row.prefix,
    embedFinancialYear: row.embedFinancialYear,
    fyStartMonth: row.fyStartMonth,
    counterWidth: row.counterWidth,
    separator: row.separator,
    resetPolicy: row.resetPolicy as NumberFormatSpec["resetPolicy"],
  });
}
