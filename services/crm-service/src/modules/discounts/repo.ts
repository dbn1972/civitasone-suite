/**
 * G26 discount-schedule + delegation-limit reads. Raw SQL under tenant RLS, mirroring
 * the neighbouring price-books repo.
 *
 * Thresholds and money leave here as decimal STRINGS (`::text` in every projection) and
 * are converted to BigInt by the caller. A JSON number would round any value above 2^53,
 * and a value-basis slab threshold is exactly the field where that happens first.
 *
 * Reads go through Redis. Redis being down must degrade to Postgres with a WARN, never a
 * 500: a quotation approval decision must still be answerable when the cache is not.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import type { DelegationLimit, ScopeType, Slab, SlabBasis } from "./domain.js";

const log = pino({ name: "crm-discounts-repo" });

/**
 * Cache resource segments. Exported so the consumer invalidates exactly the prefix the
 * reads write under — `cache.invalidateResource(t, SCHEDULE_RESOURCE)` clears
 * `crm:{t}:discount_schedule*`.
 */
export const SCHEDULE_RESOURCE = "discount_schedule";
export const LIMIT_RESOURCE = "delegation_limit";

// ── wire views ──────────────────────────────────────────────────────────────

export interface SlabView {
  id: string;
  fromThreshold: string;
  toThreshold: string | null;
  discountBps: number;
  ordinal: number;
}

export interface ScheduleView {
  id: string;
  name: string;
  scopeType: ScopeType;
  scopeId: string;
  basis: SlabBasis;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  enabled: boolean;
  version: number;
  slabs: SlabView[];
}

export interface DelegationLimitView {
  id: string;
  role: string;
  level: number;
  maxDiscountBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  enabled: boolean;
  version: number;
}

/** Wire view -> the domain's bigint slab shape. */
export function toSlab(v: SlabView): Slab {
  return {
    fromThreshold: BigInt(v.fromThreshold),
    toThreshold: v.toThreshold === null ? null : BigInt(v.toThreshold),
    discountBps: v.discountBps,
  };
}

/** Wire view -> the domain's delegation limit (drops the storage-only fields). */
export function toDelegationLimit(v: DelegationLimitView): DelegationLimit {
  return {
    id: v.id,
    role: v.role,
    level: v.level,
    maxDiscountBps: v.maxDiscountBps,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
  };
}

// ── schedule reads ──────────────────────────────────────────────────────────

const SCHEDULE_COLS = sql`
  id, name, scope_type AS "scopeType", scope_id AS "scopeId", basis, currency,
  to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') AS "effectiveTo",
  enabled, version
`;

type ScheduleRow = Omit<ScheduleView, "slabs">;

async function loadSlabs(tenantId: string, scheduleIds: readonly string[]): Promise<Map<string, SlabView[]>> {
  const byId = new Map<string, SlabView[]>();
  if (scheduleIds.length === 0) return byId;
  const rows = (await scopedRead(async (tx) => tx.execute(sql`
    SELECT id, schedule_id AS "scheduleId", from_threshold::text AS "fromThreshold",
           to_threshold::text AS "toThreshold", discount_bps AS "discountBps", ordinal
    FROM crm.discount_slabs
    WHERE tenant_id = ${tenantId} AND schedule_id IN ${sql`(${sql.join(scheduleIds.map((id) => sql`${id}::uuid`), sql`, `)})`}
    ORDER BY from_threshold ASC
  `))) as unknown as Array<SlabView & { scheduleId: string }>;
  for (const r of rows) {
    const { scheduleId, ...slab } = r;
    const list = byId.get(scheduleId) ?? [];
    list.push(slab);
    byId.set(scheduleId, list);
  }
  return byId;
}

async function loadById(tenantId: string, id: string): Promise<ScheduleView | null> {
  const rows = (await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${SCHEDULE_COLS} FROM crm.discount_schedules WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as ScheduleRow[];
  const row = rows[0];
  if (row === undefined) return null;
  const slabs = await loadSlabs(tenantId, [id]);
  return { ...row, slabs: slabs.get(id) ?? [] };
}

/**
 * One schedule with its slabs, read through Redis.
 *
 * `getOrLoad` propagates store errors, so a cache-layer failure falls through to Postgres
 * and logs WARN. A DATABASE failure is re-thrown untouched — retrying it here would double
 * the load on an already unhealthy database and hide the cause.
 */
export async function findById(tenantId: string, id: string): Promise<ScheduleView | null> {
  let dbFailed = false;
  const loader = async (): Promise<ScheduleView | null> => {
    try {
      return await loadById(tenantId, id);
    } catch (err) {
      dbFailed = true;
      throw err;
    }
  };
  try {
    return await cache.getOrLoad<ScheduleView>(cache.makeKey(tenantId, SCHEDULE_RESOURCE, id), loader);
  } catch (err) {
    if (dbFailed) throw err;
    log.warn({ err, tenantId }, "discount schedule cache unavailable; reading through to Postgres");
    return loadById(tenantId, id);
  }
}

export interface ScheduleFilter {
  scopeType?: ScopeType | undefined;
  scopeId?: string | undefined;
  enabledOnly?: boolean | undefined;
}

export async function list(
  tenantId: string,
  f: ScheduleFilter,
  limit: number,
  offset: number,
): Promise<{ rows: ScheduleView[]; total: number }> {
  const scopeTypeF = f.scopeType !== undefined ? sql`AND scope_type = ${f.scopeType}` : sql``;
  const scopeIdF = f.scopeId !== undefined ? sql`AND scope_id = ${f.scopeId}` : sql``;
  const enabledF = f.enabledOnly === true ? sql`AND enabled = true` : sql``;
  const { rows, total } = await scopedRead(async (tx) => {
    const data = (await tx.execute(sql`
      SELECT ${SCHEDULE_COLS} FROM crm.discount_schedules
      WHERE tenant_id = ${tenantId} ${scopeTypeF} ${scopeIdF} ${enabledF}
      ORDER BY effective_from DESC, name ASC
      LIMIT ${limit} OFFSET ${offset}
    `)) as unknown as ScheduleRow[];
    const counted = (await tx.execute(sql`
      SELECT count(*)::int AS total FROM crm.discount_schedules
      WHERE tenant_id = ${tenantId} ${scopeTypeF} ${scopeIdF} ${enabledF}
    `)) as unknown as Array<{ total: number }>;
    return { rows: data, total: counted[0]?.total ?? 0 };
  });
  const slabs = await loadSlabs(tenantId, rows.map((r) => r.id));
  return { rows: rows.map((r) => ({ ...r, slabs: slabs.get(r.id) ?? [] })), total };
}

/**
 * Every ENABLED schedule for a scope whose window contains `asAt`. Filtering by date in
 * SQL (rather than in the domain) keeps the row count small; choosing BETWEEN several
 * overlapping cards stays in the domain so the rule is unit-testable.
 */
export async function effectiveForScope(
  tenantId: string,
  scopeType: ScopeType,
  scopeId: string,
  asAt: string,
): Promise<ScheduleView[]> {
  const rows = (await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${SCHEDULE_COLS} FROM crm.discount_schedules
    WHERE tenant_id = ${tenantId} AND enabled = true
      AND scope_type = ${scopeType} AND scope_id = ${scopeId}
      AND effective_from <= ${asAt}::date
      AND (effective_to IS NULL OR effective_to >= ${asAt}::date)
    ORDER BY effective_from DESC
  `))) as unknown as ScheduleRow[];
  const slabs = await loadSlabs(tenantId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, slabs: slabs.get(r.id) ?? [] }));
}

/** Windows already recorded for a scope, so an overlapping rate card can be refused. */
export async function windowsForScope(
  tenantId: string,
  scopeType: ScopeType,
  scopeId: string,
  basis: SlabBasis,
  currency: string,
): Promise<Array<{ id: string; effectiveFrom: string; effectiveTo: string | null }>> {
  return (await scopedRead(async (tx) => tx.execute(sql`
    SELECT id, to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
           to_char(effective_to, 'YYYY-MM-DD') AS "effectiveTo"
    FROM crm.discount_schedules
    WHERE tenant_id = ${tenantId} AND scope_type = ${scopeType} AND scope_id = ${scopeId}
      AND basis = ${basis} AND currency = ${currency}
  `))) as unknown as Array<{ id: string; effectiveFrom: string; effectiveTo: string | null }>;
}

// ── delegation-limit reads ──────────────────────────────────────────────────

const LIMIT_COLS = sql`
  id, role, level, max_discount_bps AS "maxDiscountBps",
  to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
  to_char(effective_to, 'YYYY-MM-DD') AS "effectiveTo",
  enabled, version
`;

async function loadLimits(tenantId: string): Promise<DelegationLimitView[]> {
  return (await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${LIMIT_COLS} FROM crm.delegation_limits
    WHERE tenant_id = ${tenantId}
    ORDER BY level ASC, role ASC, effective_from DESC
  `))) as unknown as DelegationLimitView[];
}

/**
 * The tenant's whole delegation chain, read through Redis.
 *
 * Whole-set granularity rather than per-role: resolving an approver needs the chain, not
 * one row, and one key means one invalidation cannot leave half a policy behind. This is
 * on the quotation approval path, so it is read on every discount request.
 */
export async function listLimits(tenantId: string): Promise<DelegationLimitView[]> {
  let dbFailed = false;
  const loader = async (): Promise<DelegationLimitView[]> => {
    try {
      return await loadLimits(tenantId);
    } catch (err) {
      dbFailed = true;
      throw err;
    }
  };
  try {
    return (await cache.getOrLoad<DelegationLimitView[]>(
      cache.makeKey(tenantId, LIMIT_RESOURCE, "all"),
      loader,
    )) ?? [];
  } catch (err) {
    if (dbFailed) throw err;
    log.warn({ err, tenantId }, "delegation limit cache unavailable; reading through to Postgres");
    return loadLimits(tenantId);
  }
}

/** ENABLED limits only, as the domain shape. Disabled rows are policy an admin retired. */
export async function delegationChain(tenantId: string): Promise<DelegationLimit[]> {
  const rows = await listLimits(tenantId);
  return rows.filter((r) => r.enabled).map(toDelegationLimit);
}

export async function findLimit(tenantId: string, id: string): Promise<DelegationLimitView | null> {
  const rows = (await scopedRead(async (tx) => tx.execute(sql`
    SELECT ${LIMIT_COLS} FROM crm.delegation_limits WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as DelegationLimitView[];
  return rows[0] ?? null;
}
