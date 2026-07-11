/**
 * committee module — cache-first read model (CQRS read side, Req 2.1–2.7).
 *
 * This file is READ-ONLY: every write goes through the CQRS command publishers in
 * `commands.ts` → consumer → transactional outbox. Single-entity + aggregate lookups
 * use the Redis read-through cache (`cache.getOrLoad`, steering: "All reads through
 * Redis cache"); list queries hit Postgres directly (RLS-scoped by tenant_id via the
 * per-request tenant-tx hook) and always carry an explicit `tenant_id` predicate as
 * defence-in-depth.
 *
 * Cache keys are all namespaced under the `committee` resource prefix
 * (`meeting:{tenant}:committee:{committeeId}[:facet]`) so the consumer's
 * `cache.invalidateResource(tenantId, "committee")` after any committee/member write
 * transparently clears the derived `:health` / `:compliance` facets too.
 *
 * Aggregate facets:
 *   • getComplianceReport — statutory meeting-frequency check (Req 2.5): compares the
 *     committee's obligation (`meetingFrequency` + `statutoryBasis`, e.g. Finance
 *     Committee quarterly per GFR Rule 89) against the most recent meeting and flags
 *     an overdue obligation.
 *   • getHealth — committee health dashboard: membership composition, tenure-expiry
 *     window (Req 2.4, reusing the pure domain helpers), meeting activity, quorum
 *     requirement, and the embedded compliance summary.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { meetings } from "../meeting-core/schema.js";
import {
  committees,
  committeeMembers,
  committeeTermsHistory,
  type CommitteeRow,
  type CommitteeMemberRow,
  type CommitteeTermsHistoryRow,
} from "./schema.js";
import { isTenureExpiring, type QuorumRule } from "./domain.js";

const RESOURCE = "committee";
/** Single-committee lookups are fairly static — cache for 5 minutes. */
const COMMITTEE_TTL = 300;
/** Aggregate facets depend on meetings (owned by another module) — short TTL. */
const FACET_TTL = 60;

/** Meeting statuses that count as an actually-held meeting for frequency compliance. */
const HELD_STATUSES = ["in_progress", "adjourned", "minutes_pending", "minutes_approved", "closed", "archived"];
/** Meeting statuses that represent a future/planned meeting (not yet held). */
const UPCOMING_STATUSES = ["scheduled", "agenda_locked"];

// ─── Filters ───────────────────────────────────────────────────────────────────

export interface ListCommitteesFilter {
  type?: string | undefined;
  status?: string | undefined;
  limit: number;
  offset: number;
}

export interface CommitteeListResult {
  rows: CommitteeRow[];
  total: number;
}

// ─── Single committee ────────────────────────────────────────────────────────

/**
 * `meeting:{tenant}:committee:{committeeId}` — cache.getOrLoad read-through.
 * Returns null when the committee does not exist or belongs to another tenant
 * (used by routes to 404 before publishing a write).
 */
export async function getCommitteeById(tenantId: string, committeeId: string): Promise<CommitteeRow | null> {
  return cache.getOrLoad<CommitteeRow>(
    cache.makeKey(tenantId, RESOURCE, committeeId),
    async () => {
      const rows = await scopedRead((tx) => tx
        .select()
        .from(committees)
        .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
        .limit(1));
      return rows[0] ?? null;
    },
    COMMITTEE_TTL,
  );
}

// ─── List committees ───────────────────────────────────────────────────────────

/**
 * Paginated committee list, filterable by type/status. Goes straight to Postgres
 * (RLS-scoped) and returns rows + the unpaginated total for the standard list
 * envelope `{ data, meta: { page, pageSize, total } }` built at the route boundary.
 */
export async function listCommittees(tenantId: string, filter: ListCommitteesFilter): Promise<CommitteeListResult> {
  const conditions = [eq(committees.tenantId, tenantId)];
  if (filter.type !== undefined) conditions.push(eq(committees.type, filter.type));
  if (filter.status !== undefined) conditions.push(eq(committees.status, filter.status));
  const where = and(...conditions);

  const [rows, countRows] = await Promise.all([
    scopedRead((tx) => tx
      .select()
      .from(committees)
      .where(where)
      .orderBy(desc(committees.createdAt))
      .limit(filter.limit)
      .offset(filter.offset)),
    scopedRead((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(committees).where(where)),
  ]);

  return { rows, total: countRows[0]?.count ?? 0 };
}

// ─── Members ─────────────────────────────────────────────────────────────────

/**
 * All membership rows for a committee (any status), newest appointment first.
 * RLS-scoped; the committee's existence is checked separately by the route.
 */
export async function getMembers(tenantId: string, committeeId: string): Promise<CommitteeMemberRow[]> {
  return scopedRead((tx) => tx
    .select()
    .from(committeeMembers)
    .where(and(eq(committeeMembers.tenantId, tenantId), eq(committeeMembers.committeeId, committeeId)))
    .orderBy(desc(committeeMembers.appointmentDate)));
}

/**
 * A single membership row by its id, scoped to the committee + tenant. Returns null
 * when absent (used by the member PATCH/DELETE routes to 404 and to read the current
 * `version` for the optimistic-locked write).
 */
export async function getMemberById(
  tenantId: string,
  committeeId: string,
  membershipId: string,
): Promise<CommitteeMemberRow | null> {
  const rows = await scopedRead((tx) => tx
    .select()
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.id, membershipId),
      ),
    )
    .limit(1));
  return rows[0] ?? null;
}

// ─── Terms-of-reference history (Req 2.7) ────────────────────────────────────────

/**
 * Versioned terms-of-reference revisions for a committee, most-recent effective
 * date first (append-only audit table).
 */
export async function getTermsHistory(tenantId: string, committeeId: string): Promise<CommitteeTermsHistoryRow[]> {
  return scopedRead((tx) => tx
    .select()
    .from(committeeTermsHistory)
    .where(and(eq(committeeTermsHistory.tenantId, tenantId), eq(committeeTermsHistory.committeeId, committeeId)))
    .orderBy(desc(committeeTermsHistory.effectiveDate)));
}

// ─── Statutory compliance report (Req 2.5) ───────────────────────────────────────

export interface ComplianceReport {
  committeeId: string;
  meetingFrequency: string | null;
  statutoryBasis: string | null;
  /** ISO date of the most recent meeting actually held, or null if none. */
  lastMeetingDate: string | null;
  /** Anchor used to compute the next obligation (last meeting, else constitution date). */
  anchorDate: string;
  /** ISO date the next meeting is due by, or null when no frequency obligation applies. */
  nextDueDate: string | null;
  /** True when a frequency obligation exists and the next-due date is in the past. */
  overdue: boolean;
  /** Whole days past the due date (0 when not overdue). */
  daysOverdue: number;
}

/**
 * Advance an ISO `YYYY-MM-DD` date by one statutory frequency period. Returns null for
 * `ad_hoc` / unknown frequencies (no fixed obligation). Uses UTC calendar arithmetic so
 * month/quarter/year steps land on the correct calendar date without DST skew.
 */
function addFrequency(iso: string, frequency: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  switch (frequency) {
    case "weekly":      d.setUTCDate(d.getUTCDate() + 7); break;
    case "fortnightly": d.setUTCDate(d.getUTCDate() + 14); break;
    case "monthly":     d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "quarterly":   d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "half_yearly": d.setUTCMonth(d.getUTCMonth() + 6); break;
    case "annual":      d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default:            return null; // ad_hoc / unrecognised → no obligation
  }
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (`later - earlier`), using UTC midnight. */
function daysBetween(earlierIso: string, laterIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.parse(`${earlierIso}T00:00:00Z`);
  const b = Date.parse(`${laterIso}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/** ISO `YYYY-MM-DD` for a Date value (or null passthrough). */
function toIsoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value.toISOString() : new Date(value).toISOString()).slice(0, 10);
}

/**
 * `meeting:{tenant}:committee:{committeeId}:compliance` — statutory meeting-frequency
 * compliance report (Req 2.5). Returns null when the committee is missing (route 404s).
 * The obligation is anchored to the most recent held meeting, falling back to the
 * committee's constitution date when it has never met.
 */
export async function getComplianceReport(tenantId: string, committeeId: string): Promise<ComplianceReport | null> {
  return cache.getOrLoad<ComplianceReport>(
    cache.makeKey(tenantId, RESOURCE, `${committeeId}:compliance`),
    async () => {
      const committee = await getCommitteeById(tenantId, committeeId);
      if (!committee) return null;

      const lastMeetingDate = await getLastHeldMeetingDate(tenantId, committeeId);
      const anchorDate = lastMeetingDate ?? toIsoDate(committee.constitutionDate)!;
      const frequency = committee.meetingFrequency ?? null;
      const today = new Date().toISOString().slice(0, 10);

      const nextDueDate = frequency ? addFrequency(anchorDate, frequency) : null;
      let overdue = false;
      let daysOverdue = 0;
      if (nextDueDate !== null && nextDueDate < today) {
        overdue = true;
        daysOverdue = daysBetween(nextDueDate, today);
      }

      return {
        committeeId,
        meetingFrequency: frequency,
        statutoryBasis: committee.statutoryBasis ?? null,
        lastMeetingDate,
        anchorDate,
        nextDueDate,
        overdue,
        daysOverdue,
      };
    },
    FACET_TTL,
  );
}

/** ISO date of the most recent actually-held meeting for a committee (or null). */
async function getLastHeldMeetingDate(tenantId: string, committeeId: string): Promise<string | null> {
  const rows = await scopedRead((tx) => tx
    .select({ scheduledAt: meetings.scheduledAt, actualStartAt: meetings.actualStartAt })
    .from(meetings)
    .where(
      and(
        eq(meetings.tenantId, tenantId),
        eq(meetings.committeeId, committeeId),
        inArray(meetings.status, HELD_STATUSES),
      ),
    )
    .orderBy(desc(meetings.scheduledAt))
    .limit(1));
  const row = rows[0];
  if (!row) return null;
  return toIsoDate(row.actualStartAt ?? row.scheduledAt);
}

// ─── Committee health dashboard ──────────────────────────────────────────────────

export interface CommitteeHealth {
  committeeId: string;
  name: string;
  type: string;
  status: string;
  /** Membership composition by lifecycle status + total. */
  memberCounts: Record<string, number> & { total: number };
  /** Active members whose tenure ends within 30 days (Req 2.4 advance-notice window). */
  membersExpiringSoon: number;
  /** The committee's configured quorum requirement (Req 2.3). */
  quorumRequirement: QuorumRule;
  /** Meeting activity summary. */
  meetings: {
    total: number;
    upcoming: number;
    held: number;
    lastMeetingDate: string | null;
  };
  /** Embedded statutory-frequency compliance summary (Req 2.5). */
  compliance: ComplianceReport;
}

/**
 * `meeting:{tenant}:committee:{committeeId}:health` — committee health dashboard.
 * Returns null when the committee is missing (route 404s). Aggregates membership
 * composition, tenure-expiry counts, meeting activity, quorum requirement, and the
 * compliance report into a single read for the governance dashboard.
 */
export async function getHealth(tenantId: string, committeeId: string): Promise<CommitteeHealth | null> {
  return cache.getOrLoad<CommitteeHealth>(
    cache.makeKey(tenantId, RESOURCE, `${committeeId}:health`),
    async () => {
      const committee = await getCommitteeById(tenantId, committeeId);
      if (!committee) return null;

      const [members, meetingCounts, compliance] = await Promise.all([
        getMembers(tenantId, committeeId),
        getMeetingActivity(tenantId, committeeId),
        getComplianceReport(tenantId, committeeId),
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const memberCounts: Record<string, number> & { total: number } = { total: members.length };
      let membersExpiringSoon = 0;
      for (const m of members) {
        memberCounts[m.status] = (memberCounts[m.status] ?? 0) + 1;
        if (m.status === "active" && isTenureExpiring(m.tenureEnd ?? null, today)) {
          membersExpiringSoon += 1;
        }
      }

      return {
        committeeId,
        name: committee.name,
        type: committee.type,
        status: committee.status,
        memberCounts,
        membersExpiringSoon,
        quorumRequirement: committee.quorumRule as QuorumRule,
        meetings: { ...meetingCounts, lastMeetingDate: compliance!.lastMeetingDate },
        compliance: compliance!,
      };
    },
    FACET_TTL,
  );
}

/** Meeting activity counts (total / upcoming / held) for a committee. */
async function getMeetingActivity(
  tenantId: string,
  committeeId: string,
): Promise<{ total: number; upcoming: number; held: number }> {
  const rows = await scopedRead((tx) => tx
    .select({ status: meetings.status, count: sql<number>`count(*)::int` })
    .from(meetings)
    .where(and(eq(meetings.tenantId, tenantId), eq(meetings.committeeId, committeeId), ne(meetings.status, "cancelled")))
    .groupBy(meetings.status));

  let total = 0;
  let upcoming = 0;
  let held = 0;
  for (const r of rows) {
    total += r.count;
    if (UPCOMING_STATUSES.includes(r.status)) upcoming += r.count;
    if (HELD_STATUSES.includes(r.status)) held += r.count;
  }
  return { total, upcoming, held };
}
