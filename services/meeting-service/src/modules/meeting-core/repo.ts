/**
 * meeting-core — cache-first read repository (CQRS read side, Req 1.1, 1.7).
 *
 * Every read on the hot path goes through the Redis read-through cache
 * (`@civitasone/cache`) before Postgres, honouring the suite key convention
 * `{service}:{tenant}:{resource}:{id}` (steering: "All reads through Redis cache").
 * Single-entity reads use `cache.getOrLoad`; list/collection reads use
 * `cache.listOrLoad` with a stable, filter-derived hash. The write side
 * (meeting-core/consumer.ts, task 3.4; agenda/committee consumers) invalidates the
 * matching keys after each commit, and the cache's bounded TTL is the self-healing
 * backstop for any missed invalidation.
 *
 * Graceful degradation (steering: Error Handling & Resilience): if Redis is down the
 * cache layer surfaces an error; each public read wraps the cache call in
 * `withDbFallback` so a cache failure falls through to a direct Postgres read (logged
 * WARN, never a 500 for a cache miss). Tenant isolation (P29) is enforced in every SQL
 * predicate — each query filters by `tenant_id`, matching the sibling-repo convention
 * of reading via the shared `db` client with an explicit tenant filter.
 *
 * Resource cache namespaces (kept in lock-step with the consumers' invalidations):
 *   - "meeting"             — a single meeting by id + meeting list pages
 *   - "meeting_transition"  — the append-only state-transition log for a meeting
 *   - "meeting_type"        — meeting-type templates (single + list)
 *   - "meeting_series"      — recurring series (single + list)
 *   - "meeting_dashboard"   — per-role dashboard projections (leadership/secretariat/participant)
 *
 * _Requirements: 1.1, 1.7_
 */
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import {
  meetings,
  meetingTypes,
  meetingSeries,
  meetingStateTransitions,
  type MeetingRow,
  type MeetingTypeRow,
  type MeetingSeriesRow,
  type MeetingStateTransitionRow,
} from "./schema.js";
import type {
  ListMeetingsQuery,
  ListMeetingTypesQuery,
  ListSeriesQuery,
} from "./validators.js";

// ─── Cache resource namespaces ──────────────────────────────────────────────

const RESOURCE = {
  meeting: "meeting",
  transition: "meeting_transition",
  type: "meeting_type",
  series: "meeting_series",
  dashboard: "meeting_dashboard",
} as const;

// ─── Pagination envelope ─────────────────────────────────────────────────────

/** Standard list envelope: `{ data, meta: { page, pageSize, total } }` (API design standard). */
export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/** Derive the 1-based page number from offset/limit for the response envelope. */
function buildMeta(limit: number, offset: number, total: number): Paginated<never>["meta"] {
  const pageSize = limit > 0 ? limit : 1;
  return { page: Math.floor(offset / pageSize) + 1, pageSize: limit, total };
}

/**
 * Stable, order-independent hash of a filter object for use as the list cache key.
 * Only defined values are included and keys are sorted so equivalent filter sets map
 * to the same cache entry regardless of property order.
 */
function hashFilters(parts: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(parts).sort()) {
    const value = parts[key];
    if (value !== undefined && value !== null) normalized[key] = value;
  }
  return JSON.stringify(normalized);
}

/**
 * Run a cache-first read, falling through to a direct DB read if the cache layer
 * itself fails (e.g. Redis unavailable). A cache outage must degrade to a slower —
 * but correct — Postgres read, never a 5xx (steering: "if Redis is down, fall through
 * to DB read"). The fallback is logged at WARN via the structured console; the loader
 * is the same source-of-truth query the cache would have run.
 */
async function withDbFallback<T>(cacheRead: () => Promise<T>, loader: () => Promise<T>): Promise<T> {
  try {
    return await cacheRead();
  } catch (err) {
    // WARN, not ERROR: this is a degraded-but-recovering state (auto-heals when Redis returns).
    process.stderr.write(
      `${JSON.stringify({ level: "warn", service: "meeting", msg: "cache read failed; falling through to DB", err: err instanceof Error ? err.message : String(err) })}\n`,
    );
    return loader();
  }
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

/**
 * Fetch a single meeting by id, scoped to the tenant (P29). Cache-first on
 * `meeting:{tenant}:meeting:{id}`; returns null when the meeting does not exist
 * (or belongs to another tenant).
 */
export async function getMeetingById(tenantId: string, meetingId: string): Promise<MeetingRow | null> {
  const key = cache.makeKey(tenantId, RESOURCE.meeting, meetingId);
  const load = () => loadMeetingById(tenantId, meetingId);
  return withDbFallback(() => cache.getOrLoad<MeetingRow>(key, load), load);
}

async function loadMeetingById(tenantId: string, meetingId: string): Promise<MeetingRow | null> {
  const rows = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.tenantId, tenantId), eq(meetings.id, meetingId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * List meetings for a tenant with optional filters (status, type, committee, series,
 * chairperson, confidentiality) and a `[from, to]` window over `scheduled_at` (Req 1.1).
 * Paginated (offset/limit, capped by the validator) and returned as a `{ data, meta }`
 * envelope. Ordered by `scheduled_at` (nulls last via created_at tiebreak) descending so
 * the most recent/soonest meetings surface first. Cache-first on a filter-derived list key.
 */
export async function listMeetings(tenantId: string, query: ListMeetingsQuery): Promise<Paginated<MeetingRow>> {
  const { limit, offset } = query;
  const hash = `list:${hashFilters({
    status: query.status,
    type: query.type,
    committeeId: query.committeeId,
    seriesId: query.seriesId,
    chairpersonId: query.chairpersonId,
    confidentialityLevel: query.confidentialityLevel,
    from: query.from,
    to: query.to,
    limit,
    offset,
  })}`;
  const load = () => loadMeetings(tenantId, query);
  return withDbFallback(
    () => cache.listOrLoad<Paginated<MeetingRow>>(tenantId, RESOURCE.meeting, hash, load),
    load,
  );
}

async function loadMeetings(tenantId: string, query: ListMeetingsQuery): Promise<Paginated<MeetingRow>> {
  const { limit, offset } = query;
  const conditions = [eq(meetings.tenantId, tenantId)];
  if (query.status) conditions.push(eq(meetings.status, query.status));
  if (query.type) conditions.push(eq(meetings.type, query.type));
  if (query.committeeId) conditions.push(eq(meetings.committeeId, query.committeeId));
  if (query.seriesId) conditions.push(eq(meetings.seriesId, query.seriesId));
  if (query.chairpersonId) conditions.push(eq(meetings.chairpersonId, query.chairpersonId));
  if (query.confidentialityLevel) conditions.push(eq(meetings.confidentialityLevel, query.confidentialityLevel));
  if (query.from) conditions.push(gte(meetings.scheduledAt, new Date(query.from)));
  if (query.to) conditions.push(lte(meetings.scheduledAt, new Date(query.to)));

  const where = and(...conditions);
  const data = await db
    .select()
    .from(meetings)
    .where(where)
    .orderBy(desc(meetings.scheduledAt), desc(meetings.createdAt))
    .limit(limit)
    .offset(offset);
  const total = await countWhere(meetings, where);
  return { data, meta: buildMeta(limit, offset, total) };
}

/**
 * The complete state-transition audit log for a meeting (Req 1.7), oldest → newest.
 * Cache-first on `meeting:{tenant}:meeting_transition:{meetingId}`; the write side
 * appends a row and invalidates this key on every transition.
 */
export async function getTransitionLog(tenantId: string, meetingId: string): Promise<MeetingStateTransitionRow[]> {
  const key = cache.makeKey(tenantId, RESOURCE.transition, meetingId);
  const load = () => loadTransitionLog(tenantId, meetingId);
  const rows = await withDbFallback(() => cache.getOrLoad<MeetingStateTransitionRow[]>(key, load), load);
  return rows ?? [];
}

async function loadTransitionLog(tenantId: string, meetingId: string): Promise<MeetingStateTransitionRow[]> {
  return db
    .select()
    .from(meetingStateTransitions)
    .where(and(eq(meetingStateTransitions.tenantId, tenantId), eq(meetingStateTransitions.meetingId, meetingId)))
    .orderBy(asc(meetingStateTransitions.transitionedAt));
}

// ─── Meeting types ──────────────────────────────────────────────────────────

/** Fetch a single meeting-type template by id (tenant-scoped). Cache-first. */
export async function getMeetingTypeById(tenantId: string, meetingTypeId: string): Promise<MeetingTypeRow | null> {
  const key = cache.makeKey(tenantId, RESOURCE.type, meetingTypeId);
  const load = async (): Promise<MeetingTypeRow | null> => {
    const rows = await db
      .select()
      .from(meetingTypes)
      .where(and(eq(meetingTypes.tenantId, tenantId), eq(meetingTypes.id, meetingTypeId)))
      .limit(1);
    return rows[0] ?? null;
  };
  return withDbFallback(() => cache.getOrLoad<MeetingTypeRow>(key, load), load);
}

/**
 * List meeting-type templates for a tenant, optionally filtered by `isStatutory`.
 * Paginated `{ data, meta }`; ordered by `code`. Cache-first on a filter-derived key.
 */
export async function getMeetingTypes(tenantId: string, query: ListMeetingTypesQuery): Promise<Paginated<MeetingTypeRow>> {
  const { limit, offset } = query;
  const hash = `list:${hashFilters({ isStatutory: query.isStatutory, limit, offset })}`;
  const load = () => loadMeetingTypes(tenantId, query);
  return withDbFallback(
    () => cache.listOrLoad<Paginated<MeetingTypeRow>>(tenantId, RESOURCE.type, hash, load),
    load,
  );
}

async function loadMeetingTypes(tenantId: string, query: ListMeetingTypesQuery): Promise<Paginated<MeetingTypeRow>> {
  const { limit, offset } = query;
  const conditions = [eq(meetingTypes.tenantId, tenantId)];
  if (query.isStatutory !== undefined) conditions.push(eq(meetingTypes.isStatutory, query.isStatutory));

  const where = and(...conditions);
  const data = await db
    .select()
    .from(meetingTypes)
    .where(where)
    .orderBy(asc(meetingTypes.code))
    .limit(limit)
    .offset(offset);
  const total = await countWhere(meetingTypes, where);
  return { data, meta: buildMeta(limit, offset, total) };
}

// ─── Meeting series ─────────────────────────────────────────────────────────

/** Fetch a single recurring series by id (tenant-scoped). Cache-first. */
export async function getMeetingSeriesById(tenantId: string, seriesId: string): Promise<MeetingSeriesRow | null> {
  const key = cache.makeKey(tenantId, RESOURCE.series, seriesId);
  const load = async (): Promise<MeetingSeriesRow | null> => {
    const rows = await db
      .select()
      .from(meetingSeries)
      .where(and(eq(meetingSeries.tenantId, tenantId), eq(meetingSeries.id, seriesId)))
      .limit(1);
    return rows[0] ?? null;
  };
  return withDbFallback(() => cache.getOrLoad<MeetingSeriesRow>(key, load), load);
}

/**
 * List recurring meeting series for a tenant, optionally filtered by committee and
 * active flag. Paginated `{ data, meta }`; ordered by `start_date` descending.
 * Cache-first on a filter-derived key.
 */
export async function getMeetingSeries(tenantId: string, query: ListSeriesQuery): Promise<Paginated<MeetingSeriesRow>> {
  const { limit, offset } = query;
  const hash = `list:${hashFilters({ committeeId: query.committeeId, isActive: query.isActive, limit, offset })}`;
  const load = () => loadMeetingSeries(tenantId, query);
  return withDbFallback(
    () => cache.listOrLoad<Paginated<MeetingSeriesRow>>(tenantId, RESOURCE.series, hash, load),
    load,
  );
}

async function loadMeetingSeries(tenantId: string, query: ListSeriesQuery): Promise<Paginated<MeetingSeriesRow>> {
  const { limit, offset } = query;
  const conditions = [eq(meetingSeries.tenantId, tenantId)];
  if (query.committeeId) conditions.push(eq(meetingSeries.committeeId, query.committeeId));
  if (query.isActive !== undefined) conditions.push(eq(meetingSeries.isActive, query.isActive));

  const where = and(...conditions);
  const data = await db
    .select()
    .from(meetingSeries)
    .where(where)
    .orderBy(desc(meetingSeries.startDate))
    .limit(limit)
    .offset(offset);
  const total = await countWhere(meetingSeries, where);
  return { data, meta: buildMeta(limit, offset, total) };
}

// ─── Dashboards (Req 1.1, 1.7 — role-scoped read projections) ─────────────────

/** Non-terminal states a meeting can be "upcoming" or "in-flight" in. */
const OPEN_STATES = ["draft", "scheduled", "agenda_locked", "in_progress", "adjourned", "minutes_pending"] as const;

/** A compact meeting summary row shared by the dashboard projections. */
export interface DashboardMeeting {
  id: string;
  title: string;
  type: string;
  status: string;
  committeeId: string | null;
  scheduledAt: Date | null;
  meetingNumber: string | null;
}

const dashboardColumns = {
  id: meetings.id,
  title: meetings.title,
  type: meetings.type,
  status: meetings.status,
  committeeId: meetings.committeeId,
  scheduledAt: meetings.scheduledAt,
  meetingNumber: meetings.meetingNumber,
};

/** Counts of meetings grouped by status for a given predicate. */
async function statusCounts(where: ReturnType<typeof and>): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: meetings.status, n: sql<number>`count(*)::int` })
    .from(meetings)
    .where(where)
    .groupBy(meetings.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/**
 * Leadership dashboard for a chairperson (Req 1.1, 1.7): a status breakdown of every
 * meeting they chair plus their upcoming open meetings (soonest first). Cache-first on
 * `meeting:{tenant}:meeting_dashboard:leadership:{chairpersonId}`.
 */
export async function getLeadershipDashboard(
  tenantId: string,
  chairpersonId: string,
): Promise<{ statusCounts: Record<string, number>; upcoming: DashboardMeeting[] }> {
  const key = cache.makeKey(tenantId, RESOURCE.dashboard, `leadership:${chairpersonId}`);
  const load = async () => {
    const scope = and(eq(meetings.tenantId, tenantId), eq(meetings.chairpersonId, chairpersonId));
    const counts = await statusCounts(scope);
    const upcoming = await db
      .select(dashboardColumns)
      .from(meetings)
      .where(and(scope, inArray(meetings.status, [...OPEN_STATES])))
      .orderBy(asc(meetings.scheduledAt))
      .limit(20);
    return { statusCounts: counts, upcoming };
  };
  const result = await withDbFallback(
    () => cache.getOrLoad<{ statusCounts: Record<string, number>; upcoming: DashboardMeeting[] }>(key, load),
    load,
  );
  return result ?? { statusCounts: {}, upcoming: [] };
}

/**
 * Secretariat dashboard for a secretary (Req 1.1, 1.7): a status breakdown of every
 * meeting they staff plus the ones needing secretarial action next — those in
 * `minutes_pending` (minutes to draft/submit) and the open pipeline (soonest first).
 * Cache-first on `meeting:{tenant}:meeting_dashboard:secretariat:{secretaryId}`.
 */
export async function getSecretariatDashboard(
  tenantId: string,
  secretaryId: string,
): Promise<{
  statusCounts: Record<string, number>;
  minutesPending: DashboardMeeting[];
  upcoming: DashboardMeeting[];
}> {
  const key = cache.makeKey(tenantId, RESOURCE.dashboard, `secretariat:${secretaryId}`);
  const load = async () => {
    const scope = and(eq(meetings.tenantId, tenantId), eq(meetings.secretaryId, secretaryId));
    const counts = await statusCounts(scope);
    const minutesPending = await db
      .select(dashboardColumns)
      .from(meetings)
      .where(and(scope, eq(meetings.status, "minutes_pending")))
      .orderBy(asc(meetings.actualEndAt))
      .limit(20);
    const upcoming = await db
      .select(dashboardColumns)
      .from(meetings)
      .where(and(scope, inArray(meetings.status, ["scheduled", "agenda_locked", "in_progress"])))
      .orderBy(asc(meetings.scheduledAt))
      .limit(20);
    return { statusCounts: counts, minutesPending, upcoming };
  };
  const result = await withDbFallback(
    () =>
      cache.getOrLoad<{
        statusCounts: Record<string, number>;
        minutesPending: DashboardMeeting[];
        upcoming: DashboardMeeting[];
      }>(key, load),
    load,
  );
  return result ?? { statusCounts: {}, minutesPending: [], upcoming: [] };
}

/**
 * Participant dashboard for a user (Req 1.1, 1.7): the meetings they are directly
 * associated with in a leadership capacity on the meeting record — chairperson,
 * secretary, or convener — split into upcoming (open) and recently concluded. Once the
 * participant module (task 7) lands, this projection can widen to invitation-based
 * membership; scoping to the meeting-core role columns keeps task 3.5 self-contained.
 * Cache-first on `meeting:{tenant}:meeting_dashboard:participant:{userId}`.
 */
export async function getParticipantDashboard(
  tenantId: string,
  userId: string,
): Promise<{ upcoming: DashboardMeeting[]; past: DashboardMeeting[] }> {
  const key = cache.makeKey(tenantId, RESOURCE.dashboard, `participant:${userId}`);
  const load = async () => {
    const association = or(
      eq(meetings.chairpersonId, userId),
      eq(meetings.secretaryId, userId),
      eq(meetings.convenerId, userId),
    );
    const scope = and(eq(meetings.tenantId, tenantId), association);
    const upcoming = await db
      .select(dashboardColumns)
      .from(meetings)
      .where(and(scope, inArray(meetings.status, [...OPEN_STATES])))
      .orderBy(asc(meetings.scheduledAt))
      .limit(20);
    const past = await db
      .select(dashboardColumns)
      .from(meetings)
      .where(and(scope, inArray(meetings.status, ["minutes_approved", "closed", "archived"])))
      .orderBy(desc(meetings.scheduledAt))
      .limit(20);
    return { upcoming, past };
  };
  const result = await withDbFallback(
    () => cache.getOrLoad<{ upcoming: DashboardMeeting[]; past: DashboardMeeting[] }>(key, load),
    load,
  );
  return result ?? { upcoming: [], past: [] };
}

// ─── Shared count helper ──────────────────────────────────────────────────────

/** `COUNT(*)` over a table for the given predicate, returned as a plain number. */
async function countWhere(
  table: typeof meetings | typeof meetingTypes | typeof meetingSeries,
  where: ReturnType<typeof and>,
): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  return rows[0]?.n ?? 0;
}
