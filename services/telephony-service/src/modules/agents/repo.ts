/** agents repo — Drizzle queries against the `telephony` schema ONLY. */
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { agents, type AgentRow, type AgentInsert, type AgentView, type AgentStatus } from "./schema.js";

export function toView(r: AgentRow): AgentView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    displayName: r.displayName,
    queueId: r.queueId ?? null,
    status: r.status as AgentStatus,
    extension: r.extension ?? null,
    version: r.version,
  };
}


/**
 * Run a tenant-scoped READ inside a GUC transaction so forced RLS returns this
 * tenant's rows (wrapWithTenantGuc only sets app.tenant_id inside db.transaction()
 * and only when a tenant context is active). Without this a bare db.select() runs
 * with no GUC and RLS returns zero rows.
 */
function readScoped<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () =>
    db.transaction(fn as Parameters<typeof db.transaction>[0]),
  ) as Promise<T>;
}

export async function findById(id: string, tenantId: string): Promise<AgentView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx.select().from(agents).where(and(eq(agents.id, id), eq(agents.tenantId, tenantId))).limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByUser(userId: string, tenantId: string): Promise<AgentView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(agents)
      .where(and(eq(agents.userId, userId), eq(agents.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<AgentView[]> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(agents)
      .where(eq(agents.tenantId, tenantId))
      .orderBy(asc(agents.displayName))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toView);
}

/** Tenant-scoped existence check (cross-tenant ref guard for call assignment). */
export async function exists(tenantId: string, id: string): Promise<boolean> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select({ one: sql`1` })
      .from(agents)
      .where(and(eq(agents.tenantId, tenantId), eq(agents.id, id)))
      .limit(1),
  );
  return rows.length > 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: AgentInsert): Promise<void> {
  await tx.insert(agents).values(row);
}

/** Upsert on (tenant_id, user_id): create the agent or update presence/queue. */
export async function upsertByUser(
  tx: Writer,
  row: AgentInsert,
): Promise<void> {
  await (tx as typeof db)
    .insert(agents)
    .values(row)
    .onConflictDoUpdate({
      target: [agents.tenantId, agents.userId],
      set: {
        displayName: row.displayName,
        queueId: row.queueId ?? null,
        status: row.status ?? "offline",
        extension: row.extension ?? null,
        updatedAt: new Date(),
        updatedBy: row.updatedBy,
        version: sql`${agents.version} + 1`,
      },
    });
}

export async function setStatus(
  tx: Writer,
  id: string,
  tenantId: string,
  status: AgentStatus,
  expectedVersion: number | undefined,
  actorId: string,
): Promise<number> {
  const where = [eq(agents.id, id), eq(agents.tenantId, tenantId)];
  if (expectedVersion !== undefined) where.push(eq(agents.version, expectedVersion));
  const updated = await (tx as typeof db)
    .update(agents)
    .set({ status, updatedAt: new Date(), updatedBy: actorId, version: sql`${agents.version} + 1` })
    .where(and(...where))
    .returning({ id: agents.id });
  return updated.length;
}
