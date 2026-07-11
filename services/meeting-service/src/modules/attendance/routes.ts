/**
 * Attendance module — HTTP routes (Fastify plugin `attendanceRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling agenda
 * route shape):
 *   - writes  → resolveContext → requireRole → X-Idempotency-Key → zod parse → command
 *               publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - errors  → HttpError (400 validation / 401 unauthenticated / 403 forbidden /
 *               404 not-found / 422 domain-rule) mapped to the standard envelope by the
 *               app-level schema error handler.
 *
 * Route boundary is the ONLY place client input is trusted after validation: every body is
 * parsed through the attendance validators before anything is published. Routes NEVER touch
 * Postgres for writes (all writes go route → queue.publish → 202; the consumer does the DB
 * write). Per steering, `X-Idempotency-Key` is REQUIRED on every POST that triggers a queued
 * write (check-in, check-out, manual mark) — a missing header is rejected 400 at the boundary.
 *
 * The QR endpoint is NOT a queued write: it synchronously mints a signed, expiring meeting QR
 * token (domain.generateMeetingQrToken) from the `MEETING_QR_SECRET` and returns it 200; it
 * touches no Postgres state and so does not require an idempotency key.
 *
 * The attendance sheet endpoint streams a rendered PDF (Req 6.6) rather than the JSON envelope.
 *
 * Endpoints (7):
 *   POST /v1/meetings/:meetingId/attendance/check-in    record a check-in            → 202
 *   POST /v1/meetings/:meetingId/attendance/check-out   record a check-out           → 202
 *   GET  /v1/meetings/:meetingId/attendance             list attendance records      → 200
 *   GET  /v1/meetings/:meetingId/attendance/live        real-time dashboard (30s TTL) → 200
 *   POST /v1/meetings/:meetingId/attendance/manual      secretary manual mark        → 202
 *   GET  /v1/meetings/:meetingId/attendance/sheet       attendance sheet (PDF)       → 200
 *   POST /v1/meetings/:meetingId/attendance/qr          mint a meeting QR token      → 200
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceManualMarkSchema,
  generateQrSchema,
  meetingIdParam,
  attendanceQueryParams,
} from "./validators.js";
import { generateMeetingQrToken, verifyMeetingQrToken } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

// ─── RBAC (design § Access Control Matrix) ──────────────────────────────────
// meeting_admin: full access · committee_secretary: secretariat (manual mark, sheet, QR) ·
// chairperson/members: check in + read the live board · observers: read only.
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
];
/** Who may record a check-in / check-out — members mark their own presence. */
const CHECKIN_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "tenant_admin",
  "super_admin",
];
/** Secretariat actions: manual marking (Req 6.1), sheet generation (Req 6.6), QR minting. */
const SECRETARY_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "tenant_admin",
  "super_admin",
];

/** Env var holding the HMAC secret used to sign/verify meeting QR tokens (Req 6.2). */
const QR_SECRET_ENV = "MEETING_QR_SECRET";

/**
 * Assert the caller supplied a non-empty `X-Idempotency-Key` (steering: REQUIRED on all POST
 * that trigger a queued write). Returns the trimmed key. Throws 400 VALIDATION_FAILED otherwise.
 */
function requireIdempotencyKey(req: FastifyRequest): string {
  const raw = req.headers["x-idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== "string" || key.trim() === "") {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this write");
  }
  return key.trim();
}

/** 404 unless the parent meeting exists in the caller's tenant; returns the snapshot otherwise. */
async function requireMeeting(tenantId: string, meetingId: string): Promise<repo.MeetingSnapshot> {
  const meeting = await repo.getMeetingSnapshot(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
  return meeting;
}

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  // ── Record a check-in (Req 6.1, 6.2) ─────────────────────────────────────
  app.post("/v1/meetings/:meetingId/attendance/check-in", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHECKIN_ROLES);
    requireIdempotencyKey(req);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = attendanceCheckInSchema.parse(req.body);
    await requireMeeting(ctx.tenantId, meetingId);
    const accepted = await commands.attendanceCheckIn(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Record a check-out (Req 6.6) ─────────────────────────────────────────
  app.post("/v1/meetings/:meetingId/attendance/check-out", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHECKIN_ROLES);
    requireIdempotencyKey(req);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = attendanceCheckOutSchema.parse(req.body);
    await requireMeeting(ctx.tenantId, meetingId);
    const accepted = await commands.attendanceCheckOut(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── List attendance records, optionally filtered (Req 6.1) ───────────────
  app.get("/v1/meetings/:meetingId/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const query = attendanceQueryParams.parse(req.query);
    await requireMeeting(ctx.tenantId, meetingId);
    const rows = await repo.getAttendance(ctx.tenantId, meetingId, {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.mode !== undefined ? { mode: query.mode } : {}),
    });
    const page = rows.slice(query.offset, query.offset + query.limit);
    return reply.send({ data: page, meta: { total: rows.length, limit: query.limit, offset: query.offset } });
  });

  // ── Real-time attendance dashboard (Req 6.3) ─────────────────────────────
  app.get("/v1/meetings/:meetingId/attendance/live", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    await requireMeeting(ctx.tenantId, meetingId);
    const dashboard = await repo.getLiveAttendance(ctx.tenantId, meetingId);
    return reply.send({ data: dashboard });
  });

  // ── Secretary manual marking (Req 6.1) ───────────────────────────────────
  app.post("/v1/meetings/:meetingId/attendance/manual", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    requireIdempotencyKey(req);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = attendanceManualMarkSchema.parse(req.body);
    await requireMeeting(ctx.tenantId, meetingId);
    const accepted = await commands.attendanceManualMark(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Attendance sheet (PDF, Req 6.6) ──────────────────────────────────────
  app.get("/v1/meetings/:meetingId/attendance/sheet", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const sheet = await repo.generateAttendanceSheet(ctx.tenantId, meetingId);
    if (!sheet) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    return reply
      .header("content-type", sheet.contentType)
      .header("content-disposition", `attachment; filename="${sheet.filename}"`)
      .send(sheet.buffer);
  });

  // ── Mint a meeting QR token (Req 6.1, 6.2) — synchronous, not a queued write ──
  app.post("/v1/meetings/:meetingId/attendance/qr", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = generateQrSchema.parse(req.body ?? {});
    await requireMeeting(ctx.tenantId, meetingId);

    const secret = process.env[QR_SECRET_ENV];
    if (!secret) {
      throw new HttpError(500, "TENANT_CONFIG_MISSING", `${QR_SECRET_ENV} is not configured`);
    }
    const now = new Date();
    const token = generateMeetingQrToken({
      meetingId,
      secret,
      now,
      nonce: randomUUID(),
      ...(body.ttlMinutes !== undefined ? { ttlMinutes: body.ttlMinutes } : {}),
    });
    // Surface the decoded expiry so the client can display / refresh the on-screen code.
    const verified = verifyMeetingQrToken(token, { secret, now, expectedMeetingId: meetingId });
    const expiresAt = verified.valid ? new Date(verified.payload.expiresAt).toISOString() : null;
    return reply.send({ data: { meetingId, token, expiresAt } });
  });
}
