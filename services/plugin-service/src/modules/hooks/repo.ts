import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { pluginHooks, type PluginHookRow, type PluginHookInsert, type PluginHookView } from "./schema.js";

function toView(r: PluginHookRow): PluginHookView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    pluginId: r.pluginId,
    eventType: r.eventType,
    handlerPath: r.handlerPath,
    active: r.active,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<PluginHookView | null> {
  const rows = await db.select().from(pluginHooks).where(eq(pluginHooks.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<PluginHookView[]> {
  const rows = await db.select().from(pluginHooks).where(eq(pluginHooks.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: PluginHookInsert): Promise<void> {
  await tx.insert(pluginHooks).values(row);
}

export async function deactivate(tx: Writer, id: string, actorId: string): Promise<void> {
  await tx.update(pluginHooks).set({ active: false, updatedBy: actorId, updatedAt: new Date() }).where(eq(pluginHooks.id, id));
}

export { toView };
