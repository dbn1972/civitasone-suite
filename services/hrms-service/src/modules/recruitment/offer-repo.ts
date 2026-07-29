import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsOffers, hrmsOfferEvents, hrmsApplications, type OfferEventRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type OfferRow = typeof hrmsOffers.$inferSelect;
type OfferInsert = typeof hrmsOffers.$inferInsert;
type ApplicationRow = typeof hrmsApplications.$inferSelect;

export async function findApplication(tenantId: string, id: string): Promise<ApplicationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsApplications)
    .where(and(eq(hrmsApplications.tenantId, tenantId), eq(hrmsApplications.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function insertOffer(tx: Writer, row: OfferInsert): Promise<void> {
  await tx.insert(hrmsOffers).values(row);
}

export async function findOffer(tenantId: string, id: string): Promise<OfferRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsOffers)
    .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsOffers.id, id))).limit(1));
  return rows[0] ?? null;
}

/** All offer versions for an application (newest first) — the version history. */
export async function listOffersForApplication(tenantId: string, applicationId: string): Promise<OfferRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsOffers)
    .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsOffers.applicationId, applicationId)))
    .orderBy(desc(hrmsOffers.offerVersion)));
}

/** Highest offer_version for an application (0 if none) — for the next revision. */
export async function maxOfferVersion(tenantId: string, applicationId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx
    .select({ m: sql<number>`COALESCE(MAX(${hrmsOffers.offerVersion}), 0)` })
    .from(hrmsOffers)
    .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsOffers.applicationId, applicationId))));
  return Number(rows[0]?.m ?? 0);
}

export async function updateOffer(
  tx: Writer, tenantId: string, id: string, patch: Partial<OfferInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsOffers)
    .set({ ...patch, version: sql`${hrmsOffers.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsOffers.id, id), eq(hrmsOffers.version, expectedVersion)));
  // postgres-js reports affected rows as .count, not .rowCount (see PR #254).
  const affected = (res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0;
  if (affected === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "offer was modified by another request; reload and retry");
  }
}

export async function insertEvent(
  tx: Writer,
  row: { tenantId: string; offerId: string; applicationId: string; action: string; reasonCode?: string | null; remarks?: string | null; actorId: string },
): Promise<void> {
  await tx.insert(hrmsOfferEvents).values({
    tenantId: row.tenantId, offerId: row.offerId, applicationId: row.applicationId,
    action: row.action, reasonCode: row.reasonCode ?? null, remarks: row.remarks ?? null, actorId: row.actorId,
  });
}

export async function listEvents(tenantId: string, offerId: string): Promise<OfferEventRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsOfferEvents)
    .where(and(eq(hrmsOfferEvents.tenantId, tenantId), eq(hrmsOfferEvents.offerId, offerId)))
    .orderBy(hrmsOfferEvents.createdAt));
}
