/**
 * agents/repo.ts — Database operations for agent definitions.
 */
import { eq, and, sql, desc, ilike, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { agentDefinitions, type AgentDefinitionRow, type AgentDefinitionInsert } from "./schema.js";

export function toView(r: AgentDefinitionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    skills: r.skills,
    tools: r.tools,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type AgentView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<AgentDefinitionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, id), eq(agentDefinitions.tenantId, tenantId)))
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
): Promise<{ rows: AgentDefinitionRow[]; total: number }> {
  const conditions: SQL[] = [eq(agentDefinitions.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(agentDefinitions.status, filters.status));
  if (filters.search) conditions.push(ilike(agentDefinitions.name, `%${filters.search}%`));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(agentDefinitions)
      .where(where)
      .orderBy(desc(agentDefinitions.updatedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(agentDefinitions).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/** All non-archived agents in a tenant — used for handoff target selection. */
export async function listByStatus(tenantId: string, status: string): Promise<AgentDefinitionRow[]> {
  return scopedRead((tx) =>
    tx.select().from(agentDefinitions)
      .where(and(eq(agentDefinitions.tenantId, tenantId), eq(agentDefinitions.status, status)))
      .orderBy(desc(agentDefinitions.updatedAt)),
  );
}

export async function countByStatus(tenantId: string, status: string): Promise<number> {
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(agentDefinitions)
      .where(and(eq(agentDefinitions.tenantId, tenantId), eq(agentDefinitions.status, status))),
  );
  return countResult[0]?.count ?? 0;
}

export async function insert(tx: ScopedTx, row: AgentDefinitionInsert): Promise<void> {
  await tx.insert(agentDefinitions).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<AgentDefinitionInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(agentDefinitions)
    .set({ ...patch, updatedAt: new Date(), version: sql`${agentDefinitions.version} + 1` })
    .where(and(
      eq(agentDefinitions.id, id),
      eq(agentDefinitions.tenantId, tenantId),
      eq(agentDefinitions.version, currentVersion),
    ))
    .returning({ id: agentDefinitions.id });
  return result.length > 0;
}

/** Soft delete — agents are archived, never hard-deleted (audit retention). */
export async function archive(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  currentVersion: number,
  actorId: string,
): Promise<boolean> {
  const result = await tx
    .update(agentDefinitions)
    .set({
      status: "archived",
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${agentDefinitions.version} + 1`,
    })
    .where(and(
      eq(agentDefinitions.id, id),
      eq(agentDefinitions.tenantId, tenantId),
      eq(agentDefinitions.version, currentVersion),
    ))
    .returning({ id: agentDefinitions.id });
  return result.length > 0;
}
