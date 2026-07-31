/**
 * copilot/repo.ts — Database operations for copilot turns.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { copilotTurns, type CopilotTurnRow, type CopilotTurnInsert } from "./schema.js";

export function toView(r: CopilotTurnRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    prompt: r.prompt,
    response: r.response,
    sourceCitations: r.sourceCitations ?? [],
    model: r.model,
    tokens: r.tokens,
    latencyMs: r.latencyMs,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type CopilotTurnView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<CopilotTurnRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(copilotTurns)
      .where(and(eq(copilotTurns.id, id), eq(copilotTurns.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  userId?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: CopilotTurnRow[]; total: number }> {
  const conditions: SQL[] = [eq(copilotTurns.tenantId, tenantId)];
  if (filters.userId) conditions.push(eq(copilotTurns.userId, filters.userId));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(copilotTurns)
      .where(where)
      .orderBy(desc(copilotTurns.createdAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(copilotTurns).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: CopilotTurnInsert): Promise<void> {
  await tx.insert(copilotTurns).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<CopilotTurnInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(copilotTurns)
    .set({ ...patch, updatedAt: new Date(), version: sql`${copilotTurns.version} + 1` })
    .where(and(
      eq(copilotTurns.id, id),
      eq(copilotTurns.tenantId, tenantId),
      eq(copilotTurns.version, currentVersion),
    ))
    .returning({ id: copilotTurns.id });
  return result.length > 0;
}
