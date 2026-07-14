/**
 * Silo_Provisioning_Record state machine — pure domain logic (no I/O, no side effects).
 *
 * Statuses (matches `install.silo_provisions.status`, migration `0005_silo_provisioning.sql`):
 *   requested → provisioning → ready
 *                            ↘ failed → provisioning (resume)
 *
 * Responsibilities:
 *   - `nextStatus`             — the single source of truth for legal status transitions.
 *     Illegal actions (wrong prior status, e.g. `retry` from `requested`, or any action once
 *     `ready`) are no-ops that return the current status unchanged rather than throwing, so the
 *     record can never be left in an undefined status regardless of the order or repetition of
 *     actions applied to it (Req 3.2, 3.8).
 *   - `migrationsConfirmed`    — true iff every required migration identifier has a matching
 *     entry in the record's `appliedMigrations` (Req 3.3, 3.6, 4.5).
 *   - `canTransitionToReady`   — whether a record may move to `ready`. Per Req 3.8 this depends
 *     *only* on `migrationsConfirmed`, never on how many times the record already passed through
 *     `provisioning`/`failed` beforehand.
 *   - `pendingMigrations`      — the resumable diff (`all` minus `applied`), used to re-apply
 *     only what has not already succeeded on a resumed/retried attempt (Req 3.6, 4.3).
 *
 * The actuator/consumer wiring (task 7.7) is responsible for the I/O around these pure
 * functions: recording the pre-transition status before flipping to `provisioning` (Req 3.2),
 * running `provisionSiloDatabase` against `pendingMigrations(...)`, and only patching the
 * Tenant_Registry `dbDsnRef` on an actual transition into `ready` (Req 4.2) — never on `failed`
 * or an intermediate no-op.
 *
 * _Requirements: 3.2, 3.3, 3.6, 3.8, 4.1, 4.2, 4.5_
 */

/** The four Silo_Provisioning_Record statuses (Req 3, `install.silo_provisions.status`). */
export const PROVISION_STATUSES = ["requested", "provisioning", "ready", "failed"] as const;
export type ProvisionStatus = (typeof PROVISION_STATUSES)[number];

/** True if `value` is a recognised Silo_Provisioning_Record status. */
export function isProvisionStatus(value: string): value is ProvisionStatus {
  return (PROVISION_STATUSES as readonly string[]).includes(value);
}

/**
 * Actions the actuator/worker drives the state machine with.
 *
 * `complete` carries the caller's `migrationsConfirmed` determination directly, rather than
 * `nextStatus` re-deriving it from a full record — this keeps `nextStatus` a plain
 * `(status, action) → status` function while still letting the `ready` transition depend
 * exactly on migration confirmation (Req 3.8), never on unconditionally trusting a "complete"
 * signal. When `migrationsConfirmed` is false, `complete` is a no-op: the record stays
 * `provisioning` so a subsequent retry/resume can finish applying the remaining migrations.
 */
export type ProvisionAction =
  | { type: "start" }
  | { type: "complete"; migrationsConfirmed: boolean }
  | { type: "fail" }
  | { type: "retry" };

/**
 * Pure Silo_Provisioning_Record status transition (Req 3.2, 3.8).
 *
 * Legal transitions:
 *   requested   + start                          → provisioning
 *   provisioning+ complete (migrationsConfirmed)  → ready
 *   provisioning+ fail                            → failed
 *   provisioning+ retry                            → provisioning  (idempotent resume of a
 *                                                                    stale in-flight attempt)
 *   failed      + retry                            → provisioning  (Req 4.3 resume)
 *
 * Every other `(status, action)` pair — including `complete` without migrations confirmed,
 * `retry` from `requested`, or any action once `ready` (Req 3.8, 4.5: `ready` is terminal and
 * only reachable via a confirmed `complete`) — is a no-op: the current status is returned
 * unchanged. This makes `nextStatus` total and safe to call with an out-of-order or repeated
 * action without ever producing an undefined/invalid status.
 */
export function nextStatus(current: ProvisionStatus, action: ProvisionAction): ProvisionStatus {
  switch (current) {
    case "requested":
      return action.type === "start" ? "provisioning" : current;
    case "provisioning":
      if (action.type === "complete") return action.migrationsConfirmed ? "ready" : current;
      if (action.type === "fail") return "failed";
      if (action.type === "retry") return "provisioning";
      return current;
    case "failed":
      return action.type === "retry" ? "provisioning" : current;
    case "ready":
      // Terminal: ready never re-processes, even if re-triggered (Req 3.8, design Property 6).
      return current;
  }
}

/** The minimal shape `migrationsConfirmed`/`canTransitionToReady` need from a provisioning record. */
export interface MigrationProgress {
  /** Every DB_Backed_Service migration identifier required for this tenant's silo database. */
  requiredMigrations: readonly string[];
  /** Migration identifiers already confirmed applied (`install.silo_provisions.applied_migrations`). */
  appliedMigrations: readonly string[];
}

/**
 * The migration identifiers in `all` not yet present in `applied` (Req 3.3, 3.6, 4.3) — the
 * resumable diff a retry/resume attempt re-applies. Preserves `all`'s original ordering;
 * duplicate `applied` entries and ordering within `applied` do not affect the result.
 */
export function pendingMigrations(all: readonly string[], applied: readonly string[]): string[] {
  const appliedSet = new Set(applied);
  return all.filter((id) => !appliedSet.has(id));
}

/**
 * True iff every required migration has been confirmed applied (Req 3.3, 3.6, 4.5) — i.e.
 * `pendingMigrations(requiredMigrations, appliedMigrations)` is empty.
 */
export function migrationsConfirmed(record: MigrationProgress): boolean {
  return pendingMigrations(record.requiredMigrations, record.appliedMigrations).length === 0;
}

/**
 * Whether a Silo_Provisioning_Record may transition to `ready` (Req 3.8, 4.5). Depends only on
 * `migrationsConfirmed` — never on the record's current status or how many times it already
 * passed through `provisioning`/`failed`, so a record that reaches full migration confirmation
 * is always eligible for `ready` regardless of its transition history.
 */
export function canTransitionToReady(record: MigrationProgress): boolean {
  return migrationsConfirmed(record);
}
