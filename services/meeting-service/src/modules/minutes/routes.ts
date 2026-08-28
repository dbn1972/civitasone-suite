/**
 * Minutes module — HTTP routes (Fastify plugin `minutesRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling agenda /
 * committee / meeting-core route shape):
 *   - writes  → resolveContext → requireRole → zod parse → command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - public  → the verification endpoint (Req 8.4) is UNAUTHENTICATED (`config.public`), so it
 *               is exempt from the global auth hook; it scopes the lookup by a `tenantId` query
 *               param (the auth plugin surfaces this on `req.ctx.tenantId` for public routes).
 *   - errors  → HttpError (400 validation / 401 unauthenticated / 403 forbidden / 404 not-found /
 *               409 version-conflict / 422 domain-rule) mapped to the standard envelope by the
 *               app-level schema error handler.
 *
 * The route boundary is the ONLY place client input is trusted after validation: every body is
 * parsed through the minutes validators before anything is published. Routes NEVER touch
 * Postgres for writes — the minutes consumer (consumer.ts) applies them.
 *
 * Endpoints (11):
 *   POST   /v1/meetings/:meetingId/minutes                          create draft
 *   GET    /v1/meetings/:meetingId/minutes                          get the meeting's minutes
 *   PATCH  /v1/meetings/:meetingId/minutes/:minutesId               update draft content
 *   POST   /v1/meetings/:meetingId/minutes/:minutesId/submit        submit for approval
 *   POST   /v1/meetings/:meetingId/minutes/:minutesId/approve       approve (chairperson)
 *   POST   /v1/meetings/:meetingId/minutes/:minutesId/reject        reject → back to secretary
 *   POST   /v1/meetings/:meetingId/minutes/:minutesId/sign          apply DSC (chairperson)
 *   POST   /v1/meetings/:meetingId/minutes/:minutesId/circulate     circulate signed minutes
 *   GET    /v1/meetings/:meetingId/minutes/:minutesId/versions      version history
 *   GET    /v1/meetings/:meetingId/minutes/:minutesId/versions/:versionNum  single version
 *   POST   /v1/meetings/minutes/verify                              public signature verification
 *
 * _Requirements: 7.1, 7.3, 7.5, 7.8, 8.1, 8.4_
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  isDirectMeetingOwner,
  CHAIR_STANDING_ROLES,
  SECRETARIAL_STANDING_ROLES,
} from "../meeting-core/domain.js";
import {
  minutesCreateSchema,
  minutesUpdateSchema,
  minutesSubmitSchema,
  minutesApproveSchema,
  minutesRejectSchema,
  minutesSignSchema,
  minutesCirculateSchema,
  minutesVerifySchema,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// ─── RBAC (mirrors meeting-core / committee role sets) ───────────────────────
// Read access for all meeting governance roles within the tenant.
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
  "admin",
];
/** Secretariat write path: create / edit draft / submit / circulate. */
const SECRETARY_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin", "admin"];
/** Approval authority: approve / reject / sign are chairperson (+ platform admin) only (Req 7.5, 8.1). */
const CHAIR_ROLES = ["meeting_admin", "committee_chairperson", "tenant_admin", "super_admin", "admin"];
/** Platform-admin bypass, matching meeting-core's documented "Full CRUD" access matrix. */
const ADMIN_ROLES = ["meeting_admin", "tenant_admin", "super_admin", "admin"];

// ─── Path-param schemas (validated at the boundary) ──────────────────────────
const meetingParam = z.object({ meetingId: z.string().uuid() });
const minutesParam = z.object({ meetingId: z.string().uuid(), minutesId: z.string().uuid() });
const versionParam = z.object({
  meetingId: z.string().uuid(),
  minutesId: z.string().uuid(),
  versionNum: z.coerce.number().int().positive(),
});
/** Optional tenant scope for the public verification endpoint (QR-encoded). */
const verifyQuery = z.object({ tenantId: z.string().uuid().optional() });

/**
 * 404 unless the minutes exists in the caller's tenant AND belongs to `meetingId`. Returns the
 * row so callers can avoid a second read. NOT_FOUND (not FORBIDDEN) on a cross-meeting id so we
 * never leak which minutes ids exist under other meetings.
 */
async function loadMinutesOr404(tenantId: string, meetingId: string, minutesId: string) {
  const row = await repo.getMinutes(tenantId, minutesId);
  if (!row || row.meetingId !== meetingId) throw new HttpError(404, "MINUTES_NOT_FOUND", "minutes not found");
  return row;
}

/**
 * Ownership/standing check (IDOR fix, Req 7.5, 7.6, 8.1, 8.3): `requireRole` alone only proved
 * the caller holds a CHAIR_ROLES/SECRETARY_ROLES claim somewhere in the tenant -- it never
 * compared them to THIS meeting's own `chairpersonId`/`secretaryId`, so any
 * `committee_chairperson`/`committee_secretary` could approve/reject/sign/submit/circulate the
 * minutes of a meeting they have no staffing relationship to. Byte-for-byte the same shape as
 * meeting-core/routes.ts's own `assertMeetingOwnership` (admin bypass retained per the
 * documented "Full CRUD" access matrix; everyone else must actually BE this meeting's
 * chairperson/secretary, or hold matching standing on its committee roster).
 */
async function assertMeetingOwnership(
  ctx: RequestContext,
  meeting: { committeeId: string | null; chairpersonId: string | null; secretaryId: string | null },
  standingRoles: readonly string[],
): Promise<void> {
  if (hasAnyRole(ctx, ADMIN_ROLES)) return;
  if (isDirectMeetingOwner(ctx.actorId, meeting)) return;
  if (
    meeting.committeeId &&
    (await repo.hasCommitteeStanding(ctx.tenantId, meeting.committeeId, ctx.actorId, standingRoles))
  ) {
    return;
  }
  throw new HttpError(
    403,
    "FORBIDDEN",
    "you must be this meeting's own chairperson/secretary (or hold matching committee standing) to perform this action",
  );
}

/** 404 unless the parent meeting exists in the caller's tenant; returns its ownership fields. */
async function loadMeetingRefOr404(tenantId: string, meetingId: string) {
  const meeting = await repo.getMeetingRef(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
  return meeting;
}

export async function minutesRoutes(app: FastifyInstance): Promise<void> {
  // ── Create the minutes draft for a meeting (Req 7.1, 7.2) ────────────────
  app.post("/v1/meetings/:meetingId/minutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = minutesCreateSchema.parse(req.body ?? {});
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, SECRETARIAL_STANDING_ROLES);
    const accepted = await commands.minutesCreate(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Get the meeting's minutes (Req 7.1) ──────────────────────────────────
  app.get("/v1/meetings/:meetingId/minutes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const row = await repo.getMinutesByMeeting(ctx.tenantId, meetingId);
    if (!row) throw new HttpError(404, "MINUTES_NOT_FOUND", "minutes not found");
    return reply.send({ data: row });
  });

  // ── Update the draft content (Req 7.1, 7.8) ──────────────────────────────
  app.patch("/v1/meetings/:meetingId/minutes/:minutesId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    const body = minutesUpdateSchema.parse(req.body);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, SECRETARIAL_STANDING_ROLES);
    const accepted = await commands.minutesUpdate(ctx, minutesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Submit the draft into the approval workflow (Req 7.3) ─────────────────
  app.post("/v1/meetings/:meetingId/minutes/:minutesId/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    const body = minutesSubmitSchema.parse(req.body);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, SECRETARIAL_STANDING_ROLES);
    const accepted = await commands.minutesSubmit(ctx, minutesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Approve the minutes — chairperson only (Req 7.5) ──────────────────────
  app.post("/v1/meetings/:meetingId/minutes/:minutesId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHAIR_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    const body = minutesApproveSchema.parse(req.body);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, CHAIR_STANDING_ROLES);
    const accepted = await commands.minutesApprove(ctx, minutesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Reject the minutes — chairperson only (Req 7.6) ───────────────────────
  app.post("/v1/meetings/:meetingId/minutes/:minutesId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHAIR_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    const body = minutesRejectSchema.parse(req.body);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, CHAIR_STANDING_ROLES);
    const accepted = await commands.minutesReject(ctx, minutesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Apply the chairperson's DSC (Req 8.1) ─────────────────────────────────
  app.post("/v1/meetings/:meetingId/minutes/:minutesId/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHAIR_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    const body = minutesSignSchema.parse(req.body);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, CHAIR_STANDING_ROLES);
    const accepted = await commands.minutesSign(ctx, minutesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Circulate the signed minutes (Req 8.3) ────────────────────────────────
  app.post("/v1/meetings/:meetingId/minutes/:minutesId/circulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SECRETARY_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    const body = minutesCirculateSchema.parse(req.body ?? {});
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const meeting = await loadMeetingRefOr404(ctx.tenantId, meetingId);
    await assertMeetingOwnership(ctx, meeting, SECRETARIAL_STANDING_ROLES);
    const accepted = await commands.minutesCirculate(ctx, minutesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Version history (Req 7.8) ─────────────────────────────────────────────
  app.get("/v1/meetings/:meetingId/minutes/:minutesId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId, minutesId } = minutesParam.parse(req.params);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const rows = await repo.getVersionHistory(ctx.tenantId, minutesId);
    return reply.send({ data: rows });
  });

  // ── Single historical version (Req 7.8) ───────────────────────────────────
  app.get("/v1/meetings/:meetingId/minutes/:minutesId/versions/:versionNum", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId, minutesId, versionNum } = versionParam.parse(req.params);
    await loadMinutesOr404(ctx.tenantId, meetingId, minutesId);
    const row = await repo.getVersion(ctx.tenantId, minutesId, versionNum);
    if (!row) throw new HttpError(404, "MINUTES_NOT_FOUND", "minutes version not found");
    return reply.send({ data: row });
  });

  // ── Public signature verification — UNAUTHENTICATED (Req 8.4) ─────────────
  // Exempt from the global auth hook via `config.public`; scoped by the `tenantId` query param
  // (QR-encoded) which the auth plugin surfaces on req.ctx.tenantId for public routes. Never
  // leaks whether an id/hash exists beyond the `found` flag, and never returns minutes content.
  app.post(
    "/v1/meetings/minutes/verify",
    { config: { public: true } },
    async (req: FastifyRequest, reply) => {
      const body = minutesVerifySchema.parse(req.body);
      const { tenantId: queryTenant } = verifyQuery.parse(req.query);
      const tenantId = queryTenant ?? req.ctx?.tenantId ?? "";
      const result = await repo.verifySignature(tenantId, {
        ...(body.minutesId ? { minutesId: body.minutesId } : {}),
        ...(body.hashCurrent ? { hashCurrent: body.hashCurrent } : {}),
      });
      return reply.send({ data: result });
    },
  );
}
