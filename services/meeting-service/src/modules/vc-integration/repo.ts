/**
 * VC-integration module — cache-first DB reads (CQRS read side, Req 13.2, 13.3, 13.7).
 *
 * READ-ONLY: every write goes through the command publishers in commands.ts (route → zod →
 * queue.publish → 202) and is applied by consumer.ts. Reads follow the suite rule "all reads
 * through Redis cache" via `cache.getOrLoad` (keyed `{service}:{tenant}:{resource}:{id}`), with a
 * graceful fall-through to the DB on a cache miss (never a 500 for a cache problem).
 *
 * Cache keys owned here (all under the `vc` resource prefix so the consumer's
 * `cache.invalidateResource(tenantId, "vc")` clears every facet):
 *   - `meeting:{tenant}:vc:{meetingId}`               → getVcSession (the meeting's current session)
 *   - `meeting:{tenant}:vc:{meetingId}:participants`   → getVcParticipants (recorded VC presence)
 *
 * Ownership boundary (steering L2): this module owns `meeting.vc_sessions`. The parent
 * `meeting.meetings` table (meeting-core) and `meeting.attendance_records` / `meeting.participants`
 * (attendance / participant) are read here tenant-scoped purely as boundary guards / read-side
 * joins, never written.
 *
 * _Requirements: 13.2, 13.3, 13.7_
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { vcSessions } from "./schema.js";
import { meetings } from "../meeting-core/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import { participants } from "../participant/schema.js";

/** Cache resource prefix (shared invalidation contract with consumer.ts). */
const RESOURCE = "vc";

// ─── Parent-meeting guard (uncached — cheap PK lookup) ───────────────────────────

/** Minimal parent-meeting reference for the route existence guard. */
export interface MeetingRef {
  id: string;
  status: string;
  vcEnabled: boolean;
}

/**
 * Direct (uncached) meeting existence lookup, tenant-scoped. Returns null when the meeting is
 * unknown / belongs to another tenant so the routes can answer 404 before publishing a command.
 * Owned by meeting-core; read here as a boundary guard.
 */
export async function getMeetingRef(tenantId: string, meetingId: string): Promise<MeetingRef | null> {
  const rows = await db
    .select({ id: meetings.id, status: meetings.status, vcEnabled: meetings.vcEnabled })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── VC session read (Req 13.2, 13.7) ─────────────────────────────────────────────

/** Public read-model shape for a VC session (secrets like meeting_pin included for the host UI). */
export interface VcSessionView {
  id: string;
  meetingId: string;
  provider: string;
  externalId: string | null;
  joinUrl: string | null;
  dialInNumber: string | null;
  meetingPin: string | null;
  recordingUrl: string | null;
  recordingStorageKey: string | null;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The meeting's current VC session (the most recently created row for the meeting), or null when
 * none has been provisioned. Cached under `vc:{meetingId}`.
 */
export async function getVcSession(tenantId: string, meetingId: string): Promise<VcSessionView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, meetingId), async () => {
    const rows = await db
      .select()
      .from(vcSessions)
      .where(and(eq(vcSessions.meetingId, meetingId), eq(vcSessions.tenantId, tenantId)))
      .orderBy(desc(vcSessions.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      meetingId: row.meetingId,
      provider: row.provider,
      externalId: row.externalId,
      joinUrl: row.joinUrl,
      dialInNumber: row.dialInNumber,
      meetingPin: row.meetingPin,
      recordingUrl: row.recordingUrl,
      recordingStorageKey: row.recordingStorageKey,
      status: row.status,
      startedAt: toIso(row.startedAt),
      endedAt: toIso(row.endedAt),
      failureReason: row.failureReason,
    };
  });
}

/** Uncached VC session lookup by id (route guard: confirm the session belongs to the path meeting). */
export interface VcSessionRef {
  id: string;
  meetingId: string;
  status: string;
  provider: string;
  externalId: string | null;
}

export async function getVcSessionRef(tenantId: string, vcSessionId: string): Promise<VcSessionRef | null> {
  const rows = await db
    .select({
      id: vcSessions.id,
      meetingId: vcSessions.meetingId,
      status: vcSessions.status,
      provider: vcSessions.provider,
      externalId: vcSessions.externalId,
    })
    .from(vcSessions)
    .where(and(eq(vcSessions.id, vcSessionId), eq(vcSessions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── VC participants read (Req 13.3, 13.7) ─────────────────────────────────────────

/** One participant recorded as present via VC (mode = "vc"). */
export interface VcParticipantView {
  participantId: string;
  employeeId: string | null;
  role: string | null;
  status: string;
  joinedAt: string | null;
}

/**
 * The participants recorded as attending the meeting via VC presence (attendance rows with
 * mode = "vc"), captured by the provider webhook (Req 13.3). Cached under
 * `vc:{meetingId}:participants`.
 */
export async function getVcParticipants(tenantId: string, meetingId: string): Promise<VcParticipantView[]> {
  const loaded = await cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, `${meetingId}:participants`), async () => {
    const rows = await db
      .select({
        participantId: attendanceRecords.participantId,
        status: attendanceRecords.status,
        joinedAt: attendanceRecords.checkInAt,
        employeeId: participants.employeeId,
        role: participants.role,
      })
      .from(attendanceRecords)
      .leftJoin(
        participants,
        and(
          eq(participants.id, attendanceRecords.participantId),
          eq(participants.tenantId, attendanceRecords.tenantId),
        ),
      )
      .where(
        and(
          eq(attendanceRecords.tenantId, tenantId),
          eq(attendanceRecords.meetingId, meetingId),
          eq(attendanceRecords.mode, "vc"),
        ),
      )
      .orderBy(desc(attendanceRecords.checkInAt));
    return rows.map((r) => ({
      participantId: r.participantId,
      employeeId: r.employeeId ?? null,
      role: r.role ?? null,
      status: r.status,
      joinedAt: toIso(r.joinedAt),
    }));
  });
  return loaded ?? [];
}
