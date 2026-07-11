/**
 * Participant module — HTTP routes (Fastify plugin `participantRoutes`, 8 endpoints, Req 5.1–5.7).
 *
 * Follows the suite CQRS + envelope conventions (structure.md, steering) and mirrors the
 * already-implemented sibling routes (committee/routes.ts, agenda/routes.ts, voting/routes.ts):
 *   • WRITES — `resolveContext` → `requireRole` → require `X-Idempotency-Key` → zod validate
 *              (participant/validators.ts) → command publish (participant/commands.ts) → 202
 *              `{ data: Accepted }`. Routes NEVER write to Postgres directly; the participant
 *              consumer applies the change and emits the outbox event.
 *   • READS  — cache-first `repo.*` lookups (participant/repo.ts). Lists →
 *              `{ data, meta: { page, pageSize, total } }`; a single computed resource →
 *              `{ data }`. A missing parent meeting / participant 404s BEFORE any write.
 *
 * Idempotency (steering: API Design Standards): `X-Idempotency-Key` is REQUIRED on every write
 * (POST/PATCH/DELETE that triggers a queued write). The header is surfaced on `ctx.idempotencyKey`
 * by the auth context resolver; a missing key is rejected with 400 before any command is published.
 *
 * Error paths (no per-route handler — the app-level `registerSchemaErrorHandler` maps them):
 *   • zod parse failure / missing idempotency key → 400 VALIDATION_FAILED
 *   • `resolveContext`  → 401 for unauthenticated callers
 *   • `requireRole`     → 403 FORBIDDEN
 *   • unknown / other-tenant meeting or participant → 404 (checked here before publish)
 *   • optimistic-lock clash on a queued write → 409 (from the consumer's versioned write)
 *
 * RBAC (design.md § Access Control Matrix):
 *   • Add / update / remove / invite — `meeting_admin` + `committee_secretary` (+ tenant/super
 *     admin): the secretariat staffs the participant list and dispatches invitations (Req 5.1, 5.2).
 *   • Respond (RSVP) / nominate — the invited member acts on their own invitation, so
 *     `committee_member` (+ chairperson + secretariat + admins) may call these (Req 5.2, 5.5, 5.6).
 *     Observers may not nominate.
 *   • All reads — admin/secretary/chairperson/member/observer within the tenant.
 *
 * The optimistic-lock `version` for a PATCH/DELETE may be supplied by the client (an
 * `If-Match`-style body field); when omitted it defaults to the currently-persisted version read
 * alongside the existence (404) check.
 *
 * Endpoints (8):
 *   POST   /v1/meetings/:meetingId/participants                            add participant(s)
 *   GET    /v1/meetings/:meetingId/participants                            list roster (paged)
 *   PATCH  /v1/meetings/:meetingId/participants/:participantId             update a participant
 *   DELETE /v1/meetings/:meetingId/participants/:participantId             remove a participant
 *   POST   /v1/meetings/:meetingId/participants/:participantId/respond     record an RSVP
 *   POST   /v1/meetings/:meetingId/participants/:participantId/nominate    designate a proxy
 *   POST   /v1/meetings/:meetingId/participants/invite                     send invitations
 *   GET    /v1/meetings/:meetingId/participants/quorum-status              real-time quorum tally
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  participantAddSchema,
  participantsAddSchema,
  participantPatchSchema,
  participantRespondSchema,
  participantNominateSchema,
  participantQueryParams,
  meetingIdParam,
  participantIdParam,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// ─── RBAC role groups (design § Access Control Matrix) ───────────────────────

/** Staff the participant roster + dispatch invitations (admins + secretariat). */
const WRITE_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin", "admin"];
/** Act on an invitation — RSVP / nominate a proxy (members + chairperson + secretariat + admins). */
const MEMBER_ACTION_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "tenant_admin",
  "super_admin",
  "admin",
];
/** Read access to the participant roster + quorum status (all meeting roles within the tenant). */
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
 * Send-invitations body (Req 5.2). There is no shared `invitationsSend` validator (the command
 * payload is optional-only), so the request body is validated by this small local schema: an
 * optional subset of participant ids and an optional subset of delivery channels. Omitting both
 * lets the consumer default to all not-declined participants across email + SMS + push.
 */
const inviteBodySchema = z
  .object({
    participantIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
    channels: z.array(z.enum(["email", "sms", "push"])).min(1).max(3).optional(),
  })
  .strict();

/** Optional optimistic-lock version + removal reason accepted on write bodies. */
const versionBody = z.object({
  version: z.coerce.number().int().nonnegative().optional(),
  reason: z.string().max(1024).optional(),
});

/**
 * Enforce the mandatory `X-Idempotency-Key` on writes (steering: idempotency REQUIRED on all
 * POST/PATCH/DELETE that trigger a queued write). Rejected as 400 before any command is published.
 */
function requireIdempotencyKey(ctx: RequestContext): void {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.trim().length === 0) {
    throw new HttpError(400, "VALIDATION_FAILED", "X-Idempotency-Key header is required for this operation");
  }
}

/** Build the standard list envelope meta from offset/limit pagination. */
function listMeta(offset: number, limit: number, total: number) {
  return { page: Math.floor(offset / limit) + 1, pageSize: limit, total };
}

/** 404 unless the parent meeting exists in the caller's tenant. */
async function assertMeetingExists(tenantId: string, meetingId: string): Promise<void> {
  const meeting = await repo.getMeetingRef(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
}

export async function participantRoutes(app: FastifyInstance): Promise<void> {
  // ─── Add participant(s) (Req 5.1, 5.7) ─────────────────────────────────────
  /** POST /v1/meetings/:meetingId/participants — add one participant or a batch. */
  app.post("/v1/meetings/:meetingId/participants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    // Accept either a single participant body or a `{ participants: [...] }` batch (design:
    // "Add participant(s)"). Normalise both to the batch shape the command publisher expects.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const body =
      "participants" in raw
        ? participantsAddSchema.parse(raw)
        : { participants: [participantAddSchema.parse(raw)] };
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.participantAdd(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ─── List roster, paginated + filterable (Req 5.1) ─────────────────────────
  /** GET /v1/meetings/:meetingId/participants — list the meeting's participants. */
  app.get("/v1/meetings/:meetingId/participants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const q = participantQueryParams.parse(req.query);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const { rows, total } = await repo.getParticipants(ctx.tenantId, meetingId, {
      role: q.role,
      invitationStatus: q.invitationStatus,
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({ data: rows, meta: listMeta(q.offset, q.limit, total) });
  });

  // ─── Real-time quorum status (Req 5.3, 5.4) ────────────────────────────────
  // Declared before the parametric `:participantId` routes so the static `quorum-status`
  // segment is matched unambiguously (Fastify prefers static over parametric anyway).
  /** GET /v1/meetings/:meetingId/participants/quorum-status — confirmed-vs-threshold tally. */
  app.get("/v1/meetings/:meetingId/participants/quorum-status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const status = await repo.getQuorumStatus(ctx.tenantId, meetingId);
    if (!status) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    return reply.send({ data: status });
  });

  // ─── Send invitations (Req 5.2) ────────────────────────────────────────────
  // Static `invite` segment; declared before `:participantId` for clarity.
  /** POST /v1/meetings/:meetingId/participants/invite — dispatch invitations. */
  app.post("/v1/meetings/:meetingId/participants/invite", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = inviteBodySchema.parse(req.body ?? {});
    await assertMeetingExists(ctx.tenantId, meetingId);
    // Omit undefined keys (exactOptionalPropertyTypes): the consumer defaults omitted fields.
    const input: commands.InvitationsSendInput = {
      ...(body.participantIds !== undefined ? { participantIds: body.participantIds } : {}),
      ...(body.channels !== undefined ? { channels: body.channels } : {}),
    };
    const accepted = await commands.invitationsSend(ctx, meetingId, input);
    return reply.code(202).send({ data: accepted });
  });

  // ─── Update a participant (Req 5.1, 5.7) ───────────────────────────────────
  /** PATCH /v1/meetings/:meetingId/participants/:participantId — patch editable fields. */
  app.patch("/v1/meetings/:meetingId/participants/:participantId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, participantId } = participantIdParam.parse(req.params);
    // Flat patch body (at least one field, else 400). `version` (if present) is read separately.
    const patch = participantPatchSchema.parse(req.body);
    const existing = await repo.getParticipant(ctx.tenantId, meetingId, participantId);
    if (!existing) throw new HttpError(404, "MEETING_NOT_FOUND", "participant not found");
    const { version } = versionBody.parse(req.body ?? {});
    const accepted = await commands.participantUpdate(
      ctx,
      meetingId,
      participantId,
      version ?? existing.version,
      patch,
    );
    return reply.code(202).send({ data: accepted });
  });

  // ─── Remove a participant (Req 5.1) ────────────────────────────────────────
  /** DELETE /v1/meetings/:meetingId/participants/:participantId — remove the association. */
  app.delete("/v1/meetings/:meetingId/participants/:participantId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, participantId } = participantIdParam.parse(req.params);
    const existing = await repo.getParticipant(ctx.tenantId, meetingId, participantId);
    if (!existing) throw new HttpError(404, "MEETING_NOT_FOUND", "participant not found");
    const { version, reason } = versionBody.parse(req.body ?? {});
    const accepted = await commands.participantRemove(
      ctx,
      meetingId,
      participantId,
      version ?? existing.version,
      reason,
    );
    return reply.code(202).send({ data: accepted });
  });

  // ─── Record an RSVP (Req 5.2, 5.6) ─────────────────────────────────────────
  /** POST /v1/meetings/:meetingId/participants/:participantId/respond — accept/tentative/decline. */
  app.post("/v1/meetings/:meetingId/participants/:participantId/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MEMBER_ACTION_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, participantId } = participantIdParam.parse(req.params);
    const body = participantRespondSchema.parse(req.body);
    const existing = await repo.getParticipant(ctx.tenantId, meetingId, participantId);
    if (!existing) throw new HttpError(404, "MEETING_NOT_FOUND", "participant not found");
    const accepted = await commands.participantRespond(ctx, meetingId, participantId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ─── Designate a proxy / nominee (Req 5.5) ─────────────────────────────────
  /** POST /v1/meetings/:meetingId/participants/:participantId/nominate — nominate an alternate. */
  app.post("/v1/meetings/:meetingId/participants/:participantId/nominate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MEMBER_ACTION_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId, participantId } = participantIdParam.parse(req.params);
    const body = participantNominateSchema.parse(req.body);
    const existing = await repo.getParticipant(ctx.tenantId, meetingId, participantId);
    if (!existing) throw new HttpError(404, "MEETING_NOT_FOUND", "participant not found");
    const accepted = await commands.participantNominate(ctx, meetingId, participantId, body);
    return reply.code(202).send({ data: accepted });
  });
}
