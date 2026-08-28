/**
 * decision module — HTTP routes (Fastify plugin `decisionRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling agenda /
 * committee route shape):
 *   - writes  → resolveContext → requireRole → zod parse → command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - errors  → HttpError (400 validation / 401 unauthenticated / 403 forbidden /
 *               404 not-found / 409 version-conflict / 422 domain-rule) mapped to the
 *               standard envelope by the app-level schema error handler.
 *
 * The route boundary is the ONLY place client input is trusted after validation: every body /
 * query / path param is parsed through the decision validators (or a local zod schema for the
 * register/search/circulation-vote inputs) before anything is published or queried. Routes
 * NEVER touch Postgres for writes (CQRS).
 *
 * Money (steering: bigint paise): a decision's `financialImplication` crosses the wire as a
 * canonical base-10 STRING both inbound (validator `zMoneyMinorString`) and outbound (the repo
 * DTO stringifies the `bigint`), never a JS `number`.
 *
 * Endpoints (12):
 *   POST   /v1/meetings/:meetingId/decisions                                   record decision
 *   GET    /v1/meetings/:meetingId/decisions                                   list meeting decisions
 *   PATCH  /v1/meetings/:meetingId/decisions/:decisionId                       update decision
 *   POST   /v1/meetings/:meetingId/resolutions                                 record resolution
 *   GET    /v1/meetings/:meetingId/resolutions                                 list meeting resolutions
 *   POST   /v1/meetings/:meetingId/resolutions/:resolutionId/sign             sign resolution (DSC)
 *   POST   /v1/meetings/:meetingId/resolutions/:resolutionId/dissent          record dissent note
 *   GET    /v1/meetings/committees/:committeeId/resolution-register           resolution register
 *   GET    /v1/meetings/decisions/search                                       search decision register
 *   POST   /v1/meetings/resolutions/circulation                               initiate circulation resolution
 *   POST   /v1/meetings/resolutions/circulation/:resolutionId/vote            vote on circulation resolution
 *   GET    /v1/meetings/resolutions/circulation/:resolutionId/status          circulation status
 *
 * _Requirements: 11.1, 11.4, 11.5, 11.6, 11.8, 12.1, 12.3, 12.7_
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  decisionRecordSchema,
  decisionUpdateSchema,
  resolutionRecordSchema,
  resolutionSignSchema,
  dissentRecordSchema,
  resolutionCirculationInitSchema,
  circulationVoteSchema,
} from "./validators.js";
import { MEMBER_ROLES } from "../committee/domain.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// ─── RBAC (design § Access Control Matrix) ──────────────────────────────────
// meeting_admin: full · committee_secretary: record decisions/resolutions · chairperson:
// approve/sign + initiate votes · committee_member: cast votes / record dissent · observer:
// read effective only. tenant_admin/super_admin are platform-wide.
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
];
/** Record / update a decision, record a resolution (Req 11.1, 11.3, 11.4, 11.8). */
const RECORD_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin"];
/** Apply the chairperson's DSC to a passed resolution (Req 11.5). */
const SIGN_ROLES = ["meeting_admin", "committee_chairperson", "tenant_admin", "super_admin"];
/** Record a dissent note — a dissenting member, the secretary, or the chair (Req 11.6). */
const DISSENT_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "tenant_admin",
  "super_admin",
];
/** Initiate a circulation resolution (Req 12.1) — secretary/chair authority. */
const CIRCULATION_INIT_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "tenant_admin",
  "super_admin",
];
/** Cast a circulation vote (Req 12.3) — a voting committee member or the chair. */
const CIRCULATION_VOTE_ROLES = [
  "meeting_admin",
  "committee_chairperson",
  "committee_member",
  "tenant_admin",
  "super_admin",
];

// ─── Per-committee standing gate (Gap: fix 6 added `requireCommitteeStanding` to committee/ and
//     voting/routes.ts but never to decision/routes.ts — the route family that owns the real
//     resolution-recording + DSC-signing endpoints. A flat `committee_secretary` with ZERO
//     committee_members rows could record a fabricated resolution for a committee they never
//     served, and a flat `committee_chairperson` could then sign it — the exact governance-chain
//     exploit this PR closes elsewhere, via the one route family fix 6 missed.) Mirrors the
//     identical helper + bypass/officer sets in voting/routes.ts so decision routes gate the same.
// Roles that legitimately act tenant/platform-wide, exempt from the per-committee check.
const COMMITTEE_SCOPE_BYPASS_ROLES = ["meeting_admin", "tenant_admin", "super_admin"];
/** committee_members.role values that constitute officer standing to record/sign/update/circulate. */
const DECISION_OFFICER_ROLES = ["chairperson", "secretary"];

const SCHEMA_VERSION = "1.0";

// ─── Path-param + query schemas (validated at the boundary) ──────────────────
const meetingParam = z.object({ meetingId: z.string().uuid() });
const decisionParam = z.object({ meetingId: z.string().uuid(), decisionId: z.string().uuid() });
const resolutionParam = z.object({ meetingId: z.string().uuid(), resolutionId: z.string().uuid() });
const committeeParam = z.object({ committeeId: z.string().uuid() });
const circulationParam = z.object({ resolutionId: z.string().uuid() });

/** Optional boolean from a query string ("true"/"false"). */
const qsBool = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

/** GET resolution-register query filters (Req 11.4, 12.7). */
const registerQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["effective", "superseded", "withdrawn"]).optional(),
  result: z.enum(["passed", "rejected", "invalid"]).optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/, "expected financial year in YYYY-YY format").optional(),
  isCirculation: qsBool,
});

/** GET decisions/search query filters (Req 11.8). `limit` capped at 200 per the API standard. */
const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  type: z.string().trim().max(32).optional(),
  status: z.enum(["effective", "superseded", "withdrawn"]).optional(),
  meetingId: z.string().uuid().optional(),
  committeeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/** Standard queued-write acknowledgement (→ HTTP 202 body `{ data }`). */
interface Accepted {
  id: string;
  status: "accepted";
  correlationId: string;
}

/** 404 unless the parent meeting exists in the caller's tenant. */
async function assertMeetingExists(tenantId: string, meetingId: string): Promise<void> {
  const meeting = await repo.getMeetingStatus(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
}

/**
 * Assert the caller has real standing on `committeeId` — either a tenant-wide bypass role, or an
 * ACTIVE `committee_members` row on THIS SPECIFIC committee holding one of `officerRoles` (Gap:
 * systemic cross-committee IDOR — a flat `committee_secretary`/`committee_chairperson` role claim
 * used to be sufficient to record/sign a resolution or update a decision for ANY committee in the
 * tenant, not just one the caller actually serves). Byte-for-byte the same logic fix 6 applied in
 * voting/routes.ts + committee/routes.ts. No-op for a meeting/route with no committee to scope to.
 */
async function requireCommitteeStanding(
  ctx: RequestContext,
  committeeId: string,
  officerRoles: readonly string[],
): Promise<void> {
  if (ctx.roles.some((r) => COMMITTEE_SCOPE_BYPASS_ROLES.includes(r))) return;
  const membership = await repo.getActiveMembership(ctx.tenantId, committeeId, ctx.actorId);
  if (!membership || !officerRoles.includes(membership.role)) {
    throw new HttpError(403, "FORBIDDEN", "caller does not have standing on this committee");
  }
}

export async function decisionRoutes(app: FastifyInstance): Promise<void> {
  // ── Record a decision (Req 11.1, 22.x) ───────────────────────────────────
  app.post("/v1/meetings/:meetingId/decisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RECORD_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = decisionRecordSchema.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.decisionRecord(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── List a meeting's decisions (Req 11.1) ────────────────────────────────
  app.get("/v1/meetings/:meetingId/decisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const rows = await repo.getDecisions(ctx.tenantId, meetingId);
    return reply.send({ data: rows });
  });

  // ── Update a decision (Req 11.8) — optimistic-locked on version ───────────
  app.patch("/v1/meetings/:meetingId/decisions/:decisionId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RECORD_ROLES);
    const { meetingId, decisionId } = decisionParam.parse(req.params);
    const body = decisionUpdateSchema.parse({ ...(req.body as object), decisionId });
    const decision = await repo.getDecision(ctx.tenantId, decisionId);
    if (!decision || decision.meetingId !== meetingId) {
      throw new HttpError(404, "NOT_FOUND", "decision not found");
    }
    // Gap 1: updating a decision (incl. status/supersession changes) requires officer standing on
    // the owning meeting's committee — resolved via the meeting, mirroring voting's pattern.
    const meetingRef = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (meetingRef?.committeeId) {
      await requireCommitteeStanding(ctx, meetingRef.committeeId, DECISION_OFFICER_ROLES);
    }
    const accepted = await commands.decisionUpdate(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Record a resolution (Req 11.3, 11.4) ──────────────────────────────────
  app.post("/v1/meetings/:meetingId/resolutions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RECORD_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = resolutionRecordSchema.parse(req.body);
    // Resolve the meeting's committee, then require the caller actually serve on it as an officer
    // (Gap 1). Keyed by meetingId, so mirror voting/routes.ts's initiate/conclude pattern exactly.
    const meetingRef = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (!meetingRef) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    if (meetingRef.committeeId) {
      await requireCommitteeStanding(ctx, meetingRef.committeeId, DECISION_OFFICER_ROLES);
    }
    const accepted = await commands.resolutionRecord(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── List a meeting's resolutions (Req 11.4) ────────────────────────────────
  app.get("/v1/meetings/:meetingId/resolutions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const rows = await repo.getResolutions(ctx.tenantId, meetingId);
    return reply.send({ data: rows });
  });

  // ── Sign a passed resolution with the chairperson's DSC (Req 11.5) ────────
  app.post("/v1/meetings/:meetingId/resolutions/:resolutionId/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SIGN_ROLES);
    const { meetingId, resolutionId } = resolutionParam.parse(req.params);
    const body = resolutionSignSchema.parse(req.body);
    const resolution = await repo.getResolution(ctx.tenantId, resolutionId);
    if (!resolution || resolution.meetingId !== meetingId) {
      throw new HttpError(404, "NOT_FOUND", "resolution not found");
    }
    // Gap 1: the DSC-signing endpoint must also require the caller serve on the meeting's
    // committee as an officer — resolving the committee via the meeting, exactly as voting's
    // conclude does (assertResolutionInMeeting → getMeetingRef → requireCommitteeStanding).
    const meetingRef = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (meetingRef?.committeeId) {
      await requireCommitteeStanding(ctx, meetingRef.committeeId, DECISION_OFFICER_ROLES);
    }
    const accepted = await commands.resolutionSign(ctx, meetingId, resolutionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Record a dissent note against a resolution (Req 11.6) ─────────────────
  app.post("/v1/meetings/:meetingId/resolutions/:resolutionId/dissent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DISSENT_ROLES);
    const { meetingId, resolutionId } = resolutionParam.parse(req.params);
    const body = dissentRecordSchema.parse(req.body);
    const resolution = await repo.getResolution(ctx.tenantId, resolutionId);
    if (!resolution || resolution.meetingId !== meetingId) {
      throw new HttpError(404, "NOT_FOUND", "resolution not found");
    }
    // Standing check (same shape as `sign`'s Gap 1 fix, immediately above, but scoped to ANY
    // active membership -- not just officer roles -- since recording one's OWN dissent is a
    // self-service action open to every committee member, not just its secretary/chair).
    // Without this, ANY caller holding a DISSENT_ROLES role anywhere in the tenant -- not just
    // a member of THIS resolution's own committee -- could record a dissent and (via
    // handleDissentRecord) silently overwrite another member's existing vote reason.
    const meetingRef = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (meetingRef?.committeeId) {
      if (ctx.roles.some((r) => COMMITTEE_SCOPE_BYPASS_ROLES.includes(r))) {
        // admin bypass -- may name anyone, same as an officer below.
      } else {
        const membership = await repo.getActiveMembership(ctx.tenantId, meetingRef.committeeId, ctx.actorId);
        if (!membership || !MEMBER_ROLES.includes(membership.role as (typeof MEMBER_ROLES)[number])) {
          throw new HttpError(403, "FORBIDDEN", "caller does not have standing on this committee");
        }
        // A plain member may only record their OWN dissent -- naming someone else is still
        // real audit-trail spoofing even from a genuine committee peer (handleDissentRecord
        // will overwrite THAT member's vote reason). Officers may record on behalf of a
        // member who raised it on the floor but didn't type it in themselves (mirrors the
        // "chair/secretary may record a recusal for another member" convention documented on
        // voting/validators.ts's recuse field).
        const isOfficer = (DECISION_OFFICER_ROLES as readonly string[]).includes(membership.role);
        if (!isOfficer && body.memberId !== ctx.actorId) {
          throw new HttpError(
            403,
            "FORBIDDEN",
            "only a committee officer (chairperson/secretary) may record a dissent on behalf of another member",
          );
        }
      }
    }
    const accepted = await commands.dissentRecord(ctx, meetingId, resolutionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Resolution register for a committee, searchable (Req 11.4, 12.7) ──────
  app.get("/v1/meetings/committees/:committeeId/resolution-register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { committeeId } = committeeParam.parse(req.params);
    const query = registerQuerySchema.parse(req.query ?? {});
    if (!(await repo.committeeExists(ctx.tenantId, committeeId))) {
      throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    }
    const rows = await repo.getResolutionRegister(ctx.tenantId, committeeId, query);
    return reply.send({ data: rows });
  });

  // ── Search the decision register (Req 11.8) ───────────────────────────────
  app.get("/v1/meetings/decisions/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = searchQuerySchema.parse(req.query ?? {});
    const rows = await repo.searchDecisions(ctx.tenantId, query);
    return reply.send({ data: rows, meta: { limit: query.limit, total: rows.length } });
  });

  // ── Initiate a circulation resolution (Req 12.1, 12.2) ────────────────────
  app.post("/v1/meetings/resolutions/circulation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CIRCULATION_INIT_ROLES);
    const body = resolutionCirculationInitSchema.parse(req.body);
    if (!(await repo.committeeExists(ctx.tenantId, body.committeeId))) {
      throw new HttpError(404, "COMMITTEE_NOT_FOUND", "committee not found");
    }
    // Gap 1: this route already carries `committeeId` directly — require officer standing on it
    // before a circulation resolution can be initiated (it was previously only an existence check).
    await requireCommitteeStanding(ctx, body.committeeId, DECISION_OFFICER_ROLES);
    const accepted = await commands.resolutionCirculationInit(ctx, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Vote on a circulation resolution (Req 12.3) ───────────────────────────
  app.post("/v1/meetings/resolutions/circulation/:resolutionId/vote", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CIRCULATION_VOTE_ROLES);
    const { resolutionId } = circulationParam.parse(req.params);
    const body = circulationVoteSchema.parse(req.body);
    const resolution = await repo.getResolution(ctx.tenantId, resolutionId);
    if (!resolution || !resolution.isCirculation) {
      throw new HttpError(404, "NOT_FOUND", "circulation resolution not found");
    }
    const accepted = await publishCirculationVote(ctx, resolutionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Circulation resolution status (Req 12.3, 12.4, 12.5) ──────────────────
  app.get("/v1/meetings/resolutions/circulation/:resolutionId/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { resolutionId } = circulationParam.parse(req.params);
    const status = await repo.getCirculationStatus(ctx.tenantId, resolutionId);
    if (!status) throw new HttpError(404, "NOT_FOUND", "circulation resolution not found");
    return reply.send({ data: status });
  });

  // Plugin-scoped error handler (mirrors the sibling services): zod validation → 400,
  // domain HttpError → its mapped status, everything else → a generic 500 (no raw leak). The
  // encapsulated handler guarantees the standard envelope for this module's routes regardless
  // of the app-level handler resolution order.
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

/**
 * Publish a circulation-vote response (Req 12.3). The `voteCirculationRespond` command is owned
 * by the voting module (topics.ts); the decision-module route publishes it directly (no local
 * command helper) so the write path is stable, then best-effort invalidates the circulation
 * status read cache for read-your-writes.
 *
 * The responding member is the authenticated actor (`ctx.actorId`), matching the correct,
 * already-established pattern in `voting/commands.ts`'s `voteCast`/`voteCirculationRespond` —
 * NOT trusted from the request body (Gap: circulation-vote memberId impersonation, since a
 * caller could otherwise name any other member's id and have the response recorded as theirs).
 */
async function publishCirculationVote(
  ctx: { tenantId: string; actorId: string; correlationId: string },
  resolutionId: string,
  body: { memberId: string; position: string; comment?: string | undefined },
): Promise<Accepted> {
  await queue.publish(COMMANDS.voteCirculationRespond, {
    messageId: randomUUID(),
    type: COMMANDS.voteCirculationRespond,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: {
      resolutionId,
      tenantId: ctx.tenantId,
      memberId: ctx.actorId,
      position: body.position,
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "resolution", `circulation:${resolutionId}`));
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}
