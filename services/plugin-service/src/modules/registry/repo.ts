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

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<PluginView[]> {
  const rows = await db.select().from(plugins).where(eq(plugins.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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
