/**
 * Participant module — cache-first read model (CQRS read side, Req 5.1–5.7).
 *
 * This file is READ-ONLY: every write goes through the CQRS command publishers in
 * `commands.ts` → consumer → transactional outbox. Reads follow the suite rule "all reads
 * through Redis cache" (`cache.getOrLoad`, keyed `{service}:{tenant}:{resource}:{id}`).
 *
 * Cache keys owned here (invalidation contract shared with participant/commands.ts +
 * participant/consumer.ts, which both invalidate `meeting:{tenant}:participants:{meetingId}`
 * after every participant write):
 *   • `meeting:{tenant}:participants:{meetingId}`        → the meeting's full participant roster
 *     (getParticipants loads this key, then filters + paginates in memory so the exact key the
 *     writers invalidate is reused).
 *   • `meeting:{tenant}:participants:{meetingId}:quorum` → real-time quorum tally
 *     (getQuorumStatus). This is a LIVE figure that shifts with every RSVP, so it carries a
 *     SHORT 30s TTL as the self-healing backstop (mirroring the voting-module tally cache) —
 *     the writers invalidate the roster key, and the bounded TTL caps any quorum staleness.
 *
 * PII (DPDP Act 2023, Req 15.3): the read model NEVER selects `personal_email` /
 * `personal_phone`. Explicit column projections both keep PII out of every response body and
 * avoid decrypting values that are never surfaced to a reader.
 *
 * Ownership boundary (steering L2): this module owns `meeting.participants`. The parent
 * `meeting.meetings` table (meeting-core) and `meeting.committees` / `meeting.committee_members`
 * (committee) are read here tenant-scoped only as existence guards / quorum inputs, never written.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
 */
import { and, asc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { participants } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { computeQuorumConfirmation, type QuorumConfirmation } from "./domain.js";
import { requiredQuorumCount, type QuorumRule } from "../committee/domain.js";

/** Cache resource segment (shared with commands.ts + consumer.ts invalidation). */
const RESOURCE = "participants";
/** Quorum status is a live figure — short TTL bounds staleness after an RSVP (Req 5.3). */
const QUORUM_TTL_SECONDS = 30;

// ─── Read-model view (PII-free projection) ───────────────────────────────────

/**
 * A participant as exposed by the read model — the `meeting.participants` row WITHOUT the
 * encrypted PII columns (`personalEmail` / `personalPhone`, Req 15.3). Includes `version` so
 * the write routes can default the optimistic-lock version for a PATCH/DELETE.
 */
export interface ParticipantView {
  id: string;
  meetingId: string;
  employeeId: string;
  role: string;
  isMandatory: boolean;
  invitationStatus: string;
  declineReason: string | null;
  attendanceMode: string | null;
  nomineeId: string | null;
  agendaItemIds: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Explicit PII-free column projection reused by every participant read. */
const participantColumns = {
  id: participants.id,
  meetingId: participants.meetingId,
  employeeId: participants.employeeId,
  role: participants.role,
  isMandatory: participants.isMandatory,
  invitationStatus: participants.invitationStatus,
  declineReason: participants.declineReason,
  attendanceMode: participants.attendanceMode,
  nomineeId: participants.nomineeId,
  agendaItemIds: participants.agendaItemIds,
  createdAt: participants.createdAt,
  updatedAt: participants.updatedAt,
  version: participants.version,
} as const;

// ─── Existence guard (read-side, tenant-scoped) ──────────────────────────────

/** Minimal parent-meeting reference for the route existence guard + quorum inputs. */
export interface MeetingRef {
  id: string;
  committeeId: string | null;
}

/**
 * Direct (uncached) meeting existence lookup, tenant-scoped. Returns null when the meeting is
 * unknown / belongs to another tenant so the routes answer 404 before publishing a command or
 * serving a listing. Owned by meeting-core; read here purely as a boundary guard.
 */
export async function getMeetingRef(tenantId: string, meetingId: string): Promise<MeetingRef | null> {
  const rows = await scopedRead((tx) => tx
    .select({ id: meetings.id, committeeId: meetings.committeeId })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

// ─── Single participant (existence + version guard) ──────────────────────────

/**
 * Fetch a single participant (PII-free) scoped to its meeting + tenant. Read DIRECTLY (uncached)
 * because it backs the PATCH / DELETE / respond / nominate existence checks AND supplies the
 * current `version` for the optimistic-locked write — a stale cached version would cause spurious
 * 409s. Returns null when the participant is unknown / cross-tenant / on another meeting so the
 * routes answer 404.
 */
export async function getParticipant(
  tenantId: string,
  meetingId: string,
  participantId: string,
): Promise<ParticipantView | null> {
  const rows = await scopedRead((tx) => tx
    .select(participantColumns)
    .from(participants)
    .where(
      and(
        eq(participants.id, participantId),
        eq(participants.tenantId, tenantId),
        eq(participants.meetingId, meetingId),
      ),
    )
    .limit(1));
  return rows[0] ?? null;
}

// ─── Participant roster (list) ───────────────────────────────────────────────

export interface ParticipantListFilter {
  role?: string | undefined;
  invitationStatus?: string | undefined;
  limit: number;
  offset: number;
}

export interface ParticipantListResult {
  rows: ParticipantView[];
  total: number;
}

/** Load the meeting's full participant roster (PII-free), ordered by creation (append order). */
async function loadRoster(tenantId: string, meetingId: string): Promise<ParticipantView[]> {
  return scopedRead((tx) => tx
    .select(participantColumns)
    .from(participants)
    .where(and(eq(participants.tenantId, tenantId), eq(participants.meetingId, meetingId)))
    .orderBy(asc(participants.createdAt)));
}

/**
 * List a meeting's participants (Req 5.1). Cache-first on `participants:{meetingId}` — the exact
 * key the command publishers + consumer invalidate after every participant write — then filters
 * (role / invitationStatus) and paginates in memory so the cached roster is reused across every
 * filtered/paged view. Returns rows + the filtered total for the standard list envelope
 * `{ data, meta: { page, pageSize, total } }` built at the route boundary.
 */
export async function getParticipants(
  tenantId: string,
  meetingId: string,
  filter: ParticipantListFilter,
): Promise<ParticipantListResult> {
  const roster =
    (await cache.getOrLoad<ParticipantView[]>(
      cache.makeKey(tenantId, RESOURCE, meetingId),
      () => loadRoster(tenantId, meetingId),
    )) ?? [];

  let filtered = roster;
  if (filter.role !== undefined) filtered = filtered.filter((p) => p.role === filter.role);
  if (filter.invitationStatus !== undefined) {
    filtered = filtered.filter((p) => p.invitationStatus === filter.invitationStatus);
  }

  const total = filtered.length;
  const rows = filtered.slice(filter.offset, filter.offset + filter.limit);
  return { rows, total };
}

// ─── Real-time quorum status (Req 5.3, 5.4) ──────────────────────────────────

/** Real-time confirmed-vs-threshold quorum tally for a meeting (Req 5.3). */
export interface QuorumStatusView extends QuorumConfirmation {
  meetingId: string;
}

/**
 * Resolve the quorum threshold for a meeting's committee (Req 5.3): the required minimum
 * quorum-bearing members derived from the committee's quorum rule against its active roster size
 * (mirrors participant/consumer.ts `resolveQuorumThreshold`). Returns null when the meeting has no
 * committee (no threshold to check against).
 */
async function resolveThreshold(tenantId: string, committeeId: string | null): Promise<number | null> {
  if (!committeeId) return null;
  const rows = await scopedRead((tx) => tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1));
  const committee = rows[0];
  if (!committee) return null;

  const activeMembers = await scopedRead((tx) => tx
    .select({ memberId: committeeMembers.memberId })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.status, "active"),
      ),
    ));
  return requiredQuorumCount(committee.quorumRule as QuorumRule, activeMembers.length);
}

/**
 * Real-time quorum status for a meeting (Req 5.3, 5.4). Cache-first on
 * `participants:{meetingId}:quorum` with a SHORT 30s TTL (live figure — see file header).
 * Recomputes the confirmed-vs-threshold tally over the meeting's quorum-bearing participants
 * (domain `computeQuorumConfirmation`); a meeting with no committee yields a zero threshold
 * (trivially met). Returns null — without caching a miss — when the meeting is unknown /
 * cross-tenant so the route answers 404.
 */
export async function getQuorumStatus(tenantId: string, meetingId: string): Promise<QuorumStatusView | null> {
  return cache.getOrLoad<QuorumStatusView>(
    cache.makeKey(tenantId, RESOURCE, `${meetingId}:quorum`),
    async () => {
      const meeting = await getMeetingRef(tenantId, meetingId);
      if (!meeting) return null;

      const threshold = (await resolveThreshold(tenantId, meeting.committeeId)) ?? 0;
      const roster = await scopedRead((tx) => tx
        .select({ role: participants.role, invitationStatus: participants.invitationStatus })
        .from(participants)
        .where(and(eq(participants.tenantId, tenantId), eq(participants.meetingId, meetingId))));

      const confirmation = computeQuorumConfirmation(roster, threshold);
      return { meetingId, ...confirmation };
    },
    QUORUM_TTL_SECONDS,
  );
}
