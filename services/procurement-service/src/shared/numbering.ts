import { sql } from "drizzle-orm";
import { pgSchema, uuid, varchar, bigint, timestamp } from "drizzle-orm/pg-core";

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
 * Allocate the next gapless per-tenant document number INSIDE the caller's
 * transaction. The UPDATE ... RETURNING (with an INSERT-on-conflict seed) takes
 * a row lock so concurrent allocations serialize; a rolled-back tx releases the
 * lock and does NOT consume the number (the increment rolls back with it).
 */
export async function allocateDocNo(
  tx: any,
  tenantId: string,
  docType: keyof typeof PREFIX,
  period: string = String(new Date().getUTCFullYear()),
): Promise<string> {
  const rows = await tx.execute(sql`
    INSERT INTO procurement.doc_counters (tenant_id, doc_type, period, last_seq)
    VALUES (${tenantId}::uuid, ${docType}, ${period}, 1)
    ON CONFLICT (tenant_id, doc_type, period)
    DO UPDATE SET last_seq = procurement.doc_counters.last_seq + 1, updated_at = NOW()
    RETURNING last_seq
  `);
  const arr = rows as unknown as Array<{ last_seq: string | number | bigint }>;
  const seq = BigInt(arr[0]?.last_seq ?? 1);
  const prefix = PREFIX[docType] ?? docType.toUpperCase();
  return `${prefix}/${period}/${seq.toString().padStart(4, "0")}`;
}
