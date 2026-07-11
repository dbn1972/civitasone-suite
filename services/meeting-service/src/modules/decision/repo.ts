/**
 * decision module — cache-first DB reads (CQRS read side, task 10.3).
 *
 * This file is read-only: every write goes through the command publishers in commands.ts
 * (route → zod → queue.publish → 202) and is applied by consumer.ts. Reads follow the suite
 * rule "all reads through Redis cache" — collection reads are served via `cache.getOrLoad`
 * (keyed `{service}:{tenant}:{resource}:{id}`) and invalidated by the consumer / command
 * publishers after a write commits; the bounded TTL is the self-healing backstop for any
 * missed invalidation.
 *
 * Cache resources owned here (invalidation contract shared with decision/commands.ts +
 * consumer.ts). Note the consumer/commands call `invalidateResource(tenant, "decision")` and
 * `invalidateResource(tenant, "resolution")`, which delete by the `meeting:{tenant}:decision`
 * / `meeting:{tenant}:resolution` PREFIX — so the register (`resolution_register`) and the
 * circulation-status (`resolution:circulation:…`) keys below are swept by the same call:
 *   - `meeting:{tenant}:decision:{meetingId}`               → meeting decision listing (getDecisions)
 *   - `meeting:{tenant}:resolution:{meetingId}`             → meeting resolution listing (getResolutions)
 *   - `meeting:{tenant}:resolution_register:{committeeId}`  → per-committee register (getResolutionRegister)
 *   - `meeting:{tenant}:resolution:circulation:{resId}`     → circulation status view (getCirculationStatus)
 *
 * Money invariant (steering: bigint paise): a decision's `financialImplication` is a `BIGINT`
 * (paise) in the DB and a JS `bigint` off Drizzle. The read layer normalises it to a canonical
 * base-10 STRING in the returned DTO so (a) the value survives JSON serialisation to the client
 * without precision loss, and (b) a cache hit and a cache miss return the SAME shape (the cache
 * serialises bigint → string, so caching a raw bigint would otherwise diverge from a fresh DB
 * read). Never coerced to a JS `number`.
 *
 * Existence guards used by the routes for a clean 404 (`getMeetingStatus`, `getDecision`,
 * `getResolution`, `committeeExists`) read DIRECTLY (uncached) so the routes see live state and
 * never serve a pre-write snapshot for an authorization/existence decision.
 *
 * _Requirements: 11.1, 11.4, 11.5, 11.6, 11.8, 12.1, 12.3, 12.7_
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { meetings } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { votes } from "../voting/schema.js";
import { decisions, resolutions, type DecisionRow, type ResolutionRow } from "./schema.js";
import { requiredResponseCount } from "./domain.js";

// ─── Cache resource namespaces (kept in lock-step with commands.ts / consumer.ts) ──
const RESOURCE_DECISION = "decision";
const RESOURCE_RESOLUTION = "resolution";
const RESOURCE_RESOLUTION_REGISTER = "resolution_register";
/** Circulation-status lives under the `resolution` prefix so it is swept on any resolution write. */
const CIRCULATION_STATUS_ID = (resolutionId: string): string => `circulation:${resolutionId}`;

// ─── Serialisable DTOs (money as string; see file header) ──────────────────────

/** A decision as returned to clients: identical to the row but `financialImplication` is a string. */
export type DecisionDto = Omit<DecisionRow, "financialImplication"> & {
  financialImplication: string | null;
};

/** Map a DB decision row to its serialisable DTO (bigint paise → canonical base-10 string). */
function toDecisionDto(row: DecisionRow): DecisionDto {
  const { financialImplication, ...rest } = row;
  return { ...rest, financialImplication: financialImplication === null ? null : financialImplication.toString() };
}

/** A resolution row has no bigint columns, so it is returned as-is. */
export type ResolutionDto = ResolutionRow;

// ─── Graceful cache-degradation helper (steering: fall through to DB, never 500) ──

/**
 * Run a cache-first read, falling through to a direct DB read if the cache layer itself fails
 * (e.g. Redis unavailable). A cache outage must degrade to a slower — but correct — Postgres
 * read, never a 5xx (steering: "if Redis is down, fall through to DB read"). Logged WARN.
 */
async function withDbFallback<T>(cacheRead: () => Promise<T>, loader: () => Promise<T>): Promise<T> {
  try {
    return await cacheRead();
  } catch (err) {
    process.stderr.write(
      `${JSON.stringify({ level: "warn", service: "meeting", msg: "cache read failed; falling through to DB", err: err instanceof Error ? err.message : String(err) })}\n`,
    );
    return loader();
  }
}

// ─── Decisions ─────────────────────────────────────────────────────────────────

/**
 * List a meeting's decisions (Req 11.1), oldest → newest. Cache-first on
 * `decision:{meetingId}` — the exact key the command publishers / consumer invalidate after
 * every decision write. Tenant-scoped for RLS-compatible isolation (P29). Money normalised to
 * a string in each DTO.
 */
export async function getDecisions(tenantId: string, meetingId: string): Promise<DecisionDto[]> {
  const key = cache.makeKey(tenantId, RESOURCE_DECISION, meetingId);
  const load = async (): Promise<DecisionDto[]> => {
    const rows = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.tenantId, tenantId), eq(decisions.meetingId, meetingId)))
      .orderBy(asc(decisions.createdAt));
    return rows.map(toDecisionDto);
  };
  const rows = await withDbFallback(() => cache.getOrLoad<DecisionDto[]>(key, load), load);
  return rows ?? [];
}

// ─── Resolutions ─────────────────────────────────────────────────────────────

/**
 * List a meeting's resolutions (Req 11.4), oldest → newest. Cache-first on
 * `resolution:{meetingId}`; invalidated by the consumer / command publishers on every
 * resolution write. Tenant-scoped (P29).
 */
export async function getResolutions(tenantId: string, meetingId: string): Promise<ResolutionDto[]> {
  const key = cache.makeKey(tenantId, RESOURCE_RESOLUTION, meetingId);
  const load = (): Promise<ResolutionDto[]> =>
    db
      .select()
      .from(resolutions)
      .where(and(eq(resolutions.tenantId, tenantId), eq(resolutions.meetingId, meetingId)))
      .orderBy(asc(resolutions.createdAt));
  const rows = await withDbFallback(() => cache.getOrLoad<ResolutionDto[]>(key, load), load);
  return rows ?? [];
}

// ─── Resolution register (per committee, searchable — Req 11.4, 12.7) ──────────

/** Query filters for the per-committee resolution register / search. All optional. */
export interface ResolutionRegisterQuery {
  /** Case-insensitive substring match over resolution number + text. */
  q?: string | undefined;
  /** Register status filter (effective | superseded | withdrawn). */
  status?: string | undefined;
  /** Computed result filter (passed | rejected | invalid). */
  result?: string | undefined;
  /** Financial-year filter (`YYYY-YY`), matched against the anchoring meeting's FY. */
  financialYear?: string | undefined;
  /** When set, restrict to circulation (true) or in-meeting (false) resolutions. */
  isCirculation?: boolean | undefined;
}

/** A register entry — a resolution joined to its anchoring meeting's committee/FY context. */
export interface ResolutionRegisterEntry {
  id: string;
  meetingId: string;
  committeeId: string | null;
  financialYear: string | null;
  resolutionNumber: string;
  text: string;
  voteType: string;
  majorityRule: string;
  result: string;
  status: string;
  isCirculation: boolean;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  responseRate: number | null;
  effectiveDate: string | null;
  dscSignerName: string | null;
  hashCurrent: string | null;
  createdAt: Date;
}

/**
 * The full resolution register for a committee (Req 11.4, 12.7), newest → oldest by resolution
 * number, then in-memory filtered by the search query. The UNFILTERED committee register is
 * cache-first on `resolution_register:{committeeId}` (a stable key swept by the
 * `invalidateResource(tenant, "resolution")` prefix delete on any resolution write); the search
 * predicates are applied to the cached list so every filter combination shares one cache entry.
 * Tenant-scoped (P29).
 */
export async function getResolutionRegister(
  tenantId: string,
  committeeId: string,
  query: ResolutionRegisterQuery = {},
): Promise<ResolutionRegisterEntry[]> {
  const key = cache.makeKey(tenantId, RESOURCE_RESOLUTION_REGISTER, committeeId);
  const load = (): Promise<ResolutionRegisterEntry[]> => loadRegister(tenantId, committeeId);
  const all = (await withDbFallback(() => cache.getOrLoad<ResolutionRegisterEntry[]>(key, load), load)) ?? [];
  return filterRegister(all, query);
}

async function loadRegister(tenantId: string, committeeId: string): Promise<ResolutionRegisterEntry[]> {
  return db
    .select({
      id: resolutions.id,
      meetingId: resolutions.meetingId,
      committeeId: meetings.committeeId,
      financialYear: meetings.financialYear,
      resolutionNumber: resolutions.resolutionNumber,
      text: resolutions.text,
      voteType: resolutions.voteType,
      majorityRule: resolutions.majorityRule,
      result: resolutions.result,
      status: resolutions.status,
      isCirculation: resolutions.isCirculation,
      votesFor: resolutions.votesFor,
      votesAgainst: resolutions.votesAgainst,
      votesAbstain: resolutions.votesAbstain,
      responseRate: resolutions.responseRate,
      effectiveDate: resolutions.effectiveDate,
      dscSignerName: resolutions.dscSignerName,
      hashCurrent: resolutions.hashCurrent,
      createdAt: resolutions.createdAt,
    })
    .from(resolutions)
    .innerJoin(meetings, eq(resolutions.meetingId, meetings.id))
    .where(and(eq(resolutions.tenantId, tenantId), eq(meetings.committeeId, committeeId)))
    .orderBy(desc(resolutions.resolutionNumber), desc(resolutions.createdAt));
}

/** Apply the register search predicates to the cached committee list (pure, in-memory). */
function filterRegister(all: ResolutionRegisterEntry[], query: ResolutionRegisterQuery): ResolutionRegisterEntry[] {
  const q = query.q?.trim().toLowerCase();
  return all.filter((r) => {
    if (query.status && r.status !== query.status) return false;
    if (query.result && r.result !== query.result) return false;
    if (query.financialYear && r.financialYear !== query.financialYear) return false;
    if (query.isCirculation !== undefined && r.isCirculation !== query.isCirculation) return false;
    if (q && !`${r.resolutionNumber}\n${r.text}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ─── Decision register search (Req 11.8 — cross-meeting decision register) ─────

/** Query filters for the decision-register search (`GET /v1/meetings/decisions/search`). */
export interface DecisionSearchQuery {
  /** Case-insensitive substring match over decision text + authority. */
  q?: string | undefined;
  /** Decision type filter (procurement | financial | hr | project | legal | …). */
  type?: string | undefined;
  /** Register status filter (effective | superseded | withdrawn). */
  status?: string | undefined;
  /** Restrict to a single meeting. */
  meetingId?: string | undefined;
  /** Restrict to decisions arising in meetings of a committee. */
  committeeId?: string | undefined;
  /** Max rows to return (already clamped by the route validator). */
  limit: number;
}

/** A decision-register search hit — the decision plus its meeting/committee context. */
export interface DecisionSearchEntry extends DecisionDto {
  committeeId: string | null;
  financialYear: string | null;
}

/**
 * Search the tenant's decision register (Req 11.8), newest → oldest. Filters by free-text,
 * type, status, meeting and committee; results capped by the route-provided `limit`. This is a
 * cross-meeting query (not a hot single-entity read), so it goes straight to Postgres with a
 * tenant filter (P29) rather than through a per-id cache entry. Money normalised to a string.
 */
export async function searchDecisions(
  tenantId: string,
  query: DecisionSearchQuery,
): Promise<DecisionSearchEntry[]> {
  const conditions = [eq(decisions.tenantId, tenantId)];
  if (query.type) conditions.push(eq(decisions.type, query.type));
  if (query.status) conditions.push(eq(decisions.status, query.status));
  if (query.meetingId) conditions.push(eq(decisions.meetingId, query.meetingId));
  if (query.committeeId) conditions.push(eq(meetings.committeeId, query.committeeId));
  const q = query.q?.trim();
  if (q) {
    const like = `%${q}%`;
    conditions.push(sql`(${decisions.text} ILIKE ${like} OR coalesce(${decisions.authority}, '') ILIKE ${like})`);
  }

  const rows = await db
    .select({
      row: decisions,
      committeeId: meetings.committeeId,
      financialYear: meetings.financialYear,
    })
    .from(decisions)
    .innerJoin(meetings, eq(decisions.meetingId, meetings.id))
    .where(and(...conditions))
    .orderBy(desc(decisions.createdAt))
    .limit(query.limit);

  return rows.map((r) => ({ ...toDecisionDto(r.row), committeeId: r.committeeId, financialYear: r.financialYear }));
}

// ─── Circulation resolution status (Req 12.3, 12.4, 12.5) ──────────────────────

/** Live status of a circulation resolution — tally, threshold and validity signals. */
export interface CirculationStatus {
  resolutionId: string;
  meetingId: string;
  committeeId: string | null;
  resolutionNumber: string;
  status: string;
  /** Computed outcome so far — `invalid` until the close step decides passed/rejected (Req 12.4). */
  result: string;
  majorityRule: string;
  circulationDeadline: string | null;
  /** True once `now` is past the circulation deadline. */
  deadlinePassed: boolean;
  /** Number of active committee members (the response denominator, Req 12.2). */
  totalMembers: number;
  /** Number of members who have responded (any position). */
  respondedCount: number;
  approveCount: number;
  rejectCount: number;
  abstainCount: number;
  /** Minimum responses required for the circulation to be valid (Req 12.2). */
  requiredCount: number;
  /** True once `respondedCount >= requiredCount` (Req 12.5, P18). */
  responseThresholdMet: boolean;
  /** Achieved response rate as an integer percentage (stored on the resolution once closed). */
  responseRate: number | null;
}

/**
 * Circulation-resolution status view (Req 12.3–12.5). Cache-first on
 * `resolution:circulation:{resolutionId}` (swept by the `resolution` prefix invalidation on any
 * resolution write; a bounded TTL backstops per-vote staleness since votes are written by the
 * voting module). Returns null when the resolution does not exist, belongs to another tenant, or
 * is not a circulation resolution. Tenant-scoped (P29).
 */
export async function getCirculationStatus(
  tenantId: string,
  resolutionId: string,
): Promise<CirculationStatus | null> {
  const key = cache.makeKey(tenantId, RESOURCE_RESOLUTION, CIRCULATION_STATUS_ID(resolutionId));
  const load = (): Promise<CirculationStatus | null> => loadCirculationStatus(tenantId, resolutionId);
  return withDbFallback(() => cache.getOrLoad<CirculationStatus>(key, load), load);
}

async function loadCirculationStatus(tenantId: string, resolutionId: string): Promise<CirculationStatus | null> {
  const resRows = await db
    .select({
      id: resolutions.id,
      meetingId: resolutions.meetingId,
      resolutionNumber: resolutions.resolutionNumber,
      status: resolutions.status,
      result: resolutions.result,
      majorityRule: resolutions.majorityRule,
      isCirculation: resolutions.isCirculation,
      circulationDeadline: resolutions.circulationDeadline,
      responseRate: resolutions.responseRate,
      committeeId: meetings.committeeId,
    })
    .from(resolutions)
    .innerJoin(meetings, eq(resolutions.meetingId, meetings.id))
    .where(and(eq(resolutions.tenantId, tenantId), eq(resolutions.id, resolutionId)))
    .limit(1);
  const res = resRows[0];
  if (!res || !res.isCirculation) return null;

  // Tally responses by position from the votes table (circulation votes for this resolution).
  const tally = await db
    .select({ position: votes.position, n: sql<number>`count(*)::int` })
    .from(votes)
    .where(and(eq(votes.tenantId, tenantId), eq(votes.resolutionId, resolutionId)))
    .groupBy(votes.position);
  let approveCount = 0;
  let rejectCount = 0;
  let abstainCount = 0;
  for (const t of tally) {
    if (t.position === "approve") approveCount = t.n;
    else if (t.position === "reject") rejectCount = t.n;
    else if (t.position === "abstain") abstainCount = t.n;
  }
  const respondedCount = approveCount + rejectCount + abstainCount;

  // Active-member denominator for the response threshold (Req 12.2).
  const totalMembers = res.committeeId ? await countActiveMembers(tenantId, res.committeeId) : 0;
  const requiredCount = requiredResponseCount(totalMembers);

  return {
    resolutionId: res.id,
    meetingId: res.meetingId,
    committeeId: res.committeeId,
    resolutionNumber: res.resolutionNumber,
    status: res.status,
    result: res.result,
    majorityRule: res.majorityRule,
    circulationDeadline: res.circulationDeadline ? res.circulationDeadline.toISOString() : null,
    deadlinePassed: res.circulationDeadline ? res.circulationDeadline.getTime() < Date.now() : false,
    totalMembers,
    respondedCount,
    approveCount,
    rejectCount,
    abstainCount,
    requiredCount,
    responseThresholdMet: respondedCount >= requiredCount,
    responseRate: res.responseRate ?? null,
  };
}

async function countActiveMembers(tenantId: string, committeeId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.status, "active"),
      ),
    );
  return rows[0]?.n ?? 0;
}

// ─── Direct (uncached) existence guards for the routes' 404 handling ───────────

/** Live meeting existence + status (uncached), tenant-scoped. Used by the routes for 404. */
export interface MeetingStatus {
  id: string;
  status: string;
  quorumEstablished: boolean;
}

export async function getMeetingStatus(tenantId: string, meetingId: string): Promise<MeetingStatus | null> {
  const rows = await db
    .select({ id: meetings.id, status: meetings.status, quorumEstablished: meetings.quorumEstablished })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Live single-decision lookup (uncached), tenant-scoped. Used by PATCH for a 404 + meeting match. */
export async function getDecision(tenantId: string, decisionId: string): Promise<DecisionDto | null> {
  const rows = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.id, decisionId), eq(decisions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toDecisionDto(rows[0]) : null;
}

/** Live single-resolution lookup (uncached), tenant-scoped. Used by sign/dissent/vote for 404. */
export async function getResolution(tenantId: string, resolutionId: string): Promise<ResolutionRow | null> {
  const rows = await db
    .select()
    .from(resolutions)
    .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Live committee existence check (uncached), tenant-scoped. Used by the register route for 404. */
export async function committeeExists(tenantId: string, committeeId: string): Promise<boolean> {
  const rows = await db
    .select({ id: committees.id })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1);
  return rows.length > 0;
}
