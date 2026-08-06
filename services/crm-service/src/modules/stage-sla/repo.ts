/**
 * G3 — Stage SLA policy read-model repository.
 * Uses Redis cache.getOrLoad for read-through caching.
 */
import { sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";

const CACHE_PREFIX = "crm:stage-sla-policies";
const TTL = 300; // 5 minutes

export interface SLAPolicyView {
  id: string;
  tenantId: string;
  stageCode: string;
  slaHours: number;
  warnAtPercent: number;
  breachAction: string;
  notifyRoles: string[];
  escalationTargetId: string | null;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export async function findById(id: string, tenantId: string): Promise<SLAPolicyView | null> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", stage_code AS "stageCode",
           sla_hours AS "slaHours", warn_at_percent AS "warnAtPercent",
           breach_action AS "breachAction", notify_roles AS "notifyRoles",
           escalation_target_id AS "escalationTargetId", active, version,
           created_at AS "createdAt", updated_at AS "updatedAt",
           created_by AS "createdBy", updated_by AS "updatedBy"
    FROM crm.stage_sla_policies
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as SLAPolicyView[];
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  activeFilter?: boolean,
): Promise<SLAPolicyView[]> {
  const cacheKey = `${CACHE_PREFIX}:${tenantId}:${limit}:${offset}:${activeFilter ?? "all"}`;
  return cache.getOrLoad(cacheKey, async () => {
    const activeClause = activeFilter !== undefined ? sql`AND active = ${activeFilter}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", stage_code AS "stageCode",
             sla_hours AS "slaHours", warn_at_percent AS "warnAtPercent",
             breach_action AS "breachAction", notify_roles AS "notifyRoles",
             escalation_target_id AS "escalationTargetId", active, version,
             created_at AS "createdAt", updated_at AS "updatedAt",
             created_by AS "createdBy", updated_by AS "updatedBy"
      FROM crm.stage_sla_policies
      WHERE tenant_id = ${tenantId} ${activeClause}
      ORDER BY stage_code ASC
      LIMIT ${limit} OFFSET ${offset}
    `))) as unknown as SLAPolicyView[];
    return rows;
  }, TTL);
}

export async function findByStageCode(tenantId: string, stageCode: string): Promise<SLAPolicyView | null> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", stage_code AS "stageCode",
           sla_hours AS "slaHours", warn_at_percent AS "warnAtPercent",
           breach_action AS "breachAction", notify_roles AS "notifyRoles",
           escalation_target_id AS "escalationTargetId", active, version,
           created_at AS "createdAt", updated_at AS "updatedAt",
           created_by AS "createdBy", updated_by AS "updatedBy"
    FROM crm.stage_sla_policies
    WHERE tenant_id = ${tenantId} AND stage_code = ${stageCode} AND active = true
  `))) as unknown as SLAPolicyView[];
  return rows[0] ?? null;
}
