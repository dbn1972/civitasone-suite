// EVT-2 (04-T2): the transactional outbox/inbox is now a single shared package.
// This file re-exports @civitasone/outbox so existing imports
// (`../shared/outbox.js`) keep working without touching every call site.
//
// In ADDITION it provides `versionedUpdate` — the suite-wide optimistic-locking
// helper (every mutable entity carries a `version int`; a guarded UPDATE must
// include `WHERE version = $expected` and atomically bump it; a lost update
// surfaces as a 409 `VersionConflictError`). It lives here (rather than in the
// shared package) because it is only meaningful for this service's `visitor`
// schema entities, all of which carry the standard id/tenant_id/version columns.
// Identical in shape to court-service / meeting-service so call sites port 1:1.
import { and, eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { DrizzleTx } from "@civitasone/outbox";

export * from "@civitasone/outbox";

/**
 * Thrown when a version-guarded UPDATE matches zero rows — i.e. the row was
 * modified (or deleted) concurrently since the caller read `expectedVersion`.
 * Carries `httpStatus = 409` so a route/error layer can map it to a Conflict.
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

/** A Drizzle table carrying the standard mutable-entity columns. */
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
 * in the same statement. If no row matches (concurrent modification, wrong
 * tenant, or missing row) it throws {@link VersionConflictError} so the caller
 * does not silently lose an update or emit a duplicate downstream event.
 *
 * MUST be called inside the consumer's `db.transaction()` (same tx as the outbox
 * enqueue) so the version bump and the emitted event commit together — on
 * conflict the whole transaction (including the enqueue) rolls back.
 */
export async function versionedUpdate<TTable extends VersionedTable>(
  tx: DrizzleTx,
  table: TTable,
  args: {
    id: string;
    tenantId: string;
    expectedVersion: number;
    set: PgUpdateSetSource<TTable>;
    /** Human label used in the conflict error message (e.g. "visit_request"). */
    entity?: string;
  },
): Promise<void> {
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
