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
  return scopedRead((tx) => findOfferTx(tx, tenantId, id));
}

/**
 * Tx-scoped variant of findOffer -- see .claude/skills/16-production-readiness-audit.md section 1.
 *
 * `forUpdate` takes a row lock (SELECT ... FOR UPDATE) for the rest of the write
 * transaction. Every offer state transition in the F3 consumer reads this way and
 * then checks the expected SOURCE status on the locked row before writing: the
 * route's own status check ran against a read that can be stale by the time the
 * queued write runs (a duplicate click, a redelivered or late command), so it
 * cannot be the only guard. Concurrent writers serialise on the lock, so the
 * status the guard saw is the status the UPDATE overwrites (UAT B9-hrms1).
 */
export async function findOfferTx(
  tx: Writer, tenantId: string, id: string, opts: { forUpdate?: boolean } = {},
): Promise<OfferRow | null> {
  const q = (tx as typeof db).select().from(hrmsOffers)
    .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsOffers.id, id))).limit(1);
  const rows = opts.forUpdate ? await q.for("update") : await q;
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
  return scopedRead((tx) => maxOfferVersionTx(tx, tenantId, applicationId));
}

/** Tx-scoped variant of maxOfferVersion -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function maxOfferVersionTx(tx: Writer, tenantId: string, applicationId: string): Promise<number> {
  const rows = await (tx as typeof db)
    .select({ m: sql<number>`COALESCE(MAX(${hrmsOffers.offerVersion}), 0)` })
    .from(hrmsOffers)
    .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsOffers.applicationId, applicationId)));
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

/**
 * Has this actor already recorded an "approve" on this offer WITHIN the current
 * submission cycle? Enforces that each approval stage is cleared by a DISTINCT
 * person (segregation of duties), mirroring requisition-repo.ts's
 * actorAlreadyApproved. The cycle starts at the offer's latest "submit" event, so
 * a return -> correct -> resubmit starts afresh and an earlier approver is not
 * permanently barred from the corrected run. Tx-scoped so the F3 consumer can
 * re-check it inside the write transaction (the route's read can be stale).
 */
export async function actorApprovedInCurrentCycleTx(
  tx: Writer, tenantId: string, offerId: string, actorId: string,
): Promise<boolean> {
  const latestSubmit = sql`(SELECT MAX(s.created_at) FROM recruitment.hrms_offer_events s
    WHERE s.tenant_id = ${tenantId} AND s.offer_id = ${offerId} AND s.action = 'submit')`;
  const rows = await (tx as typeof db).select({ id: hrmsOfferEvents.id }).from(hrmsOfferEvents)
    .where(and(
      eq(hrmsOfferEvents.tenantId, tenantId),
      eq(hrmsOfferEvents.offerId, offerId),
      eq(hrmsOfferEvents.actorId, actorId),
      eq(hrmsOfferEvents.action, "approve"),
      sql`${hrmsOfferEvents.createdAt} >= COALESCE(${latestSubmit}, '-infinity'::timestamptz)`,
    ))
    .limit(1);
  return rows.length > 0;
}

export async function actorApprovedInCurrentCycle(
  tenantId: string, offerId: string, actorId: string,
): Promise<boolean> {
  return scopedRead((tx) => actorApprovedInCurrentCycleTx(tx, tenantId, offerId, actorId));
}
