/**
 * Attendance module — cache-first DB reads + attendance-sheet rendering (CQRS read side).
 *
 * This file is read-only: every attendance write goes through commands.ts
 * (route → zod → queue.publish → 202) and is applied by consumer.ts. Reads follow the
 * suite rule "all reads through Redis cache" — the primary attendance resources are served
 * via `cache.getOrLoad` (keyed `{service}:{tenant}:{resource}:{id}`) and invalidated by the
 * consumer / command publishers after a write commits; a bounded TTL is the self-healing
 * backstop for any missed invalidation.
 *
 * Cache keys OWNED here (invalidation contract shared with commands.ts + consumer.ts — see
 * `invalidateAttendance` in both):
 *   - `meeting:{tenant}:attendance:{meetingId}`        → full attendance record list (getAttendance)
 *   - `meeting:{tenant}:attendance:{meetingId}:live`   → live dashboard (getLiveAttendance, 30s TTL)
 *   - `meeting:{tenant}:attendance:{meetingId}:count`  → count + quorum summary (getAttendanceCount)
 *
 * The parent meeting is OWNED by meeting-core; the lightweight existence guard used by the
 * routes (`getMeetingSnapshot`) reads it DIRECTLY (uncached) so a meeting whose quorum was
 * just latched, or that was just started, is reflected immediately and the shared
 * `meeting:{tenant}:meeting:{id}` key is not clobbered with a partial projection.
 *
 * `getLiveAttendance` uses the 60s-hot-path convention tightened to a 30s TTL (Req 6.3 real-time
 * dashboard): the value is regenerated at most every 30s even absent an explicit invalidation,
 * bounding staleness on the busiest attendance surface while still coalescing concurrent reads.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { and, asc, eq } from "drizzle-orm";
import { renderPdf } from "@civitasone/render";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { attendanceRecords, type AttendanceRecordRow } from "./schema.js";
import { participants } from "../participant/schema.js";
import { meetings } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { evaluateQuorum, type QuorumAttendee, type QuorumRule } from "./domain.js";

/** Cache resource segment (second-to-last key component). */
const RESOURCE_ATTENDANCE = "attendance";

/** Real-time dashboard TTL — hot path, tightened from the 60s default to 30s (Req 6.3). */
export const LIVE_TTL_SECONDS = 30;

/** Attendance statuses that count as "in the room" for quorum (present + joined_late, Req 6.4). */
const QUORUM_PRESENT_STATUSES = new Set(["present", "joined_late"]);

// ─── Parent-meeting guard (uncached — see file header) ───────────────────────

/** Live meeting projection used by the routes for the 404 guard + attendance-sheet header. */
export interface MeetingSnapshot {
  id: string;
  title: string;
  status: string;
  committeeId: string | null;
  venue: string | null;
  scheduledAt: Date | null;
  actualStartAt: Date | null;
  actualEndAt: Date | null;
  quorumEstablished: boolean;
  quorumEstablishedAt: Date | null;
  meetingNumber: string | null;
}

/**
 * Direct (uncached) meeting existence + snapshot lookup, tenant-scoped. The attendance routes
 * use it to return 404 before touching the read caches, and the sheet renderer uses it for the
 * document header. Owned by meeting-core; read here only as a boundary guard. Returns null when
 * the meeting is unknown / belongs to another tenant.
 */
export async function getMeetingSnapshot(tenantId: string, meetingId: string): Promise<MeetingSnapshot | null> {
  const rows = await scopedRead((tx) => tx
    .select({
      id: meetings.id,
      title: meetings.title,
      status: meetings.status,
      committeeId: meetings.committeeId,
      venue: meetings.venue,
      scheduledAt: meetings.scheduledAt,
      actualStartAt: meetings.actualStartAt,
      actualEndAt: meetings.actualEndAt,
      quorumEstablished: meetings.quorumEstablished,
      quorumEstablishedAt: meetings.quorumEstablishedAt,
      meetingNumber: meetings.meetingNumber,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

// ─── Attendance record list (Req 6.1, 6.6) ───────────────────────────────────

/** Optional in-memory filters applied after the cache load (keeps the cache key stable). */
export interface AttendanceListFilter {
  status?: string;
  mode?: string;
}

/**
 * List a meeting's attendance records (Req 6.1). Cache-first via `cache.getOrLoad` on
 * `attendance:{meetingId}` — the exact key the command publishers and consumer invalidate after
 * every attendance write — then optional `status` / `mode` filtering is applied in-memory so the
 * cached payload stays a single stable entry. Ordered by check-in time (arrival order).
 * Tenant-scoped for RLS-compatible isolation.
 */
export async function getAttendance(
  tenantId: string,
  meetingId: string,
  filter?: AttendanceListFilter,
): Promise<AttendanceRecordRow[]> {
  const rows =
    (await cache.getOrLoad<AttendanceRecordRow[]>(
      cache.makeKey(tenantId, RESOURCE_ATTENDANCE, meetingId),
      async () =>
        scopedRead((tx) => tx
          .select()
          .from(attendanceRecords)
          .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.meetingId, meetingId)))
          .orderBy(asc(attendanceRecords.checkInAt))),
    )) ?? [];

  if (!filter || (filter.status === undefined && filter.mode === undefined)) return rows;
  return rows.filter(
    (r) => (filter.status === undefined || r.status === filter.status) && (filter.mode === undefined || r.mode === filter.mode),
  );
}

// ─── Live attendance dashboard (Req 6.3) ──────────────────────────────────────

/** A single row of the real-time attendance dashboard (Req 6.3). */
export interface LiveAttendanceEntry {
  participantId: string;
  employeeId: string;
  role: string;
  isMandatory: boolean;
  /** present | absent | joined_late | left_early | attending_via_vc. `absent` = invited, no record. */
  status: string;
  mode: string | null;
  method: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
}

/** Real-time attendance dashboard: present/absent/joined_late/left_early/attending_via_vc (Req 6.3). */
export interface LiveAttendanceDashboard {
  meetingId: string;
  generatedAt: string;
  counts: {
    present: number;
    absent: number;
    joinedLate: number;
    leftEarly: number;
    attendingViaVc: number;
    total: number;
  };
  participants: LiveAttendanceEntry[];
}

/** Shape returned by the live-dashboard join (participant LEFT JOIN attendance). */
interface LiveJoinRow {
  participantId: string;
  employeeId: string;
  role: string;
  isMandatory: boolean;
  status: string | null;
  mode: string | null;
  method: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}

/** Tally a dashboard entry's status into the running counts. */
function tallyStatus(counts: LiveAttendanceDashboard["counts"], status: string): void {
  switch (status) {
    case "present":
      counts.present += 1;
      break;
    case "joined_late":
      counts.joinedLate += 1;
      break;
    case "left_early":
      counts.leftEarly += 1;
      break;
    case "attending_via_vc":
      counts.attendingViaVc += 1;
      break;
    default:
      counts.absent += 1;
      break;
  }
}

/**
 * Build the real-time attendance dashboard (Req 6.3): every invited participant with their live
 * attendance status. A participant with no attendance record is reported as `absent`; otherwise
 * the recorded status (present / joined_late / left_early / attending_via_vc) is surfaced verbatim.
 * Cache-first on `attendance:{meetingId}:live` with a 30s hot-path TTL so the busiest attendance
 * surface bounds its own staleness even between writes.
 */
export async function getLiveAttendance(tenantId: string, meetingId: string): Promise<LiveAttendanceDashboard> {
  const dashboard = await cache.getOrLoad<LiveAttendanceDashboard>(
    cache.makeKey(tenantId, RESOURCE_ATTENDANCE, `${meetingId}:live`),
    async () => {
      const rows: LiveJoinRow[] = await scopedRead((tx) => tx
        .select({
          participantId: participants.id,
          employeeId: participants.employeeId,
          role: participants.role,
          isMandatory: participants.isMandatory,
          status: attendanceRecords.status,
          mode: attendanceRecords.mode,
          method: attendanceRecords.method,
          checkInAt: attendanceRecords.checkInAt,
          checkOutAt: attendanceRecords.checkOutAt,
        })
        .from(participants)
        .leftJoin(
          attendanceRecords,
          and(
            eq(attendanceRecords.participantId, participants.id),
            eq(attendanceRecords.tenantId, participants.tenantId),
          ),
        )
        .where(and(eq(participants.tenantId, tenantId), eq(participants.meetingId, meetingId)))
        .orderBy(asc(participants.role)));

      const counts = { present: 0, absent: 0, joinedLate: 0, leftEarly: 0, attendingViaVc: 0, total: rows.length };
      const entries: LiveAttendanceEntry[] = rows.map((r) => {
        const status = r.status ?? "absent";
        tallyStatus(counts, status);
        return {
          participantId: r.participantId,
          employeeId: r.employeeId,
          role: r.role,
          isMandatory: r.isMandatory,
          status,
          mode: r.mode,
          method: r.method,
          checkInAt: r.checkInAt ? r.checkInAt.toISOString() : null,
          checkOutAt: r.checkOutAt ? r.checkOutAt.toISOString() : null,
        };
      });

      return { meetingId, generatedAt: new Date().toISOString(), counts, participants: entries };
    },
    LIVE_TTL_SECONDS,
  );

  return (
    dashboard ?? {
      meetingId,
      generatedAt: new Date().toISOString(),
      counts: { present: 0, absent: 0, joinedLate: 0, leftEarly: 0, attendingViaVc: 0, total: 0 },
      participants: [],
    }
  );
}

// ─── Attendance count + quorum summary (Req 6.4) ──────────────────────────────

/** Attendance count breakdown + quorum status for a meeting (Req 6.4). */
export interface AttendanceCountSummary {
  meetingId: string;
  total: number;
  present: number;
  joinedLate: number;
  leftEarly: number;
  attendingViaVc: number;
  /** Eligible attendees counted toward quorum (present + joined_late, honouring VC inclusion). */
  countedForQuorum: number;
  /** The persisted one-shot latch stamped on the meeting when quorum was first met. */
  quorumEstablished: boolean;
  /** Absolute members required by the committee rule, or null when the meeting has no committee. */
  quorumRequired: number | null;
  /** Live evaluation: does the current attendance set satisfy the committee's quorum rule? */
  quorumMet: boolean;
}

/**
 * Compute the attendance count + quorum summary for a meeting (Req 6.4). Cache-first on
 * `attendance:{meetingId}:count`. When the meeting is bound to a committee, the committee's
 * quorum rule is evaluated live against the present/joined_late attendance set (reusing the
 * committee module's evaluator via the attendance domain) to report `quorumRequired`,
 * `countedForQuorum` and `quorumMet`; `quorumEstablished` reflects the persisted latch on the
 * meeting. Returns null when the meeting is unknown / belongs to another tenant.
 */
export async function getAttendanceCount(tenantId: string, meetingId: string): Promise<AttendanceCountSummary | null> {
  return cache.getOrLoad<AttendanceCountSummary>(
    cache.makeKey(tenantId, RESOURCE_ATTENDANCE, `${meetingId}:count`),
    async () => {
      const meetingRows = await scopedRead((tx) => tx
        .select({ committeeId: meetings.committeeId, quorumEstablished: meetings.quorumEstablished })
        .from(meetings)
        .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
        .limit(1));
      const meeting = meetingRows[0];
      if (!meeting) return null;

      const attendees = await scopedRead((tx) => tx
        .select({
          status: attendanceRecords.status,
          mode: attendanceRecords.mode,
          role: participants.role,
        })
        .from(attendanceRecords)
        .innerJoin(
          participants,
          and(
            eq(participants.id, attendanceRecords.participantId),
            eq(participants.tenantId, attendanceRecords.tenantId),
          ),
        )
        .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.meetingId, meetingId))));

      const summary: AttendanceCountSummary = {
        meetingId,
        total: attendees.length,
        present: 0,
        joinedLate: 0,
        leftEarly: 0,
        attendingViaVc: 0,
        countedForQuorum: 0,
        quorumEstablished: meeting.quorumEstablished,
        quorumRequired: null,
        quorumMet: false,
      };
      for (const a of attendees) {
        switch (a.status) {
          case "present":
            summary.present += 1;
            break;
          case "joined_late":
            summary.joinedLate += 1;
            break;
          case "left_early":
            summary.leftEarly += 1;
            break;
          case "attending_via_vc":
            summary.attendingViaVc += 1;
            break;
          default:
            break;
        }
      }

      if (meeting.committeeId) {
        const committeeRows = await scopedRead((tx) => tx
          .select({ quorumRule: committees.quorumRule })
          .from(committees)
          .where(and(eq(committees.id, meeting.committeeId!), eq(committees.tenantId, tenantId)))
          .limit(1));
        const rule = committeeRows[0]?.quorumRule as QuorumRule | undefined;
        if (rule) {
          const activeRows = await scopedRead((tx) => tx
            .select({ id: committeeMembers.id })
            .from(committeeMembers)
            .where(
              and(
                eq(committeeMembers.tenantId, tenantId),
                eq(committeeMembers.committeeId, meeting.committeeId!),
                eq(committeeMembers.status, "active"),
              ),
            ));
          const evaluation = evaluateQuorum(attendees as QuorumAttendee[], rule, activeRows.length);
          summary.quorumRequired = evaluation.requiredMembers;
          summary.countedForQuorum = evaluation.countedAttendees;
          summary.quorumMet = evaluation.established;
        }
      }

      // No committee rule → the eligible-attendee count is still informative.
      if (summary.quorumRequired === null) {
        summary.countedForQuorum = attendees.filter((a) => QUORUM_PRESENT_STATUSES.has(a.status)).length;
      }

      return summary;
    },
  );
}

// ─── Attendance sheet (PDF, Req 6.6) ──────────────────────────────────────────

/** Rendered attendance-sheet document. */
export interface AttendanceSheetResult {
  buffer: Buffer;
  filename: string;
  contentType: "application/pdf";
}

/** HTML-escape a value for safe interpolation into the attendance-sheet template. */
function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format an ISO timestamp for display, or a dash when absent. */
function fmt(iso: string | null): string {
  return iso ? esc(iso) : "—";
}

/**
 * Generate the meeting attendance sheet as a PDF (Req 6.6): every participant with their
 * attendance status, arrival time, departure time and mode of attendance, under a header
 * carrying the meeting title / number / venue. Renders via `@civitasone/render` (Playwright,
 * with an HTML fallback when unavailable). NOT cached — the sheet is produced on demand at
 * meeting close. Returns null when the meeting is unknown / belongs to another tenant.
 */
export async function generateAttendanceSheet(tenantId: string, meetingId: string): Promise<AttendanceSheetResult | null> {
  const meeting = await getMeetingSnapshot(tenantId, meetingId);
  if (!meeting) return null;

  const dashboard = await getLiveAttendance(tenantId, meetingId);

  const rowsHtml = dashboard.participants
    .map(
      (p) => `
      <tr>
        <td>${esc(p.employeeId)}</td>
        <td>${esc(p.role)}</td>
        <td>${esc(p.status)}</td>
        <td>${fmt(p.checkInAt)}</td>
        <td>${fmt(p.checkOutAt)}</td>
        <td>${esc(p.mode ?? "—")}</td>
      </tr>`,
    )
    .join("");

  const c = dashboard.counts;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #f0f0f0; }
  .summary { margin-top: 12px; color: #333; }
</style>
</head>
<body>
  <h1>Attendance Sheet</h1>
  <div class="meta">
    <div><strong>Meeting:</strong> ${esc(meeting.title)}</div>
    <div><strong>Meeting No.:</strong> ${esc(meeting.meetingNumber ?? "—")}</div>
    <div><strong>Venue:</strong> ${esc(meeting.venue ?? "—")}</div>
    <div><strong>Quorum established:</strong> ${meeting.quorumEstablished ? "Yes" : "No"}</div>
  </div>
  <table>
    <thead>
      <tr><th>Participant</th><th>Role</th><th>Status</th><th>Arrival</th><th>Departure</th><th>Mode</th></tr>
    </thead>
    <tbody>${rowsHtml || `<tr><td colspan="6">No participants recorded.</td></tr>`}</tbody>
  </table>
  <div class="summary">
    Present: ${c.present} · Joined late: ${c.joinedLate} · Left early: ${c.leftEarly} ·
    Attending via VC: ${c.attendingViaVc} · Absent: ${c.absent} · Total invited: ${c.total}
  </div>
</body>
</html>`;

  const result = await renderPdf({ html, format: "A4" });
  return { buffer: result.buffer, filename: `attendance-${meetingId}.pdf`, contentType: "application/pdf" };
}
