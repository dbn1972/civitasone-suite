/**
 * Attendance module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 6.1–6.7).
 *
 * Every handler follows the strict order mandated by steering (Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard; if it returns false the
 *      message was already processed, so we skip (P30).
 *   3. Business write (INSERT / UPSERT / UPDATE of the attendance record).
 *   4. Emit domain EVENTS + an audit event into the transactional outbox (same tx, so
 *      "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Pure domain rules live in domain.ts (`assertParticipantInvited`, `resolveCheckInStatus`,
 * `assertWithinGeoFence`, `verifyMeetingQrToken`, `verifyQuorum`) and in the committee module's
 * quorum evaluator (reused via domain.ts). This file wires them to persistence.
 *
 * Quorum establishment (Req 6.4): after every attendance write we re-evaluate the meeting's
 * committee quorum against the live attendance set (present + joined_late, honouring the rule's
 * VC-inclusion + role composition). The FIRST time quorum is met we LATCH it onto the meeting —
 * a single guarded UPDATE `WHERE quorum_established = false` sets `quorum_established = true` and
 * stamps `quorum_established_at` exactly once — and emit `meeting.attendance.quorum_established`.
 * The latch is concurrency-safe (no version conflict) and idempotent (a later check-in that also
 * satisfies quorum is a no-op because the guard no longer matches).
 *
 * Permanent (non-retryable) violations — an un-invited participant, a bad/expired QR token, an
 * out-of-fence geo check-in, a malformed message — are re-thrown as `NonRetryableError` so they
 * go straight to the DLQ instead of being retried forever.
 *
 * Registration: `registerAttendanceConsumers(register)` maps each attendance COMMANDS topic to
 * its handler; worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { and, eq, sql } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, type DrizzleTx } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { attendanceRecords } from "./schema.js";
import { participants } from "../participant/schema.js";
import { meetings, meetingTypes } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import {
  assertParticipantInvited,
  assertWithinGeoFence,
  resolveCheckInStatus,
  verifyMeetingQrToken,
  verifyQuorum,
  QUORUM_PRESENT_STATUSES,
  type AttendanceMode,
  type AttendanceStatus,
  type GeoFence,
  type QuorumAttendee,
  type QuorumRule,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "attendance";
const MEETING_RESOURCE = "meeting";

/** Env var holding the HMAC secret used to sign/verify meeting QR tokens (Req 6.2). */
const QR_SECRET_ENV = "MEETING_QR_SECRET";

// ─── Command payload contracts (mirror topics.ts COMMANDS.attendance*) ───────────

interface CheckInPayload {
  attendanceId: string;
  meetingId: string;
  tenantId: string;
  participantId: string;
  method: string;
  mode?: string;
  checkInAt: string;
  qrToken?: string;
  geoLatitude?: number;
  geoLongitude?: number;
  deviceId?: string;
}

interface CheckOutPayload {
  meetingId: string;
  tenantId: string;
  participantId: string;
  checkOutAt: string;
}

interface ManualMarkPayload {
  attendanceId: string;
  meetingId: string;
  tenantId: string;
  participantId: string;
  status: AttendanceStatus;
  mode?: string;
  checkInAt?: string;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Convert a domain validation `HttpError` into a permanent DLQ error (never retry a bad request). */
function asPermanent(err: unknown): never {
  if (err instanceof HttpError) throw new NonRetryableError(err.message, err);
  throw err;
}

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(tx: DrizzleTx, msg: MsgMeta, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType: "attendance_record", resourceId, outcome: "success" },
  });
}

/** The meeting fields needed to authorise + classify a check-in and to latch quorum. */
interface MeetingContext {
  id: string;
  status: string;
  type: string;
  committeeId: string | null;
  actualStartAt: Date | null;
  quorumEstablished: boolean;
}

/** Load the parent meeting within the tx (null when missing / other tenant). */
async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string): Promise<MeetingContext | null> {
  const rows = await tx
    .select({
      id: meetings.id,
      status: meetings.status,
      type: meetings.type,
      committeeId: meetings.committeeId,
      actualStartAt: meetings.actualStartAt,
      quorumEstablished: meetings.quorumEstablished,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load the participant row for check-in authorisation (null when missing / other tenant). */
async function loadParticipant(tx: DrizzleTx, meetingId: string, participantId: string, tenantId: string) {
  const rows = await tx
    .select({
      id: participants.id,
      meetingId: participants.meetingId,
      invitationStatus: participants.invitationStatus,
      role: participants.role,
    })
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Guard against a participant id that belongs to a different meeting.
  return row.meetingId === meetingId ? row : null;
}

/**
 * Resolve an optional venue geo-fence for the meeting from its meeting-type template config
 * (`meeting_types.template_config.geoFence = { center: { latitude, longitude }, radiusMeters }`).
 * Returns null when the type has no such config — in that case geo check-ins are accepted on the
 * strength of well-formed coordinates alone (the zod validator already bounds lat/long ranges).
 */
async function resolveGeoFence(tx: DrizzleTx, tenantId: string, meetingType: string): Promise<GeoFence | null> {
  const rows = await tx
    .select({ templateConfig: meetingTypes.templateConfig })
    .from(meetingTypes)
    .where(and(eq(meetingTypes.tenantId, tenantId), eq(meetingTypes.code, meetingType)))
    .limit(1);
  const cfg = rows[0]?.templateConfig as { geoFence?: unknown } | null | undefined;
  const fence = cfg?.geoFence as
    | { center?: { latitude?: unknown; longitude?: unknown }; radiusMeters?: unknown }
    | undefined;
  if (!fence || !fence.center) return null;
  const { latitude, longitude } = fence.center;
  if (typeof latitude !== "number" || typeof longitude !== "number" || typeof fence.radiusMeters !== "number") {
    return null;
  }
  return { center: { latitude, longitude }, radiusMeters: fence.radiusMeters };
}

/** The live attendance set for a meeting, shaped for quorum evaluation + present-member listing. */
interface LiveAttendee extends QuorumAttendee {
  participantId: string;
}

/** Load every attendance record for a meeting joined to its participant role (for quorum). */
async function loadLiveAttendees(tx: DrizzleTx, meetingId: string, tenantId: string): Promise<LiveAttendee[]> {
  return tx
    .select({
      participantId: attendanceRecords.participantId,
      status: attendanceRecords.status,
      mode: attendanceRecords.mode,
      role: participants.role,
    })
    .from(attendanceRecords)
    .innerJoin(
      participants,
      and(eq(participants.id, attendanceRecords.participantId), eq(participants.tenantId, attendanceRecords.tenantId)),
    )
    .where(and(eq(attendanceRecords.tenantId, tenantId), eq(attendanceRecords.meetingId, meetingId)));
}

/** Count the committee's active roster (resolves a percentage-based quorum rule to a count). */
async function countActiveMembers(tx: DrizzleTx, tenantId: string, committeeId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.status, "active"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Re-evaluate quorum for the meeting and, the FIRST time it is met, latch
 * `quorum_established` / `quorum_established_at` onto the meeting and emit
 * `meeting.attendance.quorum_established` (Req 6.4).
 *
 * No-op when the meeting has no committee (quorum is committee-defined) or when quorum is already
 * established. The latch UPDATE is guarded on `quorum_established = false`, so it fires exactly
 * once even under concurrent check-ins — the guard, not optimistic versioning, guarantees the
 * one-shot semantics without risking a spurious version conflict on a hot attendance path.
 */
async function maybeEstablishQuorum(
  tx: DrizzleTx,
  msg: MsgMeta,
  meeting: MeetingContext,
  now: Date,
): Promise<void> {
  if (!meeting.committeeId || meeting.quorumEstablished) return;

  const committeeRows = await tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, meeting.committeeId), eq(committees.tenantId, msg.tenantId)))
    .limit(1);
  const rule = committeeRows[0]?.quorumRule as QuorumRule | undefined;
  if (!rule) return;

  const [attendees, totalActiveMembers] = await Promise.all([
    loadLiveAttendees(tx, meeting.id, msg.tenantId),
    countActiveMembers(tx, msg.tenantId, meeting.committeeId),
  ]);

  const evaluation = verifyQuorum(attendees, rule, totalActiveMembers);
  if (!evaluation.established) return;

  // One-shot latch: only the first satisfying write flips the flag + stamps the time.
  const latched = await tx
    .update(meetings)
    .set({
      quorumEstablished: true,
      quorumEstablishedAt: now,
      updatedBy: msg.actorId,
      updatedAt: now,
      version: sql`${meetings.version} + 1`,
    })
    .where(
      and(
        eq(meetings.id, meeting.id),
        eq(meetings.tenantId, msg.tenantId),
        eq(meetings.quorumEstablished, false),
      ),
    )
    .returning({ id: meetings.id });

  if (latched.length === 0) return; // another concurrent write latched it first

  const presentMemberIds = attendees
    .filter((a) => (QUORUM_PRESENT_STATUSES as readonly string[]).includes(a.status))
    .map((a) => a.participantId);

  await enqueue(tx, {
    topic: EVENTS.quorumEstablished,
    eventType: EVENTS.quorumEstablished,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { meetingId: meeting.id, establishedAt: now.toISOString(), presentMemberIds },
  });
  await audit(tx, msg, "quorum_established", meeting.id);
}

/** Emit the `meeting.attendance.marked` domain fact for a captured attendance row. */
async function emitAttendanceMarked(
  tx: DrizzleTx,
  msg: MsgMeta,
  args: { meetingId: string; participantId: string; method: string; status: AttendanceStatus },
): Promise<void> {
  await enqueue(tx, {
    topic: EVENTS.attendanceMarked,
    eventType: EVENTS.attendanceMarked,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      meetingId: args.meetingId,
      participantId: args.participantId,
      method: args.method,
      status: args.status,
    },
  });
}

/** Best-effort attendance read-cache invalidation after commit (+ meeting for quorum latch). */
async function invalidateAttendance(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, meetingId));
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, `${meetingId}:live`));
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, `${meetingId}:count`));
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * attendance.check_in — verify invited participant, resolve status, enforce geo-fence / QR,
 * INSERT the record (idempotent on the (meeting, participant) unique index), then re-evaluate
 * quorum (Req 6.1–6.5).
 */
async function handleCheckIn(msg: CommandEnvelope<CheckInPayload>): Promise<void> {
  const p = msg.payload;
  const checkInAt = new Date(p.checkInAt);
  const mode: AttendanceMode = p.mode === "vc" ? "vc" : "in_person";

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return; // unknown meeting → nothing to do (route 404s before publishing)

    // Req 6.2: only an invited participant may check in.
    const participant = await loadParticipant(tx, p.meetingId, p.participantId, msg.tenantId);
    try {
      assertParticipantInvited(participant, p.meetingId);
    } catch (err) {
      asPermanent(err);
    }

    // Req 6.2: a QR check-in must present a genuine, unexpired token for THIS meeting.
    if (p.method === "qr") {
      const secret = process.env[QR_SECRET_ENV];
      if (!secret) {
        throw new NonRetryableError(`${QR_SECRET_ENV} is not configured; cannot verify QR check-in`);
      }
      const token = p.qrToken ?? "";
      const result = verifyMeetingQrToken(token, { secret, now: checkInAt, expectedMeetingId: p.meetingId });
      if (!result.valid) {
        throw new NonRetryableError(`QR check-in rejected (${result.reason})`);
      }
    }

    // Req 6.1: a geo check-in must fall within the configured venue radius (when a fence exists).
    if (p.method === "geo" && p.geoLatitude !== undefined && p.geoLongitude !== undefined) {
      const fence = await resolveGeoFence(tx, msg.tenantId, meeting.type);
      if (fence) {
        try {
          assertWithinGeoFence({ latitude: p.geoLatitude, longitude: p.geoLongitude }, fence);
        } catch (err) {
          asPermanent(err);
        }
      }
    }

    // Req 6.3, 6.5, 6.7: derive present / joined_late / attending_via_vc.
    const status = resolveCheckInStatus(checkInAt, meeting.actualStartAt, mode);

    // Insert the record; the (meeting, participant) unique index makes a redelivered / duplicate
    // check-in a harmless no-op (idempotent), so we skip event emission when nothing was inserted.
    const inserted = await tx
      .insert(attendanceRecords)
      .values({
        id: p.attendanceId,
        tenantId: msg.tenantId,
        meetingId: p.meetingId,
        participantId: p.participantId,
        method: p.method,
        checkInAt,
        mode,
        status,
        geoLatitude: p.geoLatitude !== undefined ? String(p.geoLatitude) : null,
        geoLongitude: p.geoLongitude !== undefined ? String(p.geoLongitude) : null,
        deviceId: p.deviceId ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      })
      .onConflictDoNothing({ target: [attendanceRecords.meetingId, attendanceRecords.participantId] })
      .returning({ id: attendanceRecords.id });

    if (inserted.length === 0) return; // participant already checked in

    await emitAttendanceMarked(tx, msg, {
      meetingId: p.meetingId,
      participantId: p.participantId,
      method: p.method,
      status,
    });
    await audit(tx, msg, "check_in", p.attendanceId);

    await maybeEstablishQuorum(tx, msg, meeting, checkInAt);
  });

  await invalidateAttendance(msg.tenantId, p.meetingId);
  await cache.invalidate(cache.makeKey(msg.tenantId, MEETING_RESOURCE, p.meetingId));
}

/** attendance.check_out — stamp `check_out_at` on the participant's existing record (Req 6.6). */
async function handleCheckOut(msg: CommandEnvelope<CheckOutPayload>): Promise<void> {
  const p = msg.payload;
  const checkOutAt = new Date(p.checkOutAt);

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const updated = await tx
      .update(attendanceRecords)
      .set({
        checkOutAt,
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: sql`${attendanceRecords.version} + 1`,
      })
      .where(
        and(
          eq(attendanceRecords.tenantId, msg.tenantId),
          eq(attendanceRecords.meetingId, p.meetingId),
          eq(attendanceRecords.participantId, p.participantId),
        ),
      )
      .returning({ id: attendanceRecords.id });

    const recordId = updated[0]?.id;
    if (!recordId) return; // no check-in on record → nothing to check out

    await audit(tx, msg, "check_out", recordId);
  });

  await invalidateAttendance(msg.tenantId, p.meetingId);
}

/**
 * attendance.manual_mark — secretary sets an explicit status for a participant (Req 6.1). Upserts
 * the (meeting, participant) record so it can both create a record when automated capture was
 * unavailable and correct an existing one, then re-evaluates quorum.
 */
async function handleManualMark(msg: CommandEnvelope<ManualMarkPayload>): Promise<void> {
  const p = msg.payload;
  const mode: AttendanceMode = p.mode === "vc" ? "vc" : "in_person";
  const checkInAt = p.checkInAt ? new Date(p.checkInAt) : new Date();

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;

    // Req 6.2: the manually-marked person must still be an invited participant of the meeting.
    const participant = await loadParticipant(tx, p.meetingId, p.participantId, msg.tenantId);
    try {
      assertParticipantInvited(participant, p.meetingId);
    } catch (err) {
      asPermanent(err);
    }

    await tx
      .insert(attendanceRecords)
      .values({
        id: p.attendanceId,
        tenantId: msg.tenantId,
        meetingId: p.meetingId,
        participantId: p.participantId,
        method: "manual",
        checkInAt,
        mode,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.meetingId, attendanceRecords.participantId],
        set: {
          method: "manual",
          mode,
          status: p.status,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: sql`${attendanceRecords.version} + 1`,
        },
      });

    await emitAttendanceMarked(tx, msg, {
      meetingId: p.meetingId,
      participantId: p.participantId,
      method: "manual",
      status: p.status,
    });
    await audit(tx, msg, "manual_mark", p.attendanceId);

    await maybeEstablishQuorum(tx, msg, meeting, checkInAt);
  });

  await invalidateAttendance(msg.tenantId, p.meetingId);
  await cache.invalidate(cache.makeKey(msg.tenantId, MEETING_RESOURCE, p.meetingId));
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every attendance command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the attendance COMMANDS topics to the handlers above.
 */
export function registerAttendanceConsumers(register: RegisterConsumer): void {
  register(COMMANDS.attendanceCheckIn, handleCheckIn);
  register(COMMANDS.attendanceCheckOut, handleCheckOut);
  register(COMMANDS.attendanceManualMark, handleManualMark);
}
