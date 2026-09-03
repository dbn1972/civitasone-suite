import { and, desc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  configEntries,
  configVersions,
  configChangeRequests,
  type ConfigEntryRow,
  type ConfigEntryInsert,
  type ConfigVersionRow,
  type ConfigVersionInsert,
  type ConfigChangeRow,
  type ConfigChangeInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── entries ─────────────────────────────────────────────────────────────────

export async function listEntries(tenantId: string, limit: number): Promise<ConfigEntryRow[]> {
  return scopedRead((tx) => tx.select().from(configEntries)
    .where(eq(configEntries.tenantId, tenantId))
    .orderBy(configEntries.key)
    .limit(limit));
}

export async function findEntryByKey(tenantId: string, key: string): Promise<ConfigEntryRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(configEntries)
    .where(and(eq(configEntries.tenantId, tenantId), eq(configEntries.key, key)))
    .limit(1));
  return rows[0];
}

export async function findEntryByKeyTx(tx: Writer, tenantId: string, key: string): Promise<ConfigEntryRow | undefined> {
  const rows = await tx.select().from(configEntries)
    .where(and(eq(configEntries.tenantId, tenantId), eq(configEntries.key, key)))
    .limit(1);
  return rows[0];
}

export async function insertEntry(tx: Writer, row: ConfigEntryInsert): Promise<ConfigEntryRow> {
  const rows = await (tx.insert(configEntries).values(row) as unknown as { returning: () => Promise<ConfigEntryRow[]> }).returning();
  const created = rows[0];
  if (!created) throw new Error("insertEntry: no row returned");
  return created;
}

export async function updateEntry(tx: Writer, id: string, tenantId: string, patch: Partial<ConfigEntryInsert>): Promise<void> {
  await tx.update(configEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(configEntries.id, id), eq(configEntries.tenantId, tenantId)));
}

// ── versions (immutable history) ─────────────────────────────────────────────

export async function insertVersion(tx: Writer, row: ConfigVersionInsert): Promise<void> {
  await tx.insert(configVersions).values(row);
}

export async function listVersions(tenantId: string, key: string): Promise<ConfigVersionRow[]> {
  return scopedRead((tx) => tx.select().from(configVersions)
    .where(and(eq(configVersions.tenantId, tenantId), eq(configVersions.key, key)))
    .orderBy(desc(configVersions.version)));
}

// ── change requests (maker-checker) ──────────────────────────────────────────

export async function insertChange(tx: Writer, row: ConfigChangeInsert): Promise<ConfigChangeRow> {
  const rows = await (tx.insert(configChangeRequests).values(row) as unknown as { returning: () => Promise<ConfigChangeRow[]> }).returning();
  const created = rows[0];
  if (!created) throw new Error("insertChange: no row returned");
  return created;
}

export async function listChanges(tenantId: string, limit: number, status?: string): Promise<ConfigChangeRow[]> {
  return scopedRead((tx) => tx.select().from(configChangeRequests)
    .where(status
      ? and(eq(configChangeRequests.tenantId, tenantId), eq(configChangeRequests.status, status))
      : eq(configChangeRequests.tenantId, tenantId))
    .orderBy(desc(configChangeRequests.createdAt))
    .limit(limit));
}

export async function findChangeByIdTx(tx: Writer, id: string, tenantId: string): Promise<ConfigChangeRow | undefined> {
  const rows = await tx.select().from(configChangeRequests)
    .where(and(eq(configChangeRequests.id, id), eq(configChangeRequests.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

// Read-only (non-tx) lookup for the route layer's synchronous pre-accept
// checks (existence, status, maker-checker) — mirrors findChangeByIdTx but
// outside a transaction, since the route only needs to read before publishing
// the F3 command, never to write.
export async function findChangeById(id: string, tenantId: string): Promise<ConfigChangeRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(configChangeRequests)
    .where(and(eq(configChangeRequests.id, id), eq(configChangeRequests.tenantId, tenantId)))
    .limit(1));
  return rows[0];
}

export async function updateChange(tx: Writer, id: string, tenantId: string, patch: Partial<ConfigChangeInsert>): Promise<void> {
  await tx.update(configChangeRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(configChangeRequests.id, id), eq(configChangeRequests.tenantId, tenantId)));
}
