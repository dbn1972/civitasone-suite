/** Reads + transactional writes for configurable lead field rules (LM-001). */
import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  leadFieldRules,
  type LeadFieldRuleRow,
  type LeadFieldRuleInsert,
  type LeadFieldRuleView,
} from "./field-rules-schema.js";

export function toView(r: LeadFieldRuleRow): LeadFieldRuleView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    fieldName: r.fieldName,
    required: r.required,
    weight: r.weight,
    enabled: r.enabled,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listRules(tenantId: string): Promise<LeadFieldRuleView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(leadFieldRules)
      .where(eq(leadFieldRules.tenantId, tenantId))
      .orderBy(leadFieldRules.fieldName),
  );
  return rows.map(toView);
}

export async function findByFieldName(
  tenantId: string,
  fieldName: string,
): Promise<LeadFieldRuleView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(leadFieldRules)
      .where(and(eq(leadFieldRules.tenantId, tenantId), eq(leadFieldRules.fieldName, fieldName)))
      .limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

/**
 * Upsert on (tenant_id, field_name) — the unique index from migration 0037.
 *
 * This is what makes the upsert command replay-safe: a redelivered message
 * converges on the same single row rather than creating a second rule for the
 * same field, which would leave validation depending on row order.
 */
export async function upsert(tx: Writer, row: LeadFieldRuleInsert): Promise<void> {
  await tx.insert(leadFieldRules).values(row).onConflictDoUpdate({
    target: [leadFieldRules.tenantId, leadFieldRules.fieldName],
    set: {
      required: row.required ?? false,
      weight: row.weight ?? 0,
      enabled: row.enabled ?? true,
      updatedAt: new Date(),
      updatedBy: row.updatedBy,
      version: sql`${leadFieldRules.version} + 1`,
    },
  });
}

export async function remove(tx: Writer, tenantId: string, fieldName: string): Promise<void> {
  await (tx as typeof db).delete(leadFieldRules)
    .where(and(eq(leadFieldRules.tenantId, tenantId), eq(leadFieldRules.fieldName, fieldName)));
}
