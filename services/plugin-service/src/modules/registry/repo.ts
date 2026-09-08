import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { plugins, type PluginRow, type PluginInsert, type PluginView, type PluginState } from "./schema.js";

function toView(r: PluginRow): PluginView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    manifestJson: r.manifestJson as Record<string, unknown>,
    state: r.state as PluginState,
    installedAt: r.installedAt?.toISOString() ?? null,
    enabledAt: r.enabledAt?.toISOString() ?? null,
    disabledAt: r.disabledAt?.toISOString() ?? null,
    config: r.config as Record<string, unknown> | null,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<PluginView | null> {
  const rows = await db.select().from(plugins).where(eq(plugins.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * TX-003 — tenant-scoped sibling of findById(). registry.plugins is under
 * FORCE ROW LEVEL SECURITY (0003b, 0004) and plugin_svc is NOBYPASSRLS, so a
 * bare `db.select()` carries no `app.tenant_id` GUC and always returns zero
 * rows, even for a plugin that genuinely exists. `db.transaction()` sets that
 * GUC on the transaction handle it hands back (wrapWithTenantGuc, from the
 * ambient tenant context established by worker.ts's runWithTenant() around
 * every consumer invocation) — so a read must go through that same `tx`
 * handle to see anything under FORCE RLS. Route every read that happens
 * inside an already-open consumer transaction through this, not findById().
 */
export async function findByIdTx(tx: Writer, id: string, tenantId: string): Promise<PluginView | null> {
  const rows = await tx.select().from(plugins).where(eq(plugins.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<PluginView[]> {
  const rows = await db.select().from(plugins).where(eq(plugins.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export async function insert(tx: Writer, row: PluginInsert): Promise<void> {
  await tx.insert(plugins).values(row);
}

export async function updateState(tx: Writer, id: string, state: PluginState, actorId: string): Promise<void> {
  const now = new Date();
  const timestampField = state === "enabled" ? { enabledAt: now } : state === "disabled" ? { disabledAt: now } : {};
  await tx.update(plugins).set({ state, updatedBy: actorId, updatedAt: now, ...timestampField }).where(eq(plugins.id, id));
}

export async function updateConfig(tx: Writer, id: string, config: Record<string, unknown>, actorId: string): Promise<void> {
  await tx.update(plugins).set({ config, updatedBy: actorId, updatedAt: new Date() }).where(eq(plugins.id, id));
}

export { toView };
