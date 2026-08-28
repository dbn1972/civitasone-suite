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
import { isDirectMeetingOwner, CHAIR_STANDING_ROLES, SECRETARIAL_STANDING_ROLES } from "./domain.js";
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
  meetingIdParam,
  seriesIdParam,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// ─── RBAC role groups (design § Access Control Matrix — Meetings) ────────────

/** Platform/tenant + meeting admins — Full CRUD + tenant config authority. */
const ADMIN_ROLES = ["meeting_admin", "tenant_admin", "super_admin", "admin"];
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

export async function meetingCoreRoutes(app: FastifyInstance): Promise<void> {
  // ─── Meeting CRUD ──────────────────────────────────────────────────────────

  /** POST /v1/meetings — create a meeting in `draft` state (Req 1.2). */
  app.post("/v1/meetings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createMeetingSchema.parse(req.body);
    const accepted = await commands.publishMeetingCreate(ctx, body);
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
