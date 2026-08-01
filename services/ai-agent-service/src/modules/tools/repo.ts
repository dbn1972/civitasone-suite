/**
 * tools/repo.ts — DB operations for F.4 tool definitions and the ReAct trace.
 */
import { eq, and, sql, desc, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  toolDefinitions,
  reactSteps,
  type ToolDefinitionRow,
  type ToolDefinitionInsert,
  type ReactStepRow,
  type ReactStepInsert,
} from "./schema.js";

export function toView(r: ToolDefinitionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    agentDomain: r.agentDomain,
    toolName: r.toolName,
    description: r.description,
    inputSchema: r.inputSchema,
    requiresApproval: r.requiresApproval,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type ToolView = ReturnType<typeof toView>;

export function toStepView(r: ReactStepRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    agentId: r.agentId,
    orchestrationId: r.orchestrationId,
    toolId: r.toolId,
    stepNo: r.stepNo,
    thought: r.thought,
    action: r.action,
    actionInput: r.actionInput,
    observation: r.observation,
    status: r.status,
    executed: r.executed,
    occurredAt: r.occurredAt.toISOString(),
    version: r.version,
  };
}

export type ReactStepView = ReturnType<typeof toStepView>;

export async function findById(id: string, tenantId: string): Promise<ToolDefinitionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(toolDefinitions)
      .where(and(eq(toolDefinitions.id, id), eq(toolDefinitions.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Lookup by the business key — backs both the UNIQUE pre-check and ReAct resolution. */
export async function findByName(
  tenantId: string,
  agentDomain: string,
  toolName: string,
): Promise<ToolDefinitionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(toolDefinitions)
      .where(and(
        eq(toolDefinitions.tenantId, tenantId),
        eq(toolDefinitions.agentDomain, agentDomain),
        eq(toolDefinitions.toolName, toolName),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  agentDomain?: string;
  enabled?: boolean;
  requiresApproval?: boolean;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: ToolDefinitionRow[]; total: number }> {
  const conditions: SQL[] = [eq(toolDefinitions.tenantId, tenantId)];
  if (filters.agentDomain) conditions.push(eq(toolDefinitions.agentDomain, filters.agentDomain));
  if (filters.enabled !== undefined) conditions.push(eq(toolDefinitions.enabled, filters.enabled));
  if (filters.requiresApproval !== undefined) {
    conditions.push(eq(toolDefinitions.requiresApproval, filters.requiresApproval));
  }
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(toolDefinitions)
      .where(where)
      .orderBy(asc(toolDefinitions.agentDomain), asc(toolDefinitions.toolName))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(toolDefinitions).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: ToolDefinitionInsert): Promise<void> {
  await tx.insert(toolDefinitions).values(row);
}

/**
 * Bulk seed that skips tools the tenant already has, so seeding is idempotent
 * and never overwrites a tenant's own edits to a default tool.
 */
export async function insertManyIgnoreConflicts(
  tx: ScopedTx,
  rows: ToolDefinitionInsert[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await tx
    .insert(toolDefinitions)
    .values(rows)
    .onConflictDoNothing({
      target: [toolDefinitions.tenantId, toolDefinitions.agentDomain, toolDefinitions.toolName],
    })
    .returning({ id: toolDefinitions.id });
  return result.length;
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<ToolDefinitionInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(toolDefinitions)
    .set({ ...patch, updatedAt: new Date(), version: sql`${toolDefinitions.version} + 1` })
    .where(and(
      eq(toolDefinitions.id, id),
      eq(toolDefinitions.tenantId, tenantId),
      eq(toolDefinitions.version, currentVersion),
    ))
    .returning({ id: toolDefinitions.id });
  return result.length > 0;
}

export async function insertStep(tx: ScopedTx, row: ReactStepInsert): Promise<void> {
  await tx.insert(reactSteps).values(row);
}

export async function countSteps(tenantId: string, agentId: string): Promise<number> {
  const result = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(reactSteps)
      .where(and(eq(reactSteps.tenantId, tenantId), eq(reactSteps.agentId, agentId))),
  );
  return result[0]?.count ?? 0;
}

export async function listSteps(
  tenantId: string,
  agentId: string,
  limit: number,
  offset: number,
): Promise<{ rows: ReactStepRow[]; total: number }> {
  const where = and(eq(reactSteps.tenantId, tenantId), eq(reactSteps.agentId, agentId));

  const rows = await scopedRead((tx) =>
    tx.select().from(reactSteps)
      .where(where)
      .orderBy(desc(reactSteps.occurredAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(reactSteps).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}
