/**
 * CAP-052 — catalogue repository. All functions run against a tenant-scoped
 * transaction `tx` (see routes.ts → withTenantScope), so RLS is enforced by the
 * app.tenant_id GUC, not merely by the WHERE clauses.
 */
import { and, eq, desc, sql } from "drizzle-orm";
import { apiEntry, apiChangelog } from "./schema.js";
import type {
  ApiEntryRow,
  ApiEntryInsert,
  ApiChangelogRow,
  ApiChangelogInsert,
} from "./schema.js";

// drizzle tx is structurally the same query surface as `db`; kept loose so
// call sites don't need per-query generics.
export type Tx = {
  select: (...a: unknown[]) => any;
  insert: (...a: unknown[]) => any;
  update: (...a: unknown[]) => any;
  execute: (q: unknown) => Promise<unknown>;
};

export interface EntryFilter {
  status?: string | undefined;
  module?: string | undefined;
}

export async function listEntries(tx: Tx, tenantId: string, filter: EntryFilter = {}): Promise<ApiEntryRow[]> {
  const preds = [eq(apiEntry.tenantId, tenantId)];
  if (filter.status) preds.push(eq(apiEntry.status, filter.status));
  if (filter.module) preds.push(eq(apiEntry.module, filter.module));
  return (tx as any)
    .select()
    .from(apiEntry)
    .where(and(...preds))
    .orderBy(apiEntry.module, apiEntry.name, apiEntry.version) as Promise<ApiEntryRow[]>;
}

export async function getEntry(tx: Tx, tenantId: string, id: string): Promise<ApiEntryRow | undefined> {
  const rows = (await (tx as any)
    .select()
    .from(apiEntry)
    .where(and(eq(apiEntry.tenantId, tenantId), eq(apiEntry.id, id)))
    .limit(1)) as ApiEntryRow[];
  return rows[0];
}

export async function findByKey(
  tx: Tx,
  tenantId: string,
  key: { name: string; version: string; method: string; path: string },
): Promise<ApiEntryRow | undefined> {
  const rows = (await (tx as any)
    .select()
    .from(apiEntry)
    .where(
      and(
        eq(apiEntry.tenantId, tenantId),
        eq(apiEntry.name, key.name),
        eq(apiEntry.version, key.version),
        eq(apiEntry.method, key.method),
        eq(apiEntry.path, key.path),
      ),
    )
    .limit(1)) as ApiEntryRow[];
  return rows[0];
}

/**
 * Idempotent register/seed. On (tenant, name, version, method, path) conflict
 * the existing row's descriptive fields are refreshed but its lifecycle status
 * is preserved (a re-seed must never resurrect a deprecated/retired API).
 */
export async function upsertEntry(tx: Tx, insert: ApiEntryInsert): Promise<ApiEntryRow> {
  const rows = (await (tx as any)
    .insert(apiEntry)
    .values(insert)
    .onConflictDoUpdate({
      target: [apiEntry.tenantId, apiEntry.name, apiEntry.version, apiEntry.method, apiEntry.path],
      set: {
        module: insert.module,
        upstream: insert.upstream ?? null,
        owner: insert.owner ?? null,
        description: insert.description ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning()) as ApiEntryRow[];
  return rows[0]!;
}

export async function updateStatus(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: { status: string; deprecationDate?: string | null; sunsetDate?: string | null },
): Promise<ApiEntryRow | undefined> {
  const set: Record<string, unknown> = {
    status: patch.status,
    updatedAt: sql`now()`,
    rowVersion: sql`${apiEntry.rowVersion} + 1`,
  };
  if (patch.deprecationDate !== undefined) set.deprecationDate = patch.deprecationDate;
  if (patch.sunsetDate !== undefined) set.sunsetDate = patch.sunsetDate;
  const rows = (await (tx as any)
    .update(apiEntry)
    .set(set)
    .where(and(eq(apiEntry.tenantId, tenantId), eq(apiEntry.id, id)))
    .returning()) as ApiEntryRow[];
  return rows[0];
}

export async function insertChangelog(tx: Tx, entry: ApiChangelogInsert): Promise<void> {
  await (tx as any).insert(apiChangelog).values(entry);
}

export async function listChangelog(tx: Tx, tenantId: string, apiId: string): Promise<ApiChangelogRow[]> {
  return (tx as any)
    .select()
    .from(apiChangelog)
    .where(and(eq(apiChangelog.tenantId, tenantId), eq(apiChangelog.apiId, apiId)))
    .orderBy(desc(apiChangelog.createdAt)) as Promise<ApiChangelogRow[]>;
}
