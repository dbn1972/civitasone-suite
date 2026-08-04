/**
 * Lead reference number allocation (LM-006).
 *
 * Wraps @civitasone/numbering with CRM-specific config: prefix "LEAD",
 * Indian financial year (April start), yearly reset, 6-digit counter.
 * Produces references like "LEAD/2026-27/000001".
 *
 * Called inside every contact-create transaction so the reference is gapless
 * and rolls back cleanly if the surrounding write fails.
 */
import {
  allocateReference,
  normalizeSpec,
  type GaplessSeqConfig,
  type NumberFormatSpec,
  type SqlExecutor,
} from "@civitasone/numbering";

/** The format spec for lead reference numbers. */
export const LEAD_NUMBER_SPEC: NumberFormatSpec = normalizeSpec({
  prefix: "LEAD",
  embedFinancialYear: true,
  fyStartMonth: 4,
  counterWidth: 6,
  separator: "/",
  resetPolicy: "yearly",
});

/**
 * Physical layout of crm.number_counters — the same INSERT ... ON CONFLICT
 * pattern the shared allocator uses for every counter table in the platform.
 */
export const CRM_SEQ_CONFIG: GaplessSeqConfig = {
  schema: "crm",
  table: "number_counters",
  tenantCol: "tenant_id",
  keyCol: "format_key",
  bucketCol: "bucket",
  valueCol: "current_value",
  updatedAtCol: "updated_at",
};

/** Format key used for lead reference numbers in the counter table. */
export const LEAD_FORMAT_KEY = "lead_no";

/**
 * Allocate the next gapless lead reference inside `tx`. Must be called inside
 * the same transaction that writes the contact row so the number is never
 * consumed without the row existing, and never appears on two rows.
 */
export async function allocateLeadNo(
  tx: SqlExecutor,
  tenantId: string,
  at?: Date,
): Promise<string> {
  const result = await allocateReference(tx, {
    spec: LEAD_NUMBER_SPEC,
    seqConfig: CRM_SEQ_CONFIG,
    formatKey: LEAD_FORMAT_KEY,
    tenantId,
    ...(at !== undefined ? { at } : {}),
  });
  return result.reference;
}
