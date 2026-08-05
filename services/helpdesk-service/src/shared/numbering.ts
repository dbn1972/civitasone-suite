/**
 * Ticket reference number allocation (CS-001).
 *
 * Wraps @civitasone/numbering with helpdesk-specific config: prefix "CASE",
 * Indian financial year (April start), yearly reset, 6-digit counter.
 * Produces references like "CASE/2026-27/000001".
 *
 * Called inside every ticket-create transaction so the reference is gapless
 * and rolls back cleanly if the surrounding write fails.
 */
import {
  allocateReference,
  normalizeSpec,
  type GaplessSeqConfig,
  type NumberFormatSpec,
  type SqlExecutor,
} from "@civitasone/numbering";

/** The format spec for ticket reference numbers. */
export const TICKET_NUMBER_SPEC: NumberFormatSpec = normalizeSpec({
  prefix: "CASE",
  embedFinancialYear: true,
  fyStartMonth: 4,
  counterWidth: 6,
  separator: "/",
  resetPolicy: "yearly",
});

/**
 * Physical layout of helpdesk.number_counters — the same INSERT ... ON CONFLICT
 * pattern the shared allocator uses for every counter table in the platform.
 */
export const HELPDESK_SEQ_CONFIG: GaplessSeqConfig = {
  schema: "helpdesk",
  table: "number_counters",
  tenantCol: "tenant_id",
  keyCol: "format_key",
  bucketCol: "bucket",
  valueCol: "current_value",
  updatedAtCol: "updated_at",
};

/** Format key used for ticket reference numbers in the counter table. */
export const TICKET_FORMAT_KEY = "ticket_no";

/**
 * Allocate the next gapless ticket reference inside `tx`. Must be called inside
 * the same transaction that writes the ticket row so the number is never
 * consumed without the row existing, and never appears on two rows.
 */
export async function allocateTicketNo(
  tx: SqlExecutor,
  tenantId: string,
  at?: Date,
): Promise<string> {
  const result = await allocateReference(tx, {
    spec: TICKET_NUMBER_SPEC,
    seqConfig: HELPDESK_SEQ_CONFIG,
    formatKey: TICKET_FORMAT_KEY,
    tenantId,
    ...(at !== undefined ? { at } : {}),
  });
  return result.reference;
}
