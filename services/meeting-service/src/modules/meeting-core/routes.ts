/**
 * meeting-core module — HTTP routes (Fastify plugin `meetingCoreRoutes`, 16 endpoints).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering) and mirrors the
 * already-implemented sibling routes (committee/routes.ts, agenda/routes.ts):
 *   • WRITES — `resolveContext` → `requireRole` → zod validate (meeting-core/validators.ts)
 *              → command publish (meeting-core/commands.ts) → 202 `{ data: Accepted }`.
 *              Routes NEVER write to Postgres directly; the meeting-core consumer applies
 *              the change and emits the outbox event.
 *   • READS  — cache-first `repo.*` lookups (meeting-core/repo.ts). Single entity →
 *              `{ data }`; lists → `{ data, meta: { page, pageSize, total } }` (the repo
 *              builds the envelope for paginated reads). A missing entity 404s BEFORE any
 *              write is published.
 *
 * Error paths (no per-route handler — the app-level `registerSchemaErrorHandler` maps them):
 *   • zod parse failure → 400 VALIDATION_FAILED
 *   • `resolveContext`  → 401 for unauthenticated callers
 *   • `requireRole`     → 403 FORBIDDEN
 *   • unknown / other-tenant id → 404 (checked here before publish)
 *   • optimistic-lock clash on a queued write → 409 MEETING_VERSION_CONFLICT (from the consumer)
 *
 * RBAC (design.md § Access Control Matrix — Meetings column):
 *   • meeting_admin          — Full CRUD (create/edit/transition/cancel/config).
 *   • committee_secretary    — Create/Edit meetings + series (staff the pipeline).
 *   • committee_chairperson  — View/Transition (drive the state machine, incl. cancel).
 *   • committee_member/observer — read-only.
 *   Meeting-type config is admin-only tenant configuration.
 *
 * DELETE = soft cancel: publishes `meeting.cancel` (COMMANDS.meetingCancel), moving the
 * meeting into the terminal `cancelled` state via the state machine — never a hard delete.
 *
 * Endpoints (16):
 *   POST   /v1/meetings                          create meeting (draft)
 *   POST   /v1/meetings/record-held              record an already-held meeting (past date, attendees, minutes)
 *   GET    /v1/meetings                          list meetings (paginated, filterable)
 *   GET    /v1/meetings/:meetingId               meeting details
 *   PATCH  /v1/meetings/:meetingId               update meeting
 *   DELETE /v1/meetings/:meetingId               cancel (soft) meeting
 *   POST   /v1/meetings/:meetingId/transition    state-machine transition
 *   GET    /v1/meetings/:meetingId/transitions   transition audit log
 *   GET    /v1/meetings/types                     list meeting types
 *   POST   /v1/meetings/types                     create meeting type (tenant config)
 *   GET    /v1/meetings/series                    list meeting series
 *   POST   /v1/meetings/series                    create recurring series
 *   PATCH  /v1/meetings/series/:seriesId          update series
 *   POST   /v1/meetings/series/:seriesId/generate generate instances from series
 *   GET    /v1/meetings/dashboard/leadership      leadership (chairperson) dashboard
 *   GET    /v1/meetings/dashboard/secretariat     secretariat (secretary) dashboard
 *   GET    /v1/meetings/dashboard/participant     participant dashboard
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { recordHeldAuthority, RECORD_HELD_ROLES, assertHeldMeetingTimes, isDirectMeetingOwner, CHAIR_STANDING_ROLES, SECRETARIAL_STANDING_ROLES, MEETING_ADMIN_ROLES, allowedTargets, canTransition, isMeetingState, validateQuorumForStart } from "./domain.js";
import { httpError } from "../../shared/context.js";
import {
  createMeetingSchema,
  updateMeetingSchema,
  transitionMeetingSchema,
  cancelMeetingSchema,
  createMeetingTypeSchema,
  createSeriesSchema,
  updateSeriesSchema,
  generateSeriesSchema,
  listMeetingsQuerySchema,
  listMeetingTypesQuerySchema,
  listSeriesQuerySchema,
  recordHeldMeetingSchema,
  meetingIdParam,
  seriesIdParam,
} from "./validators.js";
import * as repo from "./repo.js";
import { getCommitteeById } from "../committee/repo.js";
import * as commands from "./commands.js";

// ─── RBAC role groups (design § Access Control Matrix — Meetings) ────────────

/** Platform/tenant + meeting admins — Full CRUD + tenant config authority. */
const ADMIN_ROLES: string[] = [...MEETING_ADMIN_ROLES];
/** Create/Edit meetings + series (admins + secretariat). */
const WRITE_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin", "admin"];
/** Drive the state machine — transitions incl. cancel (admins + chairperson). */
const TRANSITION_ROLES = ["meeting_admin", "committee_chairperson", "tenant_admin", "super_admin", "admin"];
/** Read access to meeting governance data (all meeting roles within the tenant). */
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

/**
 * Dashboards are "my dashboard" for the calling user by default. An admin may inspect
 * another user's dashboard via `?userId=<uuid>`; non-admins requesting a different user
 * are rejected with 403 so a member cannot enumerate others' schedules.
 */
const dashboardQuery = z.object({ userId: z.string().uuid().optional() });

/** Optional optimistic-lock version accepted on flat write bodies (mirrors committee/routes.ts). */
const versionBody = z.object({
  version: z.coerce.number().int().nonnegative().optional(),
});

function resolveDashboardTarget(ctx: RequestContext, query: unknown): string {
  const { userId } = dashboardQuery.parse(query);
  if (userId && userId !== ctx.actorId) {
    requireRole(ctx, ADMIN_ROLES);
    return userId;
  }
  return ctx.actorId;
}

/**
 * Ownership/standing check (IDOR fix, Req 1.1, 1.3–1.6): `requireRole` alone only proved the
 * caller holds *a* relevant role somewhere in the tenant — it never compared them to THIS
 * meeting's own `chairpersonId`/`secretaryId`, so any `committee_secretary` could edit, and any
 * `committee_chairperson` could transition/cancel, a meeting they have no staffing relationship
 * to. Admins (`ADMIN_ROLES`) retain the documented "Full CRUD" bypass (design.md § Access
 * Control Matrix); everyone else must actually BE this meeting's chairperson/secretary, or hold
 * matching standing (`standingRoles`) on its committee roster (covers a deputy secretary /
 * co-chair not yet the single name stamped on the meeting row).
 */
async function assertMeetingOwnership(
  ctx: RequestContext,
  meeting: { committeeId: string | null; chairpersonId: string | null; secretaryId: string | null },
  standingRoles: readonly string[],
): Promise<void> {
  if (hasAnyRole(ctx, ADMIN_ROLES)) return;
  if (isDirectMeetingOwner(ctx.actorId, meeting)) return;
  if (meeting.committeeId && (await repo.hasCommitteeStanding(ctx.tenantId, meeting.committeeId, ctx.actorId, standingRoles))) {
    return;
  }
  throw new HttpError(
    403,
    "FORBIDDEN",
    "you must be this meeting's own chairperson/secretary (or hold matching committee standing) to perform this action",
  );
}

/**
 * Enforce the mandatory X-Idempotency-Key on write commands (GAP-MEETING-MEETINGS-NEW-04).
 * Steering: idempotency REQUIRED on all POST/PATCH that trigger a queued write.
 */
function requireIdempotencyKey(ctx: import("@civitasone/types").RequestContext): void {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this operation");
  }
}

export async function meetingCoreRoutes(app: FastifyInstance): Promise<void> {
  // ─── Meeting CRUD ──────────────────────────────────────────────────────────

  /** POST /v1/meetings — create a meeting in `draft` state (Req 1.2). */
  app.post("/v1/meetings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx); // GAP-MEETING-MEETINGS-NEW-04
    const body = createMeetingSchema.parse(req.body);
    const accepted = await commands.publishMeetingCreate(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/meetings/record-held — enter a meeting that has ALREADY been held: past date, actual start/end,
   * attendees and minutes, in one command (replaces "schedule in the future, then patch scheduledAt").
   * Meeting admins and secretaries only; a secretary must be the meeting's own secretary or hold `secretary`
   * standing on its committee. A future date is refused. The meeting is numbered from the FY of the held
   * date by the same gap-free counter as every other meeting, and lands in `minutes_pending`.
   */
  app.post("/v1/meetings/record-held", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...RECORD_HELD_ROLES]);
    requireIdempotencyKey(ctx);
    const body = recordHeldMeetingSchema.parse(req.body);
    assertHeldMeetingTimes({
      scheduledAt: new Date(body.scheduledAt ?? body.actualStartAt),
      actualStartAt: new Date(body.actualStartAt),
      actualEndAt: new Date(body.actualEndAt),
      now: new Date(),
    });
    if (body.committeeId && !(await getCommitteeById(ctx.tenantId, body.committeeId))) {
      throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    }
    const authority = recordHeldAuthority(ctx.roles, ctx.actorId, body.secretaryId);
    const allowed = authority === "admin" || authority === "named_secretary"
      || (authority === "needs_standing" && !!body.committeeId
        && (await repo.hasCommitteeStanding(ctx.tenantId, body.committeeId, ctx.actorId, SECRETARIAL_STANDING_ROLES)));
    if (!allowed) {
      throw new HttpError(403, "FORBIDDEN", "only a meeting admin, or the secretary of this meeting or its committee, may record a held meeting");
    }
    const accepted = await commands.publishMeetingRecordHeld(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  /** GET /v1/meetings — list meetings, paginated + filterable (Req 1.1). */
  app.get("/v1/meetings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listMeetingsQuerySchema.parse(req.query);
    const result = await repo.listMeetings(ctx.tenantId, query);
    return reply.send(result);
  });

  // ── Meeting types (tenant config) ────────────────────────────────────────
  // NOTE: static `/types` + `/series` + `/dashboard/*` collections are declared
  // alongside the `:meetingId` routes below; Fastify's radix router always
  // prefers a static segment over a parametric one, so there is no ambiguity.

  /** GET /v1/meetings/types — list meeting-type templates. */
  app.get("/v1/meetings/types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listMeetingTypesQuerySchema.parse(req.query);
    const result = await repo.getMeetingTypes(ctx.tenantId, query);
    return reply.send(result);
  });

  /** POST /v1/meetings/types — create a meeting-type template (tenant config, admin-only). */
  app.post("/v1/meetings/types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createMeetingTypeSchema.parse(req.body);
    const accepted = await commands.publishMeetingTypeCreate(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Meeting series (recurring pattern, Req 14.5) ─────────────────────────

  /** GET /v1/meetings/series — list recurring series (filter by committee/active). */
  app.get("/v1/meetings/series", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listSeriesQuerySchema.parse(req.query);
    const result = await repo.getMeetingSeries(ctx.tenantId, query);
    return reply.send(result);
  });

  /** POST /v1/meetings/series — constitute a recurring series. */
  app.post("/v1/meetings/series", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createSeriesSchema.parse(req.body);
    const accepted = await commands.publishSeriesCreate(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  /** PATCH /v1/meetings/series/:seriesId — amend a recurring series (optimistic-locked). */
  app.patch("/v1/meetings/series/:seriesId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { seriesId } = seriesIdParam.parse(req.params);
    const series = await repo.getMeetingSeriesById(ctx.tenantId, seriesId);
    if (!series) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting series not found");
    const patch = updateSeriesSchema.parse(req.body);
    const { version } = versionBody.parse(req.body ?? {});
    const accepted = await commands.publishSeriesUpdate(ctx, seriesId, version ?? series.version, patch);
    return reply.code(202).send({ data: accepted });
  });

  /** POST /v1/meetings/series/:seriesId/generate — materialize instances up to a date (Req 14.5). */
  app.post("/v1/meetings/series/:seriesId/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { seriesId } = seriesIdParam.parse(req.params);
    const series = await repo.getMeetingSeriesById(ctx.tenantId, seriesId);
    if (!series) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting series not found");
    const body = generateSeriesSchema.parse(req.body);
    const accepted = await commands.publishSeriesGenerate(ctx, seriesId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Dashboards (role-scoped read projections, Req 1.1, 1.7) ──────────────

  /** GET /v1/meetings/dashboard/leadership — chairperson leadership dashboard. */
  app.get("/v1/meetings/dashboard/leadership", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const target = resolveDashboardTarget(ctx, req.query);
    const data = await repo.getLeadershipDashboard(ctx.tenantId, target);
    return reply.send({ data });
  });

  /** GET /v1/meetings/dashboard/secretariat — secretary secretariat dashboard. */
  app.get("/v1/meetings/dashboard/secretariat", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const target = resolveDashboardTarget(ctx, req.query);
    const data = await repo.getSecretariatDashboard(ctx.tenantId, target);
    return reply.send({ data });
  });

  /** GET /v1/meetings/dashboard/participant — participant dashboard. */
  app.get("/v1/meetings/dashboard/participant", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const target = resolveDashboardTarget(ctx, req.query);
    const data = await repo.getParticipantDashboard(ctx.tenantId, target);
    return reply.send({ data });
  });

  // ── Single-meeting reads / writes (parametric — declared last for clarity) ─

  /** GET /v1/meetings/:meetingId — meeting details (Req 1.1). */
  app.get("/v1/meetings/:meetingId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const meeting = await repo.getMeetingById(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    return reply.send({ data: meeting });
  });

  /** PATCH /v1/meetings/:meetingId — update a meeting (optimistic-locked; status excluded). */
  app.patch("/v1/meetings/:meetingId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const meeting = await repo.getMeetingById(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    await assertMeetingOwnership(ctx, meeting, SECRETARIAL_STANDING_ROLES);
    const { version, patch } = updateMeetingSchema.parse(req.body);
    const accepted = await commands.publishMeetingUpdate(ctx, meetingId, version, patch);
    return reply.code(202).send({ data: accepted });
  });

  /** DELETE /v1/meetings/:meetingId — soft cancel via `meeting.cancel` (Req 1.6; never hard-delete). */
  app.delete("/v1/meetings/:meetingId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRANSITION_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const meeting = await repo.getMeetingById(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    await assertMeetingOwnership(ctx, meeting, CHAIR_STANDING_ROLES);
    const body = cancelMeetingSchema.parse(req.body);
    const accepted = await commands.publishMeetingCancel(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  /** POST /v1/meetings/:meetingId/transition — drive a state-machine transition (Req 1.3–1.6). */
  app.post("/v1/meetings/:meetingId/transition", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TRANSITION_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const meeting = await repo.getMeetingById(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    await assertMeetingOwnership(ctx, meeting, CHAIR_STANDING_ROLES);
    const body = transitionMeetingSchema.parse(req.body);
    // UAT J14 / D9: refuse an edge the state machine does not have HERE (422 with
    // the allowed targets), instead of answering 202 for a command the consumer
    // can only dead-letter. The consumer re-checks everything.
    if (isMeetingState(meeting.status) && !canTransition(meeting.status, body.to)) {
      throw httpError("MEETING_INVALID_TRANSITION", `cannot transition meeting from "${meeting.status}" to "${body.to}" (allowed: ${allowedTargets(meeting.status).join(", ")})`, {
        from: meeting.status, to: body.to, allowed: allowedTargets(meeting.status),
      });
    }
    // Quorum is a pure function of the meeting row, so pre-check it with the SAME domain guard the
    // consumer runs (no duplicated logic): starting without quorum answers 422 here instead of a
    // silent 202 + dead-letter. adjourned → in_progress is skipped: the consumer re-evaluates
    // quorum LIVE from attendance (policy quorum.recheck_on_resume), which the stored flag cannot
    // predict. The consumer still re-checks everything (state can change before it runs).
    // Agenda/notice guards (draft → scheduled) need a count + tenant-policy read that no repo
    // function exposes to the route, so they stay consumer-only.
    if (body.to === "in_progress" && meeting.status !== "adjourned") {
      validateQuorumForStart({ now: new Date(), quorumEstablished: meeting.quorumEstablished });
    }
    const accepted = await commands.publishMeetingTransition(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  /** GET /v1/meetings/:meetingId/transitions — state-transition audit log (Req 1.7). */
  app.get("/v1/meetings/:meetingId/transitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const meeting = await repo.getMeetingById(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    const log = await repo.getTransitionLog(ctx.tenantId, meetingId);
    return reply.send({ data: log });
  });
}
