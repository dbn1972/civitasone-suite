import { sql } from "drizzle-orm";
import { pgSchema, uuid, varchar, bigint, timestamp } from "drizzle-orm/pg-core";
import {
  allocateGaplessSeq,
  formatReference,
  normalizeSpec,
  type GaplessSeqConfig,
} from "@civitasone/numbering";

export const procurementSchema = pgSchema("procurement");

export const docCounters = procurementSchema.table("doc_counters", {
  tenantId:  uuid("tenant_id").notNull(),
  docType:   varchar("doc_type", { length: 24 }).notNull(),
  period:    varchar("period", { length: 8 }).notNull(),
  lastSeq:   bigint("last_seq", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const docCountersSchema = { docCounters };

const PREFIX: Record<string, string> = {
  po: "PO",
  indent: "IND",
  tender: "TND",
  grn: "GRN",
  auction: "AUC",
  gem: "GEM",
  bid: "BID",
  emd: "EMD",
  pbg: "PBG",
  plan: "APP",
  amendment: "AMD",
  corrigendum: "COR",
};

/**
 * Physical layout of procurement's legacy counter table, expressed as config
 * for the shared gapless allocator. Adopting `@civitasone/numbering` means the
 * tx-safe increment + formatting now come from the platform capability
 * (CAP-032) rather than SQL copy-pasted into this service.
 */
const DOC_COUNTER_CONFIG: GaplessSeqConfig = {
  schema: "procurement",
  table: "doc_counters",
  tenantCol: "tenant_id",
  keyCol: "doc_type",
  bucketCol: "period",
  valueCol: "last_seq",
};

// `sql` is re-exported so existing imports of this module keep resolving even
// though the counter SQL now lives in the shared package.
export { sql };

/**
 * Allocate the next gapless per-tenant document number INSIDE the caller's
 * transaction, delegating to the shared numbering capability. Output format is
 * preserved exactly: `PREFIX/<period>/<0001>` (e.g. `PO/2026/0001`).
 *
 * Gapless guarantee is unchanged: the shared allocator issues the same
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` row-locked increment, so a
 * rolled-back tx does not consume the number.
 */
export async function allocateDocNo(
  tx: any,
  tenantId: string,
  docType: keyof typeof PREFIX,
  period: string = String(new Date().getUTCFullYear()),
): Promise<string> {
  const seq = await allocateGaplessSeq(tx, DOC_COUNTER_CONFIG, tenantId, docType, period);
  const prefix = PREFIX[docType] ?? String(docType).toUpperCase();
  const spec = normalizeSpec({ prefix, embedFinancialYear: false, counterWidth: 4, separator: "/" });
  return formatReference(spec, seq, { segments: [period] });
}
