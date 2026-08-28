/**
 * Voting module — HTTP routes (Fastify plugin `votingRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling agenda /
 * committee route shape):
 *   - writes  → resolveContext → requireRole → require X-Idempotency-Key → zod parse →
 *               command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - errors  → HttpError (400 validation / 401 unauthenticated / 403 forbidden /
 *               404 not-found / 409 duplicate-vote / 422 quorum-not-met) mapped to the
 *               standard envelope by the app-level schema error handler.
 *
 * The route boundary is the ONLY place client input is trusted after validation: every body is
 * parsed through the voting validators before anything is published, and routes NEVER touch
 * Postgres for writes (all writes go through the queue via commands.ts).
 *
 * Idempotency (steering: API Design Standards): `X-Idempotency-Key` is REQUIRED on every write
 * (POST that triggers a queued write). The header is surfaced on `ctx.idempotencyKey` by the
 * auth context resolver; a missing key is rejected with 400 before any command is published.
 *
 * Duplicate-vote prevention (Req 11.3, P17) is enforced by the consumer + the DB
 * `UNIQUE(resolution_id, member_id)` constraint and surfaced to the client as
 * `409 MEETING_DUPLICATE_VOTE`; the cast route accepts fast (202) and that conflict is observed
 * on the results/positions read (CQRS: accept → enforce at write time).
 *
 * Endpoints (5):
 *   POST /v1/meetings/:meetingId/votes/initiate                initiate a vote (chairperson)
 *   POST /v1/meetings/:meetingId/votes/cast                    cast a ballot (voting member)
 *   GET  /v1/meetings/:meetingId/votes/:resolutionId/results   live tally + result + positions
 *   POST /v1/meetings/:meetingId/votes/:resolutionId/conclude  tally + compute result (chair)
 *   GET  /v1/meetings/:meetingId/votes/active                  open votes for the meeting
 *
 * _Requirements: 11.1, 11.3, 11.4_
 */
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { voteInitiateSchema, voteCastSchema, voteConcludeSchema, voteRecuseSchema, meetingIdParam, resolutionPathParams } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// Roles that legitimately act tenant/platform-wide, exempt from the per-committee ownership
// check below (Gap: systemic cross-committee IDOR) — a caller holding one of these is NOT
// required to also carry a committee_members row on the specific committee being acted on.
const COMMITTEE_SCOPE_BYPASS_ROLES = ["meeting_admin", "tenant_admin", "super_admin"];
/** committee_members.role values authorized to initiate/conclude a vote for their own committee. */
const VOTE_OFFICER_ROLES = ["chairperson", "secretary"];

// ─── RBAC (design § Access Control Matrix) ───────────────────────────────────
// The chairperson controls proceedings — initiates and concludes votes (Req 11.2, 11.4).
// Voting members (chairperson + members) cast ballots (Req 11.3). Everyone associated with
// the meeting may read the live tally/register.
const INITIATE_ROLES = ["meeting_admin", "committee_chairperson", "committee_secretary", "tenant_admin", "super_admin"];
const CAST_ROLES = ["meeting_admin", "committee_chairperson", "committee_member", "tenant_admin", "super_admin"];
const CONCLUDE_ROLES = ["meeting_admin", "committee_chairperson", "committee_secretary", "tenant_admin", "super_admin"];
// Recusal: a member may recuse themselves; a chair/secretary/admin may record one for a member.
const RECUSE_ROLES = ["meeting_admin", "committee_chairperson", "committee_secretary", "committee_member", "tenant_admin", "super_admin"];
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
];

/**
 * Enforce the mandatory `X-Idempotency-Key` on writes (steering: idempotency REQUIRED on all
 * POST that trigger a queued write). Rejected as 400 before any command is published.
 */
function requireIdempotencyKey(ctx: RequestContext): void {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this operation");
  }
}

/** 404 unless the parent meeting exists in the caller's tenant. */
async function assertMeetingExists(tenantId: string, meetingId: string): Promise<void> {
  const meeting = await repo.getMeetingRef(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
}

/**
 * 404 unless the resolution exists in the caller's tenant AND belongs to the path meeting.
 * Returns the resolution reference for further checks.
 */
async function assertResolutionInMeeting(
  tenantId: string,
  meetingId: string,
  resolutionId: string,
): Promise<repo.ResolutionRef> {
  const resolution = await repo.getResolutionRef(tenantId, resolutionId);
  if (!resolution || resolution.meetingId !== meetingId) {
    throw new HttpError(404, "MEETING_NOT_FOUND", "resolution not found");
  }
  return resolution;
}

/**
 * Assert the caller has real standing on `committeeId` — either a tenant-wide bypass role, or an
 * ACTIVE `committee_members` row on THIS SPECIFIC committee holding one of `officerRoles` (Gap:
 * systemic cross-committee IDOR — a flat `committee_chairperson`/`committee_secretary` role claim
 * used to be sufficient to initiate/conclude a vote for ANY committee in the tenant, not just one
 * the caller actually serves). No-op for a meeting with no committee at all (nothing to scope to).
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

export async function votingRoutes(app: FastifyInstance): Promise<void> {
  // ── Initiate a vote — chairperson opens a resolution for voting (Req 11.2) ──
  app.post("/v1/meetings/:meetingId/votes/initiate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INITIATE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = voteInitiateSchema.parse(req.body);
    const meetingRef = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (!meetingRef) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    if (meetingRef.committeeId) {
      await requireCommitteeStanding(ctx, meetingRef.committeeId, VOTE_OFFICER_ROLES);
    }
    const accepted = await commands.voteInitiate(ctx, meetingId, body);
    // Location of the resource the client can poll once the consumer opens the resolution.
    reply.header("location", `/v1/meetings/${meetingId}/votes/${accepted.id}/results`);
    return reply.code(202).send({ data: accepted });
  });

  // ── Cast a ballot — one voting member's position (Req 11.3) ─────────────────
  app.post("/v1/meetings/:meetingId/votes/cast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CAST_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    // The target resolution id travels in the body (validated at the boundary).
    const body = voteCastSchema.parse(req.body);
    await assertResolutionInMeeting(ctx.tenantId, meetingId, body.resolutionId);
    const accepted = await commands.voteCast(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Vote results — live tally + result + (non-secret) positions (Req 11.3, 11.4) ──
  app.get("/v1/meetings/:meetingId/votes/:resolutionId/results", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId, resolutionId } = resolutionPathParams.parse(req.params);
    const results = await repo.getVoteResults(ctx.tenantId, resolutionId);
    if (!results || results.meetingId !== meetingId) {
      throw new HttpError(404, "MEETING_NOT_FOUND", "resolution not found");
    }
    // Attach per-member positions (withheld/aggregated for a secret ballot, Req 11.1).
    const positions = await repo.getVoterPositions(ctx.tenantId, resolutionId);
    return reply.send({
      data: {
        ...results,
        secret: positions?.secret ?? false,
        positions: positions?.positions ?? [],
      },
    });
  });

  // ── Conclude a vote — tally + compute result per majority rule (Req 11.4) ───
  app.post("/v1/meetings/:meetingId/votes/:resolutionId/conclude", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONCLUDE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, resolutionId } = resolutionPathParams.parse(req.params);
    const body = voteConcludeSchema.parse(req.body ?? {});
    await assertResolutionInMeeting(ctx.tenantId, meetingId, resolutionId);
    const meetingRef = await repo.getMeetingRef(ctx.tenantId, meetingId);
    if (meetingRef?.committeeId) {
      await requireCommitteeStanding(ctx, meetingRef.committeeId, VOTE_OFFICER_ROLES);
    }
    const accepted = await commands.voteConclude(ctx, meetingId, resolutionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Recuse — record a conflict-of-interest recusal on a motion (statutory) ──
  app.post("/v1/meetings/:meetingId/votes/:resolutionId/recuse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RECUSE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, resolutionId } = resolutionPathParams.parse(req.params);
    const body = voteRecuseSchema.parse(req.body ?? {});
    await assertResolutionInMeeting(ctx.tenantId, meetingId, resolutionId);
    const accepted = await commands.voteRecuse(ctx, meetingId, resolutionId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Active votes — resolutions currently open for the meeting (Req 11.3) ────
  app.get("/v1/meetings/:meetingId/votes/active", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const active = await repo.getActiveVotes(ctx.tenantId, meetingId);
    return reply.send({ data: active });
  });
}
