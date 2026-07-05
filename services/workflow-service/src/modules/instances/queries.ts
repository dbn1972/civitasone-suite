import { sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { INSTANCE_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

export async function listInstances(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, INSTANCE_RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}

export interface SearchFilters {
  status?: string | undefined;
  refType?: string | undefined;
  refId?: string | undefined;
  definitionCode?: string | undefined;
  sla?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  assignee?: string | undefined;
  q?: string | undefined;
  limit: number;
  offset: number;
}

export async function searchInstances(tenantId: string, filters: SearchFilters) {
  let query = sql`
    SELECT i.id, i.name, i.status, i.ref_type, i.ref_id, i.current_node,
           i.definition_id, i.created_at, i.updated_at,
           d.code AS definition_code, d.name AS definition_name
    FROM workflow.instances i
    LEFT JOIN workflow.definitions d ON d.id = i.definition_id
    WHERE i.tenant_id = ${tenantId}
  `;

  if (filters.status) query = sql`${query} AND i.status = ${filters.status}`;
  if (filters.refType) query = sql`${query} AND i.ref_type = ${filters.refType}`;
  if (filters.refId) query = sql`${query} AND i.ref_id = ${filters.refId}::uuid`;
  if (filters.definitionCode) query = sql`${query} AND d.code = ${filters.definitionCode}`;
  if (filters.from) query = sql`${query} AND i.created_at >= ${filters.from}::date`;
  if (filters.to) query = sql`${query} AND i.created_at < (${filters.to}::date + interval '1 day')`;
  if (filters.q) query = sql`${query} AND i.name ILIKE ${'%' + filters.q + '%'}`;

  if (filters.assignee) {
    query = sql`${query} AND EXISTS (
      SELECT 1 FROM workflow.tasks t
      WHERE t.instance_id = i.id AND t.assignee_id = ${filters.assignee}::uuid AND t.status = 'pending'
    )`;
  }

  if (filters.sla === "breached") {
    query = sql`${query} AND EXISTS (
      SELECT 1 FROM workflow.tasks t
      WHERE t.instance_id = i.id AND t.status = 'pending' AND t.due_at < NOW()
    )`;
  } else if (filters.sla === "at_risk") {
    query = sql`${query} AND EXISTS (
      SELECT 1 FROM workflow.tasks t
      WHERE t.instance_id = i.id AND t.status = 'pending'
        AND t.due_at IS NOT NULL AND t.due_at > NOW()
        AND t.due_at < NOW() + interval '24 hours'
    )`;
  } else if (filters.sla === "on_track") {
    query = sql`${query} AND NOT EXISTS (
      SELECT 1 FROM workflow.tasks t
      WHERE t.instance_id = i.id AND t.status = 'pending'
        AND t.due_at IS NOT NULL AND t.due_at < NOW() + interval '24 hours'
    )`;
  }

  query = sql`${query} ORDER BY i.created_at DESC LIMIT ${filters.limit} OFFSET ${filters.offset}`;

  const rows = (await db.execute(query)) as unknown as Array<{
    id: string; name: string; status: string; ref_type: string | null;
    ref_id: string | null; current_node: string | null;
    definition_id: string | null; created_at: Date; updated_at: Date;
    definition_code: string | null; definition_name: string | null;
  }>;

  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      refType: r.ref_type,
      refId: r.ref_id,
      currentNode: r.current_node,
      definitionId: r.definition_id,
      definitionCode: r.definition_code,
      definitionName: r.definition_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    pagination: { hasMore: rows.length === filters.limit, pageSize: filters.limit },
  };
}
