/**
 * meeting-service — transactional outbox / inbox + optimistic-locking helper.
 *
 * EVT-2 (04-T2): the transactional outbox/inbox is a single shared package. This
 * file re-exports @civitasone/outbox so module call sites (`../shared/outbox.js`)
 * get the canonical `enqueue`, `markProcessed`, `startRelay`, `relayOnce`,
 * `purgeOutbox`, and the `outboxMessages`/`processed`/`outboxSchema` tables
 * without every service re-implementing (and diverging on) the pattern.
 *
 * Usage recap (CQRS + outbox, per steering):
 *   - Consumer handler = ONE db.transaction().
 *   - `markProcessed(tx, msg.messageId)` is the FIRST op in every handler; if it
 *     returns false the message was already processed → skip (idempotency).
 *   - Business write + `enqueue(tx, event)` happen in the SAME tx, so "DB
 *     committed ⇒ event will be delivered" with no dual-write hole.
 *   - `startRelay(db, queue)` runs in worker.ts to publish unsent outbox rows.
 *
 * In ADDITION to the shared package, this module provides `versionedUpdate` — a
 * version-guarded UPDATE helper implementing the suite-wide optimistic-locking
 * invariant (every mutable entity has a `version int`; UPDATE must include
 * `WHERE version = $current`; a lost update surfaces as a 409 Conflict). It lives
 * here (rather than in the shared package) because it is only meaningful for this
 * service's `meeting`-schema entities, all of which carry the standard
 * `id`/`tenant_id`/`version` columns.
 */
import { and, eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { DrizzleTx } from "@civitasone/outbox";

// Re-export the canonical outbox/inbox implementation (enqueue, markProcessed,
// startRelay, relayOnce, purgeOutbox, startOutboxPurge, outboxSchema, …).
export * from "@civitasone/outbox";

/**
 * Thrown when a version-guarded UPDATE matches zero rows — i.e. the row was
 * modified (or deleted) concurrently since the caller read `expectedVersion`.
 * Carries `httpStatus = 409` so the route/error layer can map it to a Conflict
 * response without leaking Postgres internals (steering: Concurrency & Data
 * Integrity → "On conflict → 409 Conflict response").
 */
export class VersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly httpStatus = 409;
  constructor(
    readonly entity: string,
    readonly id: string,
    readonly expectedVersion: number,
  ) {
    super(
      `Optimistic lock conflict on ${entity} (${id}): expected version ${expectedVersion}; ` +
        `the record was modified concurrently. Re-read the record and retry.`,
    );
    this.name = "VersionConflictError";
  }
}

/**
 * A Drizzle table carrying the standard mutable-entity columns. Every table in
 * the `meeting` schema except the append-only audit tables
 * (`meeting_state_transitions`, `minutes_versions`, `committee_terms_history`,
 * `action_progress`) satisfies this shape.
 */
type VersionedTable = PgTable & {
  id: PgColumn;
  tenantId: PgColumn;
  version: PgColumn;
};

/**
 * Version-guarded UPDATE for optimistic concurrency control.
 *
 * Applies `set` to the row identified by `(id, tenantId)` ONLY when its current
 * `version` equals `expectedVersion`, atomically bumping `version = version + 1`
 * in the same statement. The tenant predicate keeps the write inside the caller's
 * tenant even if RLS is not yet active on a given connection. If no row matches
 * (concurrent modification, wrong tenant, or missing row) it throws
 * {@link VersionConflictError} so the caller does not silently lose an update.
 *
 * MUST be called inside the consumer's `db.transaction()` (same tx as the outbox
 * enqueue) so the version bump and the emitted event commit together.
 *
 * @example
 * await db.transaction(async (tx) => {
 *   if (!(await markProcessed(tx, msg.messageId))) return;
 *   await versionedUpdate(tx, meetings, {
 *     id, tenantId, expectedVersion,
 *     set: { status: "scheduled", updatedBy: actorId, updatedAt: new Date() },
 *     entity: "meeting",
 *   });
 *   await enqueue(tx, meetingScheduledEvent);
 * });
 */
export async function versionedUpdate<TTable extends VersionedTable>(
  tx: DrizzleTx,
  table: TTable,
  args: {
    id: string;
    tenantId: string;
    expectedVersion: number;
    set: PgUpdateSetSource<TTable>;
    /** Human label used in the conflict error message (e.g. "meeting"). */
    entity?: string;
  },
): Promise<void> {
  // Callers never set `version` themselves; the helper owns the monotonic bump.
  const setWithVersionBump = {
    ...args.set,
    version: sql`${table.version} + 1`,
  } as PgUpdateSetSource<TTable>;

  const updated = await tx
    .update(table)
    .set(setWithVersionBump)
    .where(
      and(
        eq(table.id, args.id),
        eq(table.tenantId, args.tenantId),
        eq(table.version, args.expectedVersion),
      ),
    )
    .returning({ id: table.id });

  if (updated.length === 0) {
    throw new VersionConflictError(args.entity ?? "record", args.id, args.expectedVersion);
  }
}
