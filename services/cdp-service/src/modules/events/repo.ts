/**
 * events/repo.ts — Database operations for the event store.
 */
import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { eventStore, type EventStoreRow, type EventStoreInsert } from "./schema.js";

export function toView(r: EventStoreRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    profileId: r.profileId,
    eventType: r.eventType,
    payload: r.payload,
    occurredAt: r.occurredAt.toISOString(),
    ingestedAt: r.ingestedAt.toISOString(),
  };
}

export type EventView = ReturnType<typeof toView>;

/**
 * Insert a single event into the event store.
 */
export async function insert(tx: ScopedTx, row: EventStoreInsert): Promise<void> {
  await tx.insert(eventStore).values(row);
}

/**
 * Insert a batch of events into the event store.
 */
export async function insertBatch(tx: ScopedTx, rows: EventStoreInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(eventStore).values(rows);
}

/**
 * List events for a profile with pagination and optional event type filter.
 */
export async function listByProfile(
  profileId: string,
  tenantId: string,
  limit: number,
  offset: number,
  eventType?: string,
): Promise<{ rows: EventStoreRow[]; total: number }> {
  const conditions: SQL[] = [
    eq(eventStore.profileId, profileId),
    eq(eventStore.tenantId, tenantId),
  ];
  if (eventType) {
    conditions.push(eq(eventStore.eventType, eventType));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(eventStore)
      .where(where)
      .orderBy(desc(eventStore.occurredAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(eventStore).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

/**
 * Move every stored event from one profile to another. Returns the number moved.
 *
 * CR-CDP-04 identity stitching: the events a visitor generated before authenticating are
 * the same person's events. They are re-pointed rather than copied — a copy would double
 * every behavioural count the profile is segmented on, and leaving them behind would hide
 * the pre-login journey that makes the stitch worth doing.
 */
export async function reassignProfile(
  tx: ScopedTx,
  fromProfileId: string,
  toProfileId: string,
  tenantId: string,
): Promise<number> {
  const result = await tx
    .update(eventStore)
    .set({ profileId: toProfileId })
    .where(and(eq(eventStore.profileId, fromProfileId), eq(eventStore.tenantId, tenantId)))
    .returning({ id: eventStore.id });
  return result.length;
}

/**
 * Get timeline events for a profile (consolidated interaction timeline).
 */
export async function getTimeline(
  profileId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: EventStoreRow[]; total: number }> {
  return listByProfile(profileId, tenantId, limit, offset);
}
