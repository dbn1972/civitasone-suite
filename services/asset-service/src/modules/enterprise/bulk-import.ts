import { z } from "zod";

/**
 * GAP-ASSETS-BULK-IMPORT-03/04: request validation and helpers for the bulk
 * asset import. Kept free of DB access so it is unit-testable.
 */
export const bulkImportBody = z.object({
  assets: z.array(z.object({
    name: z.string().trim().min(1).max(256),
    code: z.string().trim().min(1).max(64),
    assetType: z.enum(["fixed", "infra", "movable", "it", "vehicle", "other"]).default("fixed"),
    acquisitionCostMinor: z.number().int().nonnegative().safe(),
    orgUnit: z.string().max(128).optional(),
  })).min(1).max(500),
  /** Why the batch is being loaded (required) -- recorded on the batch audit event. */
  reason: z.string().trim().min(1).max(2000),
});
export type BulkImportBody = z.infer<typeof bulkImportBody>;

/** Codes that appear more than once (case-insensitive), each reported once, in first-seen order. */
export function duplicateCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Map<string, string>();
  for (const c of codes) {
    const k = c.trim().toLowerCase();
    if (seen.has(k) && !dup.has(k)) dup.set(k, c.trim());
    seen.add(k);
  }
  return [...dup.values()];
}

/** "A, B, C and 4 more" -- keeps the error body small for a 500-row file. */
export function summariseCodes(codes: readonly string[], max = 10): string {
  const head = codes.slice(0, max).join(", ");
  return codes.length > max ? `${head} and ${codes.length - max} more` : head;
}

/** A usable Idempotency-Key header value (8-128 printable chars), else undefined. */
export function parseIdempotencyKey(header: string | string[] | undefined): string | undefined {
  const v = Array.isArray(header) ? header[0] : header;
  const t = v?.trim();
  return t && /^[\x21-\x7e]{8,128}$/.test(t) ? t : undefined;
}
