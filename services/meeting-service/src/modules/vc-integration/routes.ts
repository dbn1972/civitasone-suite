/**
 * VC-integration module — HTTP routes (Fastify plugin `vcRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling voting / agenda
 * route shape):
 *   - writes  → resolveContext → requireRole → require X-Idempotency-Key → zod parse →
 *               command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - errors  → HttpError (400 validation / 401 unauthenticated / 403 forbidden / 404 not-found /
 *               503 VC_PROVIDER_UNAVAILABLE) mapped to the standard envelope by the app-level
 *               schema error handler.
 *
 * Idempotency (steering: API Design Standards): `X-Idempotency-Key` is REQUIRED on every write
 * that triggers a queued write. The provider WEBHOOK is the one exemption — it is a provider
 * callback that cannot supply the header; instead its optional `eventId` seeds the command message
 * id for `markProcessed` dedup, and the (meeting, participant) attendance unique index is the
 * ultimate idempotency guard (Req 13.3).
 *
 * VC provider availability (Req 13.5): `POST /vc/create` synchronously checks the tenant's provider
 * fallback chain and rejects with `503 VC_PROVIDER_UNAVAILABLE` when EVERY configured provider's
 * circuit breaker is open — rather than queueing a create that cannot succeed. When at least one
 * provider is available the create is accepted (202); provider fallback + switch notification
 * happen in the consumer (Req 13.5/13.6).
 *
 * Endpoints (7):
 *   POST /v1/meetings/:meetingId/vc/create            provision a VC session (secretary/chair)
 *   GET  /v1/meetings/:meetingId/vc/session           the meeting's current VC session
 *   POST /v1/meetings/:meetingId/vc/start-recording   start recording (Req 13.8)
 *   POST /v1/meetings/:meetingId/vc/stop-recording    stop recording (Req 13.7/13.8)
 *   POST /v1/meetings/:meetingId/vc/end               end the VC session (Req 13.7)
 *   GET  /v1/meetings/:meetingId/vc/participants       participants recorded via VC presence (Req 13.3)
 *   POST /v1/meetings/:meetingId/vc/webhook            provider callback: participant joined (Req 13.3)
 *
 * _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
 */
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError, httpError } from "../../shared/context.js";
import { hasAnyRole } from "@civitasone/auth";
import { toPublicVcSession } from "./presenter.js";
import {
  vcCreateSessionSchema,
  vcSessionActionSchema,
  vcWebhookSchema,
  meetingIdParam,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { resolveVcChain, anyProviderAvailable } from "./provider.js";

// ─── RBAC (design § Access Control Matrix) ───────────────────────────────────
// The secretary/chairperson manage the meeting's VC session lifecycle (Req 13.2, 13.7, 13.8).
// Everyone associated with the meeting may read the session + VC participants.
const VC_WRITE_ROLES = ["meeting_admin", "committee_chairperson", "committee_secretary", "tenant_admin", "super_admin"];
const VC_READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
];
// The webhook is a service-to-service callback (the VC adapter's relay), authenticated with a
// service token — not an end-user role.
const VC_WEBHOOK_ROLES = ["meeting_admin", "vc_service", "tenant_admin", "super_admin"];

/**
 * Enforce the mandatory `X-Idempotency-Key` on writes (steering: idempotency REQUIRED on all POST
 * that trigger a queued write). Rejected as 400 before any command is published.
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

/** 404 unless the VC session exists in the caller's tenant AND belongs to the path meeting. */
async function assertSessionInMeeting(tenantId: string, meetingId: string, vcSessionId: string): Promise<void> {
  const session = await repo.getVcSessionRef(tenantId, vcSessionId);
  if (!session || session.meetingId !== meetingId) {
    throw new HttpError(404, "VC_SESSION_NOT_FOUND", "vc session not found");
  }
}

export async function vcRoutes(app: FastifyInstance): Promise<void> {
  // ── Create a VC session (Req 13.2, 13.5) ────────────────────────────────────
  app.post("/v1/meetings/:meetingId/vc/create", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = vcCreateSessionSchema.parse(req.body ?? {});
    await assertMeetingExists(ctx.tenantId, meetingId);

    // Req 13.5: reject up-front when no configured provider is currently available (all breakers
    // open) rather than queueing a create that cannot be served.
    const chain = resolveVcChain(ctx.tenantId, body.platform);
    if (!anyProviderAvailable(chain)) {
      throw httpError("VC_PROVIDER_UNAVAILABLE", "no video-conference provider is currently available");
    }

    const accepted = await commands.vcSessionCreate(ctx, meetingId, body);
    reply.header("location", `/v1/meetings/${meetingId}/vc/session`);
    return reply.code(202).send({ data: accepted });
  });

  // ── Get the meeting's current VC session (Req 13.2, 13.7) ───────────────────
  app.get("/v1/meetings/:meetingId/vc/session", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const session = await repo.getVcSession(ctx.tenantId, meetingId);
    if (!session) throw new HttpError(404, "VC_SESSION_NOT_FOUND", "no vc session for this meeting");
    // Strip internal identifiers (externalId, recordingStorageKey) for all clients and
    // gate the dial-in PIN to session hosts (VC write roles) — see presenter.ts.
    const includeHostSecrets = hasAnyRole(ctx, VC_WRITE_ROLES);
    return reply.send({ data: toPublicVcSession(session, { includeHostSecrets }) });
  });

  // ── Start recording (Req 13.8) ──────────────────────────────────────────────
  app.post("/v1/meetings/:meetingId/vc/start-recording", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = vcSessionActionSchema.parse(req.body);
    await assertSessionInMeeting(ctx.tenantId, meetingId, body.vcSessionId);
    const accepted = await commands.vcRecordingStart(ctx, meetingId, body.vcSessionId);
    return reply.code(202).send({ data: accepted });
  });

  // ── Stop recording (Req 13.7, 13.8) ─────────────────────────────────────────
  app.post("/v1/meetings/:meetingId/vc/stop-recording", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = vcSessionActionSchema.parse(req.body);
    await assertSessionInMeeting(ctx.tenantId, meetingId, body.vcSessionId);
    const accepted = await commands.vcRecordingStop(ctx, meetingId, body.vcSessionId);
    return reply.code(202).send({ data: accepted });
  });

  // ── End the VC session (Req 13.7) ────────────────────────────────────────────
  app.post("/v1/meetings/:meetingId/vc/end", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_WRITE_ROLES);
    requireIdempotencyKey(ctx);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = vcSessionActionSchema.parse(req.body);
    await assertSessionInMeeting(ctx.tenantId, meetingId, body.vcSessionId);
    const accepted = await commands.vcSessionEnd(ctx, meetingId, body.vcSessionId);
    return reply.code(202).send({ data: accepted });
  });

  // ── VC participants — recorded via VC presence (Req 13.3) ───────────────────
  app.get("/v1/meetings/:meetingId/vc/participants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_READ_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const data = await repo.getVcParticipants(ctx.tenantId, meetingId);
    return reply.send({ data });
  });

  // ── Provider webhook — a participant joined (Req 13.3) ──────────────────────
  // Exempt from X-Idempotency-Key (provider callback); `eventId` seeds command dedup instead.
  app.post("/v1/meetings/:meetingId/vc/webhook", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VC_WEBHOOK_ROLES);
    const { meetingId } = meetingIdParam.parse(req.params);
    const body = vcWebhookSchema.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.vcWebhook(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });
}
