/**
 * Agenda module — cache-first DB reads (CQRS read side).
 *
 * This file is read-only: every write goes through the command publishers in commands.ts
 * (route → zod → queue.publish → 202) and is applied by consumer.ts. Reads follow the
 * suite rule "all reads through Redis cache" — the primary agenda resources are served via
 * `cache.getOrLoad` (keyed `{service}:{tenant}:{resource}:{id}`) and invalidated by the
 * consumer / command publishers after a write commits; a bounded TTL is the self-healing
 * backstop for any missed invalidation.
 *
 * Cache keys owned here (invalidation contract shared with agenda/commands.ts + consumer.ts):
 *   - `meeting:{tenant}:agenda:{meetingId}`          → ordered agenda listing (getAgendaByMeeting)
 *   - `meeting:{tenant}:agenda_item:{itemId}`        → single agenda item (getAgendaItem)
 *   - `meeting:{tenant}:agenda_deadline:{meetingId}` → submission-deadline status (checkDeadline)
 *
 * The parent meeting is OWNED by meeting-core; the lightweight existence/status guard used by
 * the routes (`getMeetingStatus`) reads it DIRECTLY (uncached). Caching a partial meeting
 * projection under the shared `meeting:{tenant}:meeting:{id}` key would clobber meeting-core's
 * own read cache, and lock/unlock changes the meeting status — the guard must see it live.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.5, 4.5_
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { agendaItems, type AgendaItemRow } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { computeSubmissionDeadline, isPastSubmissionDeadline, type AgendaConfig } from "./domain.js";

/** Cache resource segments (second-to-last key component). */
const RESOURCE_AGENDA = "agenda";
const RESOURCE_AGENDA_ITEM = "agenda_item";
const RESOURCE_AGENDA_DEADLINE = "agenda_deadline";

/**
 * List a meeting's agenda ordered by `sequence` ascending (Req 3.3). Cache-first via
 * `cache.getOrLoad` on `agenda:{meetingId}` — the exact key the command publishers and
 * consumer invalidate after every agenda write. Withdrawn items are retained in the listing
 * (they keep their historical sequence) so the audit view is complete; callers filter by
 * `status` as needed. Tenant-scoped for RLS-compatible isolation.
 */
export async function getAgendaByMeeting(tenantId: string, meetingId: string): Promise<AgendaItemRow[]> {
  const rows = await cache.getOrLoad<AgendaItemRow[]>(
    cache.makeKey(tenantId, RESOURCE_AGENDA, meetingId),
    async () =>
      db
        .select()
        .from(agendaItems)
        .where(and(eq(agendaItems.tenantId, tenantId), eq(agendaItems.meetingId, meetingId)))
        .orderBy(asc(agendaItems.sequence)),
  );
  return rows ?? [];
}

/**
 * Fetch a single agenda item by id (Req 3.1). Cache-first on `agenda_item:{itemId}`; returns
 * null (and does not cache a hit) when the item does not exist or belongs to another tenant —
 * the PATCH / DELETE routes use this to answer 404 before publishing a command.
 */
export async function getAgendaItem(tenantId: string, itemId: string): Promise<AgendaItemRow | null> {
  return cache.getOrLoad<AgendaItemRow>(cache.makeKey(tenantId, RESOURCE_AGENDA_ITEM, itemId), async () => {
    const rows = await db
      .select()
      .from(agendaItems)
      .where(and(eq(agendaItems.id, itemId), eq(agendaItems.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/** Live existence/status of the parent meeting for the route guards (uncached — see file header). */
export interface MeetingStatus {
  id: string;
  status: string;
  scheduledAt: Date | null;
}

/**
 * Direct (uncached) meeting existence + status lookup, tenant-scoped. Used by the agenda routes
 * to return 404 when the meeting is unknown and to reflect lock/unlock status changes
 * immediately. Owned by meeting-core; read here only as a boundary guard.
 */
export async function getMeetingStatus(tenantId: string, meetingId: string): Promise<MeetingStatus | null> {
  const rows = await db
    .select({ id: meetings.id, status: meetings.status, scheduledAt: meetings.scheduledAt })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Submission-deadline + agenda-readiness snapshot for a meeting (Req 3.5, 4.5). */
export interface AgendaDeadlineStatus {
  meetingId: string;
  /** Meeting scheduled time (ISO-8601) or null while the meeting is still a draft. */
  scheduledAt: string | null;
  /** Computed submission cut-off = scheduledAt − deadlineDays (ISO-8601), or null. */
  submissionDeadline: string | null;
  /** True once `now` is at/after the submission cut-off (proposals then need chairperson approval). */
  pastDeadline: boolean;
  /** Count of non-withdrawn agenda items. */
  itemCount: number;
  /** Count of items in the `accepted` state (finalised onto the agenda). */
  acceptedCount: number;
}

/**
 * Compute the agenda submission-deadline status for a meeting (Req 3.5). Cache-first on
 * `agenda_deadline:{meetingId}` — a bounded TTL bounds the staleness after a reschedule since
 * this key is derived from the (meeting-core-owned) `scheduled_at`. Returns null when the
 * meeting does not exist / belongs to another tenant.
 */
export async function checkDeadline(
  tenantId: string,
  meetingId: string,
  config?: AgendaConfig,
): Promise<AgendaDeadlineStatus | null> {
  return cache.getOrLoad<AgendaDeadlineStatus>(
    cache.makeKey(tenantId, RESOURCE_AGENDA_DEADLINE, meetingId),
    async () => {
      const meetingRows = await db
        .select({ scheduledAt: meetings.scheduledAt })
        .from(meetings)
        .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
        .limit(1);
      const meeting = meetingRows[0];
      if (!meeting) return null;

      const items = await db
        .select({ status: agendaItems.status })
        .from(agendaItems)
        .where(
          and(
            eq(agendaItems.tenantId, tenantId),
            eq(agendaItems.meetingId, meetingId),
            ne(agendaItems.status, "withdrawn"),
          ),
        );

      const scheduledAt = meeting.scheduledAt ?? null;
      const deadline = scheduledAt ? computeSubmissionDeadline(scheduledAt, config) : null;
      const pastDeadline = scheduledAt ? isPastSubmissionDeadline(scheduledAt, new Date(), config) : false;

      return {
        meetingId,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
        submissionDeadline: deadline ? deadline.toISOString() : null,
        pastDeadline,
        itemCount: items.length,
        acceptedCount: items.filter((i) => i.status === "accepted").length,
      };
    },
  );
}
