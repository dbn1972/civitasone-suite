/**
 * outcomes module — persistence (G18).
 *
 * Every read goes through {@link scopedRead} so the RLS GUC is set (a bare select on a
 * FORCE-RLS table returns zero rows), and every catalogue read widens the tenant predicate
 * to include the PLATFORM sentinel tenant: canonical codes are national, so a tenant must
 * be able to use them without owning a copy. The RLS policy in migration 0089 permits
 * exactly that widening and nothing more.
 *
 * Writes take the CALLER's transaction. They are only ever called from the consumer, so the
 * business write, the outbox event and the inbox row commit or roll back together.
 */
import { eq, and, or, asc, desc, isNull, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  outcomeReasonCodes,
  interactionOutcomes,
  PLATFORM_TENANT_ID,
  type Governance,
  type OutcomeType,
  type SubjectType,
  type OutcomeReasonCodeRow,
  type OutcomeReasonCodeInsert,
  type OutcomeReasonCodeView,
  type InteractionOutcomeRow,
  type InteractionOutcomeInsert,
  type InteractionOutcomeView,
} from "./schema.js";

/** Cache resource segments. Shared with queries.ts + consumer.ts so keys cannot drift. */
export const REASON_CODE_RESOURCE = "outcome_reason_code";
export const OUTCOME_RESOURCE = "interaction_outcome";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** The tenant's own rows plus the national ones. */
function visibleTo(tenantId: string) {
  return or(eq(outcomeReasonCodes.tenantId, tenantId), eq(outcomeReasonCodes.tenantId, PLATFORM_TENANT_ID));
}

// ── Reason-code catalogue ──────────────────────────────────────────────────────

export function toReasonCodeView(r: OutcomeReasonCodeRow): OutcomeReasonCodeView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    label: r.label,
    description: r.description ?? null,
    category: r.category,
    appliesTo: r.appliesTo ?? [],
    governance: r.governance,
    versionNumber: r.versionNumber,
    active: r.active,
    ordinal: r.ordinal,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findReasonCodeById(id: string, tenantId: string): Promise<OutcomeReasonCodeView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(outcomeReasonCodes)
    .where(and(eq(outcomeReasonCodes.id, id), visibleTo(tenantId), isNull(outcomeReasonCodes.deletedAt)))
    .limit(1));
  const row = rows[0];
  return row ? toReasonCodeView(row) : null;
}

/**
 * Same read on the CALLER's transaction. A consumer must not call
 * {@link findReasonCodeById}: `scopedRead` opens its own transaction, so a consumer already
 * inside one would take a second pooled connection and read a snapshot blind to its own
 * uncommitted work.
 */
export async function findReasonCodeByIdTx(
  tx: Writer,
  id: string,
  tenantId: string,
): Promise<OutcomeReasonCodeView | null> {
  const rows = await tx.select()
    .from(outcomeReasonCodes)
    .where(and(eq(outcomeReasonCodes.id, id), visibleTo(tenantId), isNull(outcomeReasonCodes.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row ? toReasonCodeView(row) : null;
}

/** Used to refuse a code that would duplicate (or shadow a canonical) one. */
export async function findReasonCodeByCode(
  tenantId: string,
  category: string,
  code: string,
): Promise<OutcomeReasonCodeView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(outcomeReasonCodes)
    .where(and(
      eq(outcomeReasonCodes.category, category),
      eq(outcomeReasonCodes.code, code),
      visibleTo(tenantId),
      isNull(outcomeReasonCodes.deletedAt),
    ))
    .orderBy(desc(outcomeReasonCodes.versionNumber))
    .limit(1));
  const row = rows[0];
  return row ? toReasonCodeView(row) : null;
}

/** Highest catalogue revision issued for a code, 0 when the code is new to the tenant. */
export async function maxVersionNumber(tenantId: string, category: string, code: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({
    max: sql<number>`coalesce(max(${outcomeReasonCodes.versionNumber}), 0)::int`,
  })
    .from(outcomeReasonCodes)
    .where(and(
      eq(outcomeReasonCodes.tenantId, tenantId),
      eq(outcomeReasonCodes.category, category),
      eq(outcomeReasonCodes.code, code),
    )));
  return rows[0]?.max ?? 0;
}

export interface ReasonCodeFilter {
  category?: string;
  governance?: Governance;
  outcomeType?: OutcomeType;
  active?: boolean;
}

export async function listReasonCodes(
  tenantId: string,
  limit: number,
  offset: number,
  filter: ReasonCodeFilter = {},
): Promise<{ rows: OutcomeReasonCodeView[]; total: number }> {
  const conds = [visibleTo(tenantId), isNull(outcomeReasonCodes.deletedAt)];
  if (filter.category !== undefined) conds.push(eq(outcomeReasonCodes.category, filter.category));
  if (filter.governance !== undefined) conds.push(eq(outcomeReasonCodes.governance, filter.governance));
  if (filter.active !== undefined) conds.push(eq(outcomeReasonCodes.active, filter.active));
  // An empty `applies_to` means "any outcome type", so it must match every requested one —
  // otherwise a freshly imported catalogue would look empty to the capture form.
  if (filter.outcomeType !== undefined) {
    conds.push(sql`(
      jsonb_array_length(${outcomeReasonCodes.appliesTo}) = 0
      OR ${outcomeReasonCodes.appliesTo} @> ${JSON.stringify([filter.outcomeType])}::jsonb
    )`);
  }

  return scopedRead(async (tx) => {
    const rows = await tx.select().from(outcomeReasonCodes)
      .where(and(...conds))
      .orderBy(asc(outcomeReasonCodes.ordinal), asc(outcomeReasonCodes.code), asc(outcomeReasonCodes.versionNumber))
      .limit(limit)
      .offset(offset);
    const counted = await tx.select({ total: sql<number>`count(*)::int` }).from(outcomeReasonCodes)
      .where(and(...conds));
    return { rows: rows.map(toReasonCodeView), total: counted[0]?.total ?? 0 };
  });
}

/**
 * Insert a reason code, tolerating the business key already being taken.
 *
 * `onConflictDoNothing().returning()` rather than catching a unique violation: postgres.js
 * rethrows the first failed statement after the callback returns and rolls the whole
 * transaction back — INCLUDING the inbox row — which would dead-letter a command that is
 * merely a duplicate. An empty result IS the duplicate signal.
 */
export async function insertReasonCode(tx: Writer, row: OutcomeReasonCodeInsert): Promise<boolean> {
  const inserted = await tx.insert(outcomeReasonCodes).values(row)
    .onConflictDoNothing({
      target: [
        outcomeReasonCodes.tenantId,
        outcomeReasonCodes.category,
        outcomeReasonCodes.code,
        outcomeReasonCodes.versionNumber,
      ],
    })
    .returning({ id: outcomeReasonCodes.id });
  return inserted.length > 0;
}

export interface ReasonCodePatch {
  label?: string;
  description?: string | null;
  appliesTo?: OutcomeType[];
  ordinal?: number;
  active?: boolean;
}

/**
 * Optimistic locking: false means the row moved under us (or is canonical, or is deleted).
 * The `governance = 'tenant'` predicate is not belt-and-braces — a canonical code a tenant
 * can rename is not canonical.
 */
export async function updateReasonCodeWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: ReasonCodePatch,
  actorId: string,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${outcomeReasonCodes.version} + 1`,
  };
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.appliesTo !== undefined) set.appliesTo = patch.appliesTo;
  if (patch.ordinal !== undefined) set.ordinal = patch.ordinal;
  if (patch.active !== undefined) set.active = patch.active;

  const result = await (tx as typeof db).update(outcomeReasonCodes)
    .set(set)
    .where(and(
      eq(outcomeReasonCodes.id, id),
      eq(outcomeReasonCodes.tenantId, tenantId),
      eq(outcomeReasonCodes.version, expectedVersion),
      eq(outcomeReasonCodes.governance, "tenant"),
      isNull(outcomeReasonCodes.deletedAt),
    ))
    .returning({ id: outcomeReasonCodes.id });
  return result.length > 0;
}

/** Soft delete. Outcomes already captured keep their FK, so history stays readable. */
export async function softDeleteReasonCode(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await (tx as typeof db).update(outcomeReasonCodes)
    .set({
      deletedAt: now,
      active: false,
      updatedAt: now,
      updatedBy: actorId,
      version: sql`${outcomeReasonCodes.version} + 1`,
    })
    .where(and(
      eq(outcomeReasonCodes.id, id),
      eq(outcomeReasonCodes.tenantId, tenantId),
      eq(outcomeReasonCodes.governance, "tenant"),
      isNull(outcomeReasonCodes.deletedAt),
    ))
    .returning({ id: outcomeReasonCodes.id });
  return result.length > 0;
}

// ── Interaction outcomes ───────────────────────────────────────────────────────

export function toOutcomeView(r: InteractionOutcomeRow): InteractionOutcomeView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    outcomeRef: r.outcomeRef,
    outcomeType: r.outcomeType,
    reasonCodeId: r.reasonCodeId ?? null,
    productId: r.productId ?? null,
    // Minor units as a decimal STRING. A JSON number would lose paise above 2^53.
    amountMinor: r.amountMinor === null || r.amountMinor === undefined ? null : r.amountMinor.toString(),
    currency: r.currency ?? null,
    followUpNextActionId: r.followUpNextActionId ?? null,
    occurredAt: r.occurredAt.toISOString(),
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function findOutcomeById(id: string, tenantId: string): Promise<InteractionOutcomeView | null> {
  const rows = await scopedRead((tx) => tx.select()
    .from(interactionOutcomes)
    .where(and(eq(interactionOutcomes.id, id), eq(interactionOutcomes.tenantId, tenantId)))
    .limit(1));
  const row = rows[0];
  return row ? toOutcomeView(row) : null;
}

export interface OutcomeFilter {
  subjectType?: SubjectType;
  subjectId?: string;
  outcomeType?: OutcomeType;
  reasonCodeId?: string;
}

export async function listOutcomes(
  tenantId: string,
  limit: number,
  offset: number,
  filter: OutcomeFilter = {},
): Promise<{ rows: InteractionOutcomeView[]; total: number }> {
  const conds = [eq(interactionOutcomes.tenantId, tenantId)];
  if (filter.subjectType !== undefined) conds.push(eq(interactionOutcomes.subjectType, filter.subjectType));
  if (filter.subjectId !== undefined) conds.push(eq(interactionOutcomes.subjectId, filter.subjectId));
  if (filter.outcomeType !== undefined) conds.push(eq(interactionOutcomes.outcomeType, filter.outcomeType));
  if (filter.reasonCodeId !== undefined) conds.push(eq(interactionOutcomes.reasonCodeId, filter.reasonCodeId));

  return scopedRead(async (tx) => {
    const rows = await tx.select().from(interactionOutcomes)
      .where(and(...conds))
      .orderBy(desc(interactionOutcomes.occurredAt), asc(interactionOutcomes.id))
      .limit(limit)
      .offset(offset);
    const counted = await tx.select({ total: sql<number>`count(*)::int` }).from(interactionOutcomes)
      .where(and(...conds));
    return { rows: rows.map(toOutcomeView), total: counted[0]?.total ?? 0 };
  });
}

/**
 * Insert an outcome. Returns false when (tenant, subjectType, subjectId, outcomeRef) is
 * already taken — see {@link insertReasonCode} for why this is onConflictDoNothing and not
 * a caught unique violation. A duplicate must not reach the propensity feed twice.
 */
export async function insertOutcome(tx: Writer, row: InteractionOutcomeInsert): Promise<boolean> {
  const inserted = await tx.insert(interactionOutcomes).values(row)
    .onConflictDoNothing({
      target: [
        interactionOutcomes.tenantId,
        interactionOutcomes.subjectType,
        interactionOutcomes.subjectId,
        interactionOutcomes.outcomeRef,
      ],
    })
    .returning({ id: interactionOutcomes.id });
  return inserted.length > 0;
}

// ── Subject / follow-up existence (route-boundary checks) ───────────────────────

/**
 * Does the subject exist in this tenant? Checked so an outcome cannot be captured against
 * a typo'd id and then never appear on any timeline.
 *
 * The table is chosen by a switch over the validated enum, never interpolated from input.
 */
export async function subjectExists(
  tenantId: string,
  subjectType: SubjectType,
  subjectId: string,
): Promise<boolean> {
  const from = subjectType === "contact"
    ? sql`crm.contacts`
    : subjectType === "deal"
      ? sql`crm.deals`
      : sql`crm.next_actions`;

  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT 1 AS present FROM ${from}
    WHERE id = ${subjectId} AND tenant_id = ${tenantId}
    LIMIT 1
  `)) as unknown as Array<{ present: number }>;
  return rows.length > 0;
}

/** Does the referenced follow-up next action exist in this tenant (AC-002)? */
export async function nextActionExists(tenantId: string, id: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.execute(sql`
    SELECT 1 AS present FROM crm.next_actions
    WHERE id = ${id} AND tenant_id = ${tenantId}
    LIMIT 1
  `)) as unknown as Array<{ present: number }>;
  return rows.length > 0;
}
