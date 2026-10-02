import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { hrmsDeputations, type DeputationRow } from "../deputation/schema.js";
import { hrmsPayProfiles, type PayProfileDbRow, type PayProfileInsert } from "./schema.js";
import { monthBounds, type DeputationTerms, type PayProfileRow } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export function toPayProfileRow(r: PayProfileDbRow): PayProfileRow {
  return {
    id: r.id,
    employeeId: r.employeeId,
    payProfile: r.payProfile,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    status: r.status,
    deputationId: r.deputationId,
    consolidatedMonthlyMinor: r.consolidatedMonthlyMinor,
    requestedBy: r.requestedBy,
    deputationTerms: r.deputationTerms ?? null,
  };
}

/**
 * The approved profile in force on `date` (YYYY-MM-DD) for one employee,
 * summarised for the employee-separated event. Reads through the caller's tx.
 */
export async function payProfileAtDateTx(tx: Writer, tenantId: string, employeeId: string, date: string): Promise<{
  profile: string; deputationDirection: string | null; consolidatedMonthlyMinor: string | null;
} | null> {
  const rows = await (tx as typeof db).select().from(hrmsPayProfiles)
    .where(and(
      eq(hrmsPayProfiles.tenantId, tenantId),
      eq(hrmsPayProfiles.employeeId, employeeId),
      eq(hrmsPayProfiles.status, "active"),
      lte(hrmsPayProfiles.effectiveFrom, date),
      or(isNull(hrmsPayProfiles.effectiveTo), gte(hrmsPayProfiles.effectiveTo, date)),
    )).limit(1);
  const row = rows[0];
  if (!row) return null;
  let direction: string | null = null;
  if (row.deputationId) {
    const dep = await (tx as typeof db).select({ direction: hrmsDeputations.direction }).from(hrmsDeputations)
      .where(and(eq(hrmsDeputations.tenantId, tenantId), eq(hrmsDeputations.id, row.deputationId))).limit(1);
    direction = dep[0]?.direction ?? null;
  }
  return {
    profile: row.payProfile,
    deputationDirection: direction,
    consolidatedMonthlyMinor: row.consolidatedMonthlyMinor == null ? null : row.consolidatedMonthlyMinor.toString(),
  };
}

export function toDeputationTerms(d: DeputationRow): DeputationTerms {
  return {
    id: d.id,
    employeeId: d.employeeId,
    status: d.status,
    direction: d.direction,
    payOption: d.payOption,
    stationType: d.stationType,
    parentCadre: d.parentCadre,
    parentOrganisation: d.parentOrganisation,
    parentPayLevel: d.parentPayLevel,
    parentBasicMinor: d.parentBasicMinor,
    postPayLevel: d.postPayLevel,
    postBasicMinor: d.postBasicMinor,
    allowanceMode: d.allowanceMode,
    deputationAllowanceMinor: d.deputationAllowanceMinor,
    foreignService: d.foreignService,
    parentPensionScheme: d.parentPensionScheme,
    daSource: d.daSource,
    parentDaRateBps: d.parentDaRateBps,
    tenureFrom: d.tenureFrom,
    tenureTo: d.tenureTo,
    repatriatedOn: d.repatriatedOn,
  };
}

/**
 * Does a LIVE (active -- open or historical -- or pending) pay profile point
 * at this deputation? Such a deputation's money terms are frozen (see
 * DeputationMoneyTerms). Reads through the given tx when one is open.
 */
export async function liveProfileReferencesDeputation(tx: Writer | null, tenantId: string, deputationId: string): Promise<boolean> {
  const q = (t: Writer) => (t as typeof db).select({ id: hrmsPayProfiles.id }).from(hrmsPayProfiles)
    .where(and(
      eq(hrmsPayProfiles.tenantId, tenantId),
      eq(hrmsPayProfiles.deputationId, deputationId),
      inArray(hrmsPayProfiles.status, ["active", "pending"]),
    )).limit(1);
  const rows = tx ? await q(tx) : await scopedRead((t) => q(t as unknown as Writer));
  return rows.length > 0;
}

export async function listByEmployee(tenantId: string, employeeId: string): Promise<PayProfileDbRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsPayProfiles)
    .where(and(eq(hrmsPayProfiles.tenantId, tenantId), eq(hrmsPayProfiles.employeeId, employeeId)))
    .orderBy(desc(hrmsPayProfiles.effectiveFrom), desc(hrmsPayProfiles.createdAt))
    .limit(200));
}

export async function findById(tenantId: string, id: string): Promise<PayProfileDbRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsPayProfiles)
    .where(and(eq(hrmsPayProfiles.tenantId, tenantId), eq(hrmsPayProfiles.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listPending(tenantId: string, limit = 200): Promise<PayProfileDbRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsPayProfiles)
    .where(and(eq(hrmsPayProfiles.tenantId, tenantId), eq(hrmsPayProfiles.status, "pending")))
    .orderBy(asc(hrmsPayProfiles.createdAt))
    .limit(limit));
}

export async function findDeputation(tenantId: string, id: string): Promise<DeputationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsDeputations)
    .where(and(eq(hrmsDeputations.tenantId, tenantId), eq(hrmsDeputations.id, id))).limit(1));
  return rows[0] ?? null;
}

// ── consumer (tx-scoped) ───────────────────────────────────────────────────

export async function findByIdTx(tx: Writer, tenantId: string, id: string): Promise<PayProfileDbRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsPayProfiles)
    .where(and(eq(hrmsPayProfiles.tenantId, tenantId), eq(hrmsPayProfiles.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function findDeputationTx(tx: Writer, tenantId: string, id: string): Promise<DeputationRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsDeputations)
    .where(and(eq(hrmsDeputations.tenantId, tenantId), eq(hrmsDeputations.id, id))).limit(1);
  return rows[0] ?? null;
}

/** Active rows of one employee, locked FOR UPDATE so two approvals serialise. */
export async function listActiveByEmployeeForUpdateTx(tx: Writer, tenantId: string, employeeId: string): Promise<PayProfileDbRow[]> {
  return (tx as typeof db).select().from(hrmsPayProfiles)
    .where(and(
      eq(hrmsPayProfiles.tenantId, tenantId),
      eq(hrmsPayProfiles.employeeId, employeeId),
      eq(hrmsPayProfiles.status, "active"),
    ))
    .for("update");
}

export async function insertTx(tx: Writer, row: PayProfileInsert): Promise<void> {
  await tx.insert(hrmsPayProfiles).values(row);
}

/** Optimistic-locked update of one row (version guard), 409 on a lost race. */
export async function updateTx(
  tx: Writer, tenantId: string, id: string, patch: Partial<PayProfileInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsPayProfiles)
    .set({ ...patch, version: sql`${hrmsPayProfiles.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsPayProfiles.tenantId, tenantId),
      eq(hrmsPayProfiles.id, id),
      eq(hrmsPayProfiles.version, expectedVersion),
    ));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "pay profile was modified concurrently; reload and retry");
  }
}

// ── payroll-input feed ─────────────────────────────────────────────────────

export interface PayProfileFeedInputs {
  /** ACTIVE profile rows overlapping the month, by employee. */
  profilesByEmployee: Map<string, PayProfileRow[]>;
  /** Deputations referenced by those rows, plus every ACTIVE deputation. */
  deputationsById: Map<string, DeputationTerms>;
  /** The ACTIVE deputation of each employee that has one. */
  activeDeputationByEmployee: Map<string, DeputationTerms>;
}

/**
 * Two batched reads for the whole tenant (never per employee): approved
 * profile rows overlapping `month`, then the deputations those rows point at
 * together with every currently-active deputation (for advisories).
 * Sequential, not Promise.all -- see loadTypeResolver's note on concurrent
 * tenant transactions over the pooled connection.
 */
export async function loadPayProfileFeedInputs(tenantId: string, month: string): Promise<PayProfileFeedInputs> {
  const { start, end } = monthBounds(month);
  const profileRows = await scopedRead((tx) => tx.select().from(hrmsPayProfiles)
    .where(and(
      eq(hrmsPayProfiles.tenantId, tenantId),
      eq(hrmsPayProfiles.status, "active"),
      lte(hrmsPayProfiles.effectiveFrom, end),
      or(isNull(hrmsPayProfiles.effectiveTo), gte(hrmsPayProfiles.effectiveTo, start)),
    )));
  const profilesByEmployee = new Map<string, PayProfileRow[]>();
  const depIds = new Set<string>();
  for (const r of profileRows) {
    const list = profilesByEmployee.get(r.employeeId) ?? [];
    list.push(toPayProfileRow(r));
    profilesByEmployee.set(r.employeeId, list);
    if (r.deputationId) depIds.add(r.deputationId);
  }
  const depRows = await scopedRead((tx) => tx.select().from(hrmsDeputations)
    .where(and(
      eq(hrmsDeputations.tenantId, tenantId),
      depIds.size > 0
        ? or(eq(hrmsDeputations.status, "active"), inArray(hrmsDeputations.id, [...depIds]))
        : eq(hrmsDeputations.status, "active"),
    )));
  const deputationsById = new Map<string, DeputationTerms>();
  const activeDeputationByEmployee = new Map<string, DeputationTerms>();
  for (const d of depRows) {
    const t = toDeputationTerms(d);
    deputationsById.set(d.id, t);
    if (d.status === "active") activeDeputationByEmployee.set(d.employeeId, t);
  }
  return { profilesByEmployee, deputationsById, activeDeputationByEmployee };
}
