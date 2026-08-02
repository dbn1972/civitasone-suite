/**
 * events/taxonomy-version-repo.ts — CR-CDP-03 database operations for versioned event
 * schemas. Mirrors taxonomy-repo.ts: scopedRead for reads, caller's transaction for writes.
 */
import { eq, and, sql, asc, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  eventTaxonomyVersions,
  type EventTaxonomyVersionRow,
  type EventTaxonomyVersionInsert,
} from "./schema.js";

export function toView(r: EventTaxonomyVersionRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    taxonomyId: r.taxonomyId,
    schemaVersion: r.schemaVersion,
    schemaJson: r.schemaJson,
    status: r.status,
    notes: r.notes,
    activatedAt: r.activatedAt === null ? null : r.activatedAt.toISOString(),
    deprecatedAt: r.deprecatedAt === null ? null : r.deprecatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type TaxonomyVersionView = ReturnType<typeof toView>;

/** Every revision of one event's schema, oldest first. */
export async function listByTaxonomy(
  taxonomyId: string,
  tenantId: string,
): Promise<EventTaxonomyVersionRow[]> {
  return scopedRead((tx) =>
    tx.select().from(eventTaxonomyVersions)
      .where(and(
        eq(eventTaxonomyVersions.taxonomyId, taxonomyId),
        eq(eventTaxonomyVersions.tenantId, tenantId),
      ))
      .orderBy(asc(eventTaxonomyVersions.schemaVersion)),
  );
}

/** Paginated view of the revisions of one event's schema, newest first. */
export async function listPaged(
  taxonomyId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: EventTaxonomyVersionRow[]; total: number }> {
  const where = and(
    eq(eventTaxonomyVersions.taxonomyId, taxonomyId),
    eq(eventTaxonomyVersions.tenantId, tenantId),
  );

  const rows = await scopedRead((tx) =>
    tx.select().from(eventTaxonomyVersions)
      .where(where)
      .orderBy(desc(eventTaxonomyVersions.schemaVersion))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(eventTaxonomyVersions).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function findByVersionNumber(
  taxonomyId: string,
  schemaVersion: number,
  tenantId: string,
): Promise<EventTaxonomyVersionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(eventTaxonomyVersions)
      .where(and(
        eq(eventTaxonomyVersions.taxonomyId, taxonomyId),
        eq(eventTaxonomyVersions.schemaVersion, schemaVersion),
        eq(eventTaxonomyVersions.tenantId, tenantId),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function insert(tx: ScopedTx, row: EventTaxonomyVersionInsert): Promise<void> {
  await tx.insert(eventTaxonomyVersions).values(row);
}

/** Optimistic-locked status change. */
export async function setStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: { status: string; activatedAt?: Date; deprecatedAt?: Date; updatedBy: string },
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(eventTaxonomyVersions)
    .set({ ...patch, updatedAt: new Date(), version: sql`${eventTaxonomyVersions.version} + 1` })
    .where(and(
      eq(eventTaxonomyVersions.id, id),
      eq(eventTaxonomyVersions.tenantId, tenantId),
      eq(eventTaxonomyVersions.version, currentVersion),
    ))
    .returning({ id: eventTaxonomyVersions.id });
  return result.length > 0;
}

/**
 * Retire whichever revision is currently active for this event.
 *
 * Not optimistic-locked, deliberately: this runs in the same transaction as the
 * activation that supersedes it, and the row it targets is identified by state
 * (`status = 'active'`) rather than by a version the caller read earlier. Failing here on
 * a stale counter would abort a legitimate activation for no safety gain — the unique
 * "one active per event" outcome is what matters and is achieved either way.
 */
export async function deprecateActive(
  tx: ScopedTx,
  taxonomyId: string,
  tenantId: string,
  exceptId: string,
  actorId: string,
): Promise<number> {
  const result = await tx
    .update(eventTaxonomyVersions)
    .set({
      status: "deprecated",
      deprecatedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${eventTaxonomyVersions.version} + 1`,
    })
    .where(and(
      eq(eventTaxonomyVersions.taxonomyId, taxonomyId),
      eq(eventTaxonomyVersions.tenantId, tenantId),
      eq(eventTaxonomyVersions.status, "active"),
      sql`${eventTaxonomyVersions.id} <> ${exceptId}`,
    ))
    .returning({ id: eventTaxonomyVersions.id });
  return result.length;
}
