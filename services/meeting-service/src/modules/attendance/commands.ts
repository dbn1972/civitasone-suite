/**
 * Attendance module — command publishing helpers (CQRS write path).
 *
 * Routes (task 8.3) call these helpers after zod validation to publish a write intent
 * onto the queue and return `202 Accepted`; the attendance consumer (see consumer.ts) does
 * the actual DB write inside a single transaction. The HTTP layer never touches Postgres
 * (steering: "routes never write to Postgres directly").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.attendance*` topic (contract documented in src/topics.ts). For the writes
 * that create a brand-new attendance row (check-in, manual mark) the primary id is minted here
 * and reused as the `messageId` so the write is naturally idempotent (a redelivery of the same
 * command is skipped by `markProcessed`) and the client gets a stable id to poll.
 *
 * `checkInAt` / `checkOutAt` default to server time when the client omits them so the wire
 * payload is always fully-resolved before it reaches the consumer.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  AttendanceCheckInInput,
  AttendanceCheckOutInput,
  AttendanceManualMarkInput,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface AttendanceCommandAccepted {
  /** The primary resource id the client can poll (attendance record id). */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Best-effort invalidation of a meeting's attendance read caches after a write is queued. */
async function invalidateAttendance(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "attendance", meetingId));
  // Live dashboard + quorum status are derived facets of the same resource.
  await cache.invalidate(cache.makeKey(tenantId, "attendance", `${meetingId}:live`));
  await cache.invalidate(cache.makeKey(tenantId, "attendance", `${meetingId}:count`));
}

/**
 * Record a participant check-in (Req 6.1, 6.2). The attendance record id is minted here and
 * reused as the message id for idempotency. `checkInAt` defaults to now when omitted. The
 * consumer verifies the participant is invited, resolves present/joined_late/attending_via_vc
 * status, enforces the geo-fence (geo) / verifies the QR token (qr), inserts the record, and
 * re-evaluates quorum.
 */
export async function attendanceCheckIn(
  ctx: RequestContext,
  meetingId: string,
  body: AttendanceCheckInInput,
): Promise<AttendanceCommandAccepted> {
  const attendanceId = randomUUID();
  const checkInAt = (body.checkInAt ?? new Date()).toISOString();
  await queue.publish(COMMANDS.attendanceCheckIn, {
    messageId: attendanceId,
    type: COMMANDS.attendanceCheckIn,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      attendanceId,
      meetingId,
      tenantId: ctx.tenantId,
      participantId: body.participantId,
      method: body.method,
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      checkInAt,
      ...(body.qrToken !== undefined ? { qrToken: body.qrToken } : {}),
      ...(body.geoLatitude !== undefined ? { geoLatitude: body.geoLatitude } : {}),
      ...(body.geoLongitude !== undefined ? { geoLongitude: body.geoLongitude } : {}),
      ...(body.deviceId !== undefined ? { deviceId: body.deviceId } : {}),
    },
  });
  await invalidateAttendance(ctx.tenantId, meetingId);
  return { id: attendanceId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Record a participant check-out (Req 6.6). `checkOutAt` defaults to now when omitted. The
 * consumer updates the existing (meeting, participant) attendance record's `check_out_at`.
 */
export async function attendanceCheckOut(
  ctx: RequestContext,
  meetingId: string,
  body: AttendanceCheckOutInput,
): Promise<AttendanceCommandAccepted> {
  const checkOutAt = (body.checkOutAt ?? new Date()).toISOString();
  await queue.publish(COMMANDS.attendanceCheckOut, {
    type: COMMANDS.attendanceCheckOut,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      meetingId,
      tenantId: ctx.tenantId,
      participantId: body.participantId,
      checkOutAt,
    },
  });
  await invalidateAttendance(ctx.tenantId, meetingId);
  return { id: body.participantId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Secretary manual marking (Req 6.1). The secretary supplies an explicit `status`; `mode` and
 * `checkInAt` are optional (the consumer defaults them). The record id is minted here and reused
 * as the message id. The consumer upserts the (meeting, participant) record so a manual mark can
 * also correct an existing automated capture, then re-evaluates quorum.
 */
export async function attendanceManualMark(
  ctx: RequestContext,
  meetingId: string,
  body: AttendanceManualMarkInput,
): Promise<AttendanceCommandAccepted> {
  const attendanceId = randomUUID();
  await queue.publish(COMMANDS.attendanceManualMark, {
    messageId: attendanceId,
    type: COMMANDS.attendanceManualMark,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      attendanceId,
      meetingId,
      tenantId: ctx.tenantId,
      participantId: body.participantId,
      status: body.status,
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.checkInAt !== undefined ? { checkInAt: body.checkInAt.toISOString() } : {}),
    },
  });
  await invalidateAttendance(ctx.tenantId, meetingId);
  return { id: attendanceId, status: "accepted", correlationId: ctx.correlationId };
}
