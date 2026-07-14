import { eq, and, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { configEntries } from "./schema.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type ConfigEntryRow    = typeof configEntries.$inferSelect;
export type ConfigEntryInsert = typeof configEntries.$inferInsert;

// ─── Writes (used by the consumer, inside the handler's db.transaction) ──────────

/** True for a Postgres unique/exclusion violation (SQLSTATE 23505 / 23P01). */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === "23505" || code === "23P01";
}

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
 * List the ACTIVE config keys for a (tenant, namespace) on the caller's tx.
 * Used by the effectiveAllowed pattern — e.g. visit-request resolves the
 * tenant's auto-approve visitor categories from the `visitor_approval` namespace.
 */
export async function listActiveKeys(
  tx: Writer, tenantId: string, namespace: string,
): Promise<string[]> {
  // Read-through cache under the config:<namespace> resource the consumer
  // invalidates on any config.set/deactivate (invalidateResourceAfterCommit).
  const cached = await cache.getOrLoad<string[]>(
    cache.makeKey(tenantId, `config:${namespace}`, "__active_keys__"),
    async () => {
      const rows = await tx.select({ configKey: configEntries.configKey })
        .from(configEntries)
        .where(and(
          eq(configEntries.tenantId, tenantId),
          eq(configEntries.namespace, namespace),
          eq(configEntries.active, true),
        ));
      return rows.map((r) => r.configKey);
    },
  );
  return cached ?? [];
}

/**
 * Read one ACTIVE config entry's JSONB value on the caller's tx. Returns the
 * documented DEFAULT-agnostic `undefined` when there is no active entry for
 * (tenant, namespace, key); typed callers in policy.ts substitute the default so
 * behavior is IDENTICAL when unconfigured. Mirrors court-service's getter.
 */
export async function getConfigValueOnTx(
  tx: Writer, tenantId: string, namespace: string, configKey: string,
): Promise<unknown | undefined> {
  // Read-through cache under the same config:<namespace> resource the consumer
  // invalidates. The value is wrapped so a genuinely-set value is cached while an
  // unset key returns null (not cached by getOrLoad) — so first-time config adds
  // are visible immediately.
  const cached = await cache.getOrLoad<{ v: unknown }>(
    cache.makeKey(tenantId, `config:${namespace}`, configKey),
    async () => {
      const rows = await tx.select({ value: configEntries.value })
        .from(configEntries)
        .where(and(
          eq(configEntries.tenantId, tenantId),
          eq(configEntries.namespace, namespace),
          eq(configEntries.configKey, configKey),
          eq(configEntries.active, true),
        ))
        .limit(1);
      const v = rows[0]?.value;
      return v === undefined ? null : { v };
    },
  );
  return cached ? cached.v : undefined;
}

// ─── Cross-tenant override load (used by the maintenance workers) ────────────────

/**
 * Load ALL active config values for a namespace across EVERY tenant in one query.
 *
 * The scheduled workers (dpdp purge, no-show, auto-reject, overstay, waiting-
 * reminder) scan cross-tenant through the BYPASSRLS `scannerDb` pool, then resolve
 * each candidate's per-tenant policy in the loop. Reading overrides here — once
 * per cycle, no per-tenant round-trips, NO cache (the worker process must always
 * see the freshest DB value the API just wrote) — returns a
 * Map<tenantId, Map<configKey, value>>. A tenant absent from the map (or a key it
 * never set) falls back to the module default, so behavior is unchanged when
 * unconfigured.
 *
 * `scanner` is the plain BYPASSRLS drizzle handle (shared/scanner-db.ts); the
 * cross-tenant read has NO tenant filter by design.
 */
export async function loadNamespaceOverrides(
  scanner: Pick<typeof db, "select">, namespace: string,
): Promise<Map<string, Map<string, unknown>>> {
  const rows = await scanner.select({
    tenantId: configEntries.tenantId,
    configKey: configEntries.configKey,
    value: configEntries.value,
  })
    .from(configEntries)
    .where(and(
      eq(configEntries.namespace, namespace),
      eq(configEntries.active, true),
    ));

  const byTenant = new Map<string, Map<string, unknown>>();
  for (const r of rows) {
    let m = byTenant.get(r.tenantId);
    if (!m) { m = new Map(); byTenant.set(r.tenantId, m); }
    m.set(r.configKey, r.value);
  }
  return byTenant;
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
