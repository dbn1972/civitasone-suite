/**
 * authoring/repo.ts — DB operations for AG-003 authored agent definitions.
 */
import { eq, and, sql, desc, ilike, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  agentAuthoringDefinitions,
  type AuthoringDefinitionRow,
  type AuthoringDefinitionInsert,
} from "./schema.js";

export function toView(r: AuthoringDefinitionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    description: r.description,
    systemPrompt: r.systemPrompt,
    tools: r.tools,
    modelConfig: r.modelConfig,
    status: r.status,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type AuthoringDefinitionView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<AuthoringDefinitionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(agentAuthoringDefinitions)
      .where(and(eq(agentAuthoringDefinitions.id, id), eq(agentAuthoringDefinitions.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Name lookup backs the UNIQUE (tenant_id, name) pre-check so the caller gets a 409, not a 500. */
export async function findByName(name: string, tenantId: string): Promise<AuthoringDefinitionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(agentAuthoringDefinitions)
      .where(and(eq(agentAuthoringDefinitions.name, name), eq(agentAuthoringDefinitions.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  status?: string;
  search?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: AuthoringDefinitionRow[]; total: number }> {
  const conditions: SQL[] = [eq(agentAuthoringDefinitions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(agentAuthoringDefinitions.status, filters.status));
  if (filters.search) conditions.push(ilike(agentAuthoringDefinitions.name, `%${filters.search}%`));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(agentAuthoringDefinitions)
      .where(where)
      .orderBy(desc(agentAuthoringDefinitions.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(agentAuthoringDefinitions).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: AuthoringDefinitionInsert): Promise<void> {
  await tx.insert(agentAuthoringDefinitions).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<AuthoringDefinitionInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(agentAuthoringDefinitions)
    .set({ ...patch, updatedAt: new Date(), version: sql`${agentAuthoringDefinitions.version} + 1` })
    .where(and(
      eq(agentAuthoringDefinitions.id, id),
      eq(agentAuthoringDefinitions.tenantId, tenantId),
      eq(agentAuthoringDefinitions.version, currentVersion),
    ))
    .returning({ id: agentAuthoringDefinitions.id });
  return result.length > 0;
}
