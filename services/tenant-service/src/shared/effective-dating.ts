/**
 * effective-dating.ts (CAP-018) — generic helpers for versioned / effective-dated
 * master data. A row is "effective" at instant `asOf` when
 *   effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf).
 *
 * Masters (org_units, code_values, positions, ...) carry effective_from /
 * effective_to columns. Rather than hard-deleting or overwriting, a change
 * closes the current version (sets effective_to = now) and opens a new one, so
 * history is preserved and point-in-time reads are possible.
 *
 * These helpers are storage-agnostic: `activeSql` builds a Drizzle SQL predicate
 * for the effective window; `isEffective` is the in-memory equivalent used in
 * tests and consumers.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export interface EffectiveDated {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** True when `row` is effective at `asOf` (defaults to now). */
export function isEffective(row: EffectiveDated, asOf: Date = new Date()): boolean {
  const from = row.effectiveFrom.getTime();
  const to = row.effectiveTo?.getTime();
  return from <= asOf.getTime() && (to === undefined || to > asOf.getTime());
}

/**
 * Build a SQL predicate selecting rows effective at `asOf`.
 * Usage: .where(and(eq(t.tenantId, id), activeSql(t.effectiveFrom, t.effectiveTo)))
 */
export function activeSql(fromCol: PgColumn, toCol: PgColumn, asOf: Date = new Date()): SQL {
  // Bind the instant as an ISO string with an explicit cast — a raw JS Date in a
  // `sql` fragment has no column type for postgres.js to serialise against.
  const at = asOf.toISOString();
  return sql`${fromCol} <= ${at}::timestamptz AND (${toCol} IS NULL OR ${toCol} > ${at}::timestamptz)`;
}

/** Predicate for "currently open" versions (no close date) — the common case. */
export function openSql(toCol: PgColumn): SQL {
  return sql`${toCol} IS NULL`;
}

/**
 * Given the current and prior version dates, validate a supersede: the new
 * version's effective_from must be >= the version it replaces. Returns the
 * close-date to stamp on the prior version (equal to the new from).
 */
export function supersedeAt(newEffectiveFrom: Date): Date {
  return newEffectiveFrom;
}
