import { eq, and, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { configEntries } from "./schema.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type ConfigEntryRow    = typeof configEntries.$inferSelect;
export type ConfigEntryInsert = typeof configEntries.$inferInsert;

// ─── Writes (used by the consumer, inside the handler's db.transaction) ──────────

export async function insertConfig(tx: Writer, row: ConfigEntryInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(configEntries).values(row).onConflictDoNothing({ target: configEntries.id });
}

/**
 * Read the current (version, active, namespace) of a config entry for a
 * version-guarded update. Runs on the caller's `tx` (inside the handler
 * transaction) so it sees the same GUC-scoped connection as the subsequent
 * write. `namespace` is returned so the deactivate path can invalidate the
 * correct (tenant, namespace) read cache without a second round-trip.
 */
export async function getConfigForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ version: number; active: boolean; namespace: string } | undefined> {
  const rows = await tx.select({
    version: configEntries.version,
    active: configEntries.active,
    namespace: configEntries.namespace,
  })
    .from(configEntries)
    .where(and(eq(configEntries.tenantId, tenantId), eq(configEntries.id, id)))
    .limit(1);
  return rows[0];
}

/**
 * List the ACTIVE config keys for a (tenant, namespace) on the caller's tx
 * (inside the handler transaction) so a consumer can validate a value against
 * tenant configuration on the same GUC-scoped connection. Used by the config/
 * metadata engine (§47) — e.g. court-registry validates courtType.
 */
export async function listActiveKeys(
  tx: Writer, tenantId: string, namespace: string,
): Promise<string[]> {
  const rows = await tx.select({ configKey: configEntries.configKey })
    .from(configEntries)
    .where(and(
      eq(configEntries.tenantId, tenantId),
      eq(configEntries.namespace, namespace),
      eq(configEntries.active, true),
    ));
  return rows.map((r) => r.configKey);
}

/**
 * Read one ACTIVE config entry's JSONB value on the caller's tx (for consumers
 * that resolve config within their handler transaction, e.g. filing fees).
 * Undefined if there is no active entry for (tenant, namespace, key).
 */
export async function getConfigValueOnTx(
  tx: Writer, tenantId: string, namespace: string, configKey: string,
): Promise<unknown | undefined> {
  const rows = await tx.select({ value: configEntries.value })
    .from(configEntries)
    .where(and(
      eq(configEntries.tenantId, tenantId),
      eq(configEntries.namespace, namespace),
      eq(configEntries.configKey, configKey),
      eq(configEntries.active, true),
    ))
    .limit(1);
  return rows[0]?.value;
}

// ─── Reads (used by routes) — via scopedRead so RLS is enforced on the read path ─

export async function listByNamespace(
  tenantId: string, namespace: string, activeOnly: boolean,
): Promise<ConfigEntryRow[]> {
  const predicates = [eq(configEntries.tenantId, tenantId), eq(configEntries.namespace, namespace)];
  if (activeOnly) predicates.push(eq(configEntries.active, true));
  return scopedRead((tx) => tx.select().from(configEntries)
    .where(and(...predicates))
    .orderBy(asc(configEntries.sortOrder), asc(configEntries.configKey)));
}

export async function getConfig(
  tenantId: string, namespace: string, configKey: string,
): Promise<ConfigEntryRow | undefined> {
  const rows = await scopedRead<ConfigEntryRow[]>((tx) => tx.select().from(configEntries)
    .where(and(
      eq(configEntries.tenantId, tenantId),
      eq(configEntries.namespace, namespace),
      eq(configEntries.configKey, configKey),
    ))
    .limit(1));
  return rows[0];
}
