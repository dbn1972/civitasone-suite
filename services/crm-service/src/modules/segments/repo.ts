/**
 * Segment taxonomy reads + transactional writes (G5).
 *
 * Reads go through `scopedRead` so PostgreSQL RLS is enforced (a bare select on a
 * FORCE-RLS table returns zero rows). Writes take the caller's transaction so the
 * business row, the outbox event and the audit event commit together.
 */
import { eq, and, sql, asc, isNull } from "drizzle-orm";
import { pino } from "pino";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  segmentDefinitions,
  segmentSettings,
  type SegmentDefinitionRow,
  type SegmentDefinitionInsert,
  type SegmentDefinitionView,
  type SegmentSettingsRow,
  type SegmentSettingsView,
  type SegmentStatus,
  type SegmentGovernance,
} from "./schema.js";

const log = pino({ name: "crm-segments-repo" });

/**
 * Cache resource segments. Shared with commands.ts / consumer.ts / queries.ts so the
 * keys written and the prefixes invalidated cannot drift:
 * `crm:{tenant}:segment_definition*` and `crm:{tenant}:segment_settings*`.
 */
export const RESOURCE = "segment_definition";
export const SETTINGS_RESOURCE = "segment_settings";

export function toView(r: SegmentDefinitionRow): SegmentDefinitionView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    segmentCode: r.segmentCode,
    displayName: r.displayName,
    description: r.description ?? null,
    governance: r.governance as SegmentGovernance,
    priorityProducts: r.priorityProducts ?? [],
    primaryChannels: r.primaryChannels ?? [],
    status: r.status as SegmentStatus,
    versionNumber: r.versionNumber,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    deprecatedAt: r.deprecatedAt ? r.deprecatedAt.toISOString() : null,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toSettingsView(r: SegmentSettingsRow): SegmentSettingsView {
  return {
    tenantId: r.tenantId,
    enforceSegmentCatalogue: r.enforceSegmentCatalogue,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
  };
}

const live = () => isNull(segmentDefinitions.deletedAt);

export async function findByCode(tenantId: string, segmentCode: string): Promise<SegmentDefinitionView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(segmentDefinitions)
      .where(and(eq(segmentDefinitions.tenantId, tenantId), eq(segmentDefinitions.segmentCode, segmentCode), live()))
      .limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Includes soft-deleted rows. Used only by the create path: a `segmentCode` is a
 * stable machine key, so once retired it stays reserved — reinstating it must be a
 * deliberate publish of the existing row, never a fresh row with the same code and a
 * different meaning.
 */
export async function findByCodeIncludingDeleted(
  tenantId: string,
  segmentCode: string,
): Promise<SegmentDefinitionView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(segmentDefinitions)
      .where(and(eq(segmentDefinitions.tenantId, tenantId), eq(segmentDefinitions.segmentCode, segmentCode)))
      .limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export interface ListFilter {
  status?: SegmentStatus;
  governance?: SegmentGovernance;
}

export async function listByTenant(
  tenantId: string,
  page: number,
  pageSize: number,
  filter: ListFilter = {},
): Promise<{ rows: SegmentDefinitionView[]; total: number }> {
  const conds = [eq(segmentDefinitions.tenantId, tenantId), live()];
  if (filter.status) conds.push(eq(segmentDefinitions.status, filter.status));
  if (filter.governance) conds.push(eq(segmentDefinitions.governance, filter.governance));
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(segmentDefinitions)
      .where(and(...conds))
      .orderBy(asc(segmentDefinitions.segmentCode))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const counted = (await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(segmentDefinitions)
      .where(and(...conds))) as unknown as Array<{ total: number }>;
    return { rows: rows.map(toView), total: counted[0]?.total ?? 0 };
  });
}

/** Published codes for this tenant, ascending. The enforcement vocabulary. */
export async function listPublishedCodes(tenantId: string): Promise<string[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({ segmentCode: segmentDefinitions.segmentCode })
      .from(segmentDefinitions)
      .where(and(eq(segmentDefinitions.tenantId, tenantId), eq(segmentDefinitions.status, "published"), live()))
      .orderBy(asc(segmentDefinitions.segmentCode)),
  );
  return rows.map((r) => r.segmentCode);
}

async function loadSettings(tenantId: string): Promise<SegmentSettingsView> {
  const rows = await scopedRead((tx) =>
    tx.select().from(segmentSettings).where(eq(segmentSettings.tenantId, tenantId)).limit(1),
  );
  const row = rows[0];
  // No row = the default, and the default is OFF. A missing row must never be an
  // error: every tenant that existed before this table did has no row.
  if (!row) return { tenantId, enforceSegmentCatalogue: false, version: 0, updatedAt: null };
  return toSettingsView(row);
}

/**
 * The tenant's enforcement setting, read through Redis because it is consulted on the
 * classification hot path. Redis being unavailable must never fail a classification,
 * so a cache-layer error falls through to Postgres and logs WARN; a database error is
 * re-thrown untouched.
 */
export async function getSettings(tenantId: string): Promise<SegmentSettingsView> {
  let dbFailed = false;
  const loader = async (): Promise<SegmentSettingsView> => {
    try {
      return await loadSettings(tenantId);
    } catch (err) {
      dbFailed = true;
      throw err;
    }
  };
  try {
    const hit = await cache.getOrLoad<SegmentSettingsView>(
      cache.makeKey(tenantId, SETTINGS_RESOURCE, "current"),
      loader,
    );
    return hit ?? { tenantId, enforceSegmentCatalogue: false, version: 0, updatedAt: null };
  } catch (err) {
    if (dbFailed) throw err;
    log.warn({ err, tenantId }, "segment settings cache unavailable; read through to Postgres");
    return loadSettings(tenantId);
  }
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: SegmentDefinitionInsert): Promise<void> {
  await tx.insert(segmentDefinitions).values(row).onConflictDoNothing({
    target: [segmentDefinitions.tenantId, segmentDefinitions.segmentCode],
  });
}

export interface UpdatableFields {
  displayName?: string;
  description?: string | null;
  priorityProducts?: string[];
  primaryChannels?: string[];
}

/**
 * Guarded UPDATE with optimistic locking. Returns false when the row is gone, is
 * canonical, or the caller's `version` is stale — the consumer turns that into an
 * audited no-op rather than clobbering a concurrent edit.
 */
export async function updateWithVersion(
  tx: Writer,
  tenantId: string,
  segmentCode: string,
  expectedVersion: number,
  fields: UpdatableFields,
  actorId: string,
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${segmentDefinitions.version} + 1`,
  };
  if (fields.displayName !== undefined) patch.displayName = fields.displayName;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.priorityProducts !== undefined) patch.priorityProducts = fields.priorityProducts;
  if (fields.primaryChannels !== undefined) patch.primaryChannels = fields.primaryChannels;

  const result = await (tx as typeof db)
    .update(segmentDefinitions)
    .set(patch)
    .where(
      and(
        eq(segmentDefinitions.tenantId, tenantId),
        eq(segmentDefinitions.segmentCode, segmentCode),
        eq(segmentDefinitions.version, expectedVersion),
        // Defence in depth: the route refuses canonical rows with 422, and the
        // predicate here means a command forged onto the bus cannot edit one either.
        sql`${segmentDefinitions.governance} <> 'canonical'`,
        isNull(segmentDefinitions.deletedAt),
      ),
    )
    .returning({ id: segmentDefinitions.id });
  return result.length > 0;
}

/** draft|deprecated → published. Bumps the taxonomy revision and stamps publishedAt. */
export async function publish(tx: Writer, tenantId: string, segmentCode: string, actorId: string): Promise<boolean> {
  const result = await (tx as typeof db)
    .update(segmentDefinitions)
    .set({
      status: "published",
      publishedAt: new Date(),
      deprecatedAt: null,
      versionNumber: sql`${segmentDefinitions.versionNumber} + 1`,
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${segmentDefinitions.version} + 1`,
    })
    .where(
      and(
        eq(segmentDefinitions.tenantId, tenantId),
        eq(segmentDefinitions.segmentCode, segmentCode),
        sql`${segmentDefinitions.status} <> 'published'`,
        sql`${segmentDefinitions.governance} <> 'canonical'`,
        isNull(segmentDefinitions.deletedAt),
      ),
    )
    .returning({ id: segmentDefinitions.id });
  return result.length > 0;
}

/** published → deprecated. The definition stays readable; it stops being eligible. */
export async function deprecate(tx: Writer, tenantId: string, segmentCode: string, actorId: string): Promise<boolean> {
  const result = await (tx as typeof db)
    .update(segmentDefinitions)
    .set({
      status: "deprecated",
      deprecatedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${segmentDefinitions.version} + 1`,
    })
    .where(
      and(
        eq(segmentDefinitions.tenantId, tenantId),
        eq(segmentDefinitions.segmentCode, segmentCode),
        eq(segmentDefinitions.status, "published"),
        sql`${segmentDefinitions.governance} <> 'canonical'`,
        isNull(segmentDefinitions.deletedAt),
      ),
    )
    .returning({ id: segmentDefinitions.id });
  return result.length > 0;
}

/**
 * Soft-delete. Never a hard DELETE: contacts already classified with this code keep
 * their value (the free-text column is untouched by design), and the row is the only
 * record of what that code meant.
 */
export async function softDelete(tx: Writer, tenantId: string, segmentCode: string, actorId: string): Promise<boolean> {
  const result = await (tx as typeof db)
    .update(segmentDefinitions)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${segmentDefinitions.version} + 1`,
    })
    .where(
      and(
        eq(segmentDefinitions.tenantId, tenantId),
        eq(segmentDefinitions.segmentCode, segmentCode),
        sql`${segmentDefinitions.governance} <> 'canonical'`,
        isNull(segmentDefinitions.deletedAt),
      ),
    )
    .returning({ id: segmentDefinitions.id });
  return result.length > 0;
}

/** Upsert the per-tenant enforcement switch — replay-safe on the tenant_id primary key. */
export async function upsertSettings(
  tx: Writer,
  tenantId: string,
  enforceSegmentCatalogue: boolean,
  actorId: string,
): Promise<void> {
  await tx
    .insert(segmentSettings)
    .values({ tenantId, enforceSegmentCatalogue, updatedBy: actorId })
    .onConflictDoUpdate({
      target: [segmentSettings.tenantId],
      set: {
        enforceSegmentCatalogue,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${segmentSettings.version} + 1`,
      },
    });
}
