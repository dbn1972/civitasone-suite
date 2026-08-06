/**
 * G22 — Context-attach repository (cached reads).
 */
import { sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";

const CACHE_KEY_RULES = "context_attach_rules";
const CACHE_KEY_ATTACHMENTS = "context_attachments";

export interface RuleListParams {
  tenantId: string;
  limit: number;
  offset: number;
  eventType?: string;
  active?: boolean;
}

export interface AttachmentListParams {
  tenantId: string;
  limit: number;
  offset: number;
  targetType: string;
  targetId: string;
}

export async function listRules(params: RuleListParams): Promise<{ data: unknown[]; total: number }> {
  const cacheKey = `${CACHE_KEY_RULES}:${params.tenantId}:${params.offset}:${params.limit}:${params.eventType ?? "all"}:${params.active ?? "all"}`;
  return cache.getOrLoad(params.tenantId, cacheKey, async () => {
    const eventFilter = params.eventType ? sql`AND event_type = ${params.eventType}` : sql``;
    const activeFilter = params.active !== undefined ? sql`AND active = ${params.active}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", name, event_type AS "eventType",
             match_field AS "matchField", match_target AS "matchTarget",
             target_field AS "targetField", action, active, priority, version,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm.context_attach_rules
      WHERE tenant_id = ${params.tenantId} ${eventFilter} ${activeFilter}
      ORDER BY priority ASC, created_at DESC
      LIMIT ${params.limit} OFFSET ${params.offset}
    `))) as unknown as unknown[];
    return { data: rows, total: rows.length };
  });
}

export async function listAttachments(params: AttachmentListParams): Promise<{ data: unknown[]; total: number }> {
  const cacheKey = `${CACHE_KEY_ATTACHMENTS}:${params.tenantId}:${params.targetType}:${params.targetId}:${params.offset}:${params.limit}`;
  return cache.getOrLoad(params.tenantId, cacheKey, async () => {
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT a.id, a.tenant_id AS "tenantId", a.rule_id AS "ruleId",
             a.event_ref AS "eventRef", a.target_type AS "targetType",
             a.target_id AS "targetId", a.attached_at AS "attachedAt",
             a.metadata, a.version,
             r.name AS "ruleName", r.action
      FROM crm.context_attachments a
      JOIN crm.context_attach_rules r ON r.id = a.rule_id
      WHERE a.tenant_id = ${params.tenantId}
        AND a.target_type = ${params.targetType}
        AND a.target_id = ${params.targetId}
      ORDER BY a.attached_at DESC
      LIMIT ${params.limit} OFFSET ${params.offset}
    `))) as unknown as unknown[];
    return { data: rows, total: rows.length };
  });
}
