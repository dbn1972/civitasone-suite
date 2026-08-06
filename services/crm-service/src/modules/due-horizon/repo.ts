import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";

export interface ConfigView {
  id: string;
  tenantId: string;
  name: string;
  horizons: number[];
  groupBy: string;
  consentRequired: boolean;
  active: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunView {
  id: string;
  tenantId: string;
  configId: string;
  horizonDays: number;
  runAt: string;
  itemsGenerated: number;
  status: string;
  createdAt: string;
}

export async function listConfigs(tenantId: string, limit: number, offset: number): Promise<ConfigView[]> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", name, horizons, group_by AS "groupBy",
           consent_required AS "consentRequired", active, version,
           created_by AS "createdBy",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM crm.due_horizon_configs
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `))) as unknown as ConfigView[];
  return rows;
}

export async function findConfigById(id: string, tenantId: string): Promise<ConfigView | null> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", name, horizons, group_by AS "groupBy",
           consent_required AS "consentRequired", active, version,
           created_by AS "createdBy",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM crm.due_horizon_configs
    WHERE id = ${id} AND tenant_id = ${tenantId}
    LIMIT 1
  `))) as unknown as ConfigView[];
  return rows[0] ?? null;
}

export async function listRuns(tenantId: string, limit: number, offset: number, configId?: string): Promise<RunView[]> {
  const configFilter = configId ? sql`AND config_id = ${configId}` : sql``;
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", config_id AS "configId",
           horizon_days AS "horizonDays", run_at AS "runAt",
           items_generated AS "itemsGenerated", status,
           created_at AS "createdAt"
    FROM crm.due_horizon_runs
    WHERE tenant_id = ${tenantId} ${configFilter}
    ORDER BY run_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `))) as unknown as RunView[];
  return rows;
}
