import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

export interface HealthScoreRow {
  id: string;
  tenantId: string;
  accountId: string;
  score: number;
  signals: Record<string, number>;
  computedAt: string;
  version: number;
}

export interface ConfigRow {
  id: string;
  tenantId: string;
  signalName: string;
  weight: number;
  decayDays: number;
  source: string;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export async function getHealthScoreByAccount(tenantId: string, accountId: string): Promise<HealthScoreRow | null> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", account_id AS "accountId",
           score, signals, computed_at AS "computedAt", version
    FROM crm.account_health_scores
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
  `))) as unknown as HealthScoreRow[];
  return rows[0] ?? null;
}

export async function listConfigs(
  tenantId: string,
  opts: { limit: number; offset: number; source?: string | undefined },
): Promise<ConfigRow[]> {
  const sourceFilter = opts.source ? sql`AND source = ${opts.source}` : sql``;
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", signal_name AS "signalName",
           weight, decay_days AS "decayDays", source, enabled, version,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM crm.health_score_configs
    WHERE tenant_id = ${tenantId} ${sourceFilter}
    ORDER BY created_at DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `))) as unknown as ConfigRow[];
  return rows;
}
