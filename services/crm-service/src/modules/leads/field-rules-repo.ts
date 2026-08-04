/** Reads + transactional writes for configurable lead field rules (LM-001). */
import { eq, and, sql } from "drizzle-orm";
import { pino } from "pino";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  leadFieldRules,
  type LeadFieldRuleRow,
  type LeadFieldRuleInsert,
  type LeadFieldRuleView,
} from "./field-rules-schema.js";

const log = pino({ name: "crm-lead-field-rules-repo" });

/**
 * Cache resource segment. Exported and imported by the command publisher and the
 * consumer so the key this module writes and the prefix they invalidate cannot drift:
 * `cache.makeKey(t, RESOURCE, "all")` is `crm:{t}:lead_field_rule:all`, and
 * `cache.invalidateResource(t, RESOURCE)` deletes `crm:{t}:lead_field_rule*`.
 */
export const RESOURCE = "lead_field_rule";

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

async function loadRules(tenantId: string): Promise<LeadFieldRuleView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(leadFieldRules)
      .where(eq(leadFieldRules.tenantId, tenantId))
      .orderBy(leadFieldRules.fieldName),
  );
  return rows.map(toView);
}

/**
 * The tenant's whole rule set, read through Redis.
 *
 * This is on the hot write path: POST /v1/crm/contacts consults it on every single
 * lead creation, and uncached that is BEGIN + set_config + SELECT + COMMIT per lead
 * for at most seven rows of near-static configuration. The invalidation was already
 * wired (field-rules-commands + field-rules-consumer both call
 * `cache.invalidateResource(tenantId, RESOURCE)`), so the only thing missing was a
 * populated key — hence RESOURCE is shared rather than restated, so the key written
 * here always sits under the prefix they clear.
 *
 * Whole-set granularity, not per-field: every caller wants all of them, and one key
 * means one invalidation cannot leave half a configuration behind.
 */
export async function listRules(tenantId: string): Promise<LeadFieldRuleView[]> {
  // Redis being down must never fail lead creation (graceful degradation), and
  // getOrLoad propagates store errors, so a cache-layer failure falls through to
  // Postgres and logs WARN. A *database* failure is re-thrown untouched — retrying it
  // here would only double the load on an already unhealthy DB and hide the cause.
  let dbFailed = false;
  const loader = async (): Promise<LeadFieldRuleView[]> => {
    try {
      return await loadRules(tenantId);
    } catch (err) {
      dbFailed = true;
      throw err;
    }
  };
  try {
    return (await cache.getOrLoad<LeadFieldRuleView[]>(
      cache.makeKey(tenantId, RESOURCE, "all"),
      loader,
    )) ?? [];
  } catch (err) {
    if (dbFailed) throw err;
    // tenantId only — a rule set carries no PII, but nothing is logged from it anyway.
    log.warn({ err, tenantId }, "lead field rules cache unavailable; read through to Postgres");
    return loadRules(tenantId);
  }
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
