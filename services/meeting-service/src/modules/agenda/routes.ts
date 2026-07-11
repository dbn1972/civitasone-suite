/**
 * Agenda module — HTTP routes (Fastify plugin `agendaRoutes`).
 *
 * Follows the suite CQRS convention exactly (structure.md, mirroring the sibling
 * visit-request / committee route shape):
 *   - writes  → resolveContext → requireRole → zod parse → command publish → 202 { data }
 *   - reads   → resolveContext → requireRole → repo (cache-first) → 200 { data }
 *   - errors  → HttpError (400 validation / 401 unauthenticated / 403 forbidden /
 *               404 not-found / 409 version-conflict / 422 domain-rule) mapped to the
 *               standard envelope by the app-level schema error handler.
 *
 * Route boundary is the ONLY place client input is trusted after validation: every body is
 * parsed through the agenda validators (or a local zod schema for the agenda-book commands)
 * before anything is published. Routes NEVER touch Postgres for writes.
 *
 * agenda-book generate/circulate publish `COMMANDS.agendaBook*` per topics.ts. The agenda_book
 * artifact + circulation-acknowledgement tracking are owned by the document module (task 16);
 * until it lands the consumer side is a stub, but the command contract is published now so the
 * write path is stable. GET agenda-book/status therefore reports agenda readiness + a
 * not-yet-generated book placeholder rather than fabricating circulation data.
 *
 * Endpoints (10):
 *   POST   /v1/meetings/:meetingId/agenda                  submit agenda item
 *   GET    /v1/meetings/:meetingId/agenda                  list agenda items (ordered)
 *   PATCH  /v1/meetings/:meetingId/agenda/:itemId          update agenda item
 *   DELETE /v1/meetings/:meetingId/agenda/:itemId          withdraw agenda item
 *   POST   /v1/meetings/:meetingId/agenda/reorder          reorder agenda
 *   POST   /v1/meetings/:meetingId/agenda/lock             lock agenda
 *   POST   /v1/meetings/:meetingId/agenda/unlock           unlock agenda (chairperson)
 *   POST   /v1/meetings/:meetingId/agenda-book/generate    generate agenda book PDF
 *   POST   /v1/meetings/:meetingId/agenda-book/circulate   circulate agenda book
 *   GET    /v1/meetings/:meetingId/agenda-book/status      circulation status
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.5_
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  agendaItemSubmitSchema,
  agendaItemUpdateSchema,
  agendaItemWithdrawSchema,
  agendaReorderSchema,
  agendaLockSchema,
} from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// ─── RBAC (design § Access Control Matrix) ──────────────────────────────────
// meeting_admin: full CRUD · committee_secretary: create/edit agenda · chairperson:
// transition/lock authority (unlock is chairperson-only) · members/observers: read.
const READ_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "committee_chairperson",
  "committee_member",
  "observer",
  "tenant_admin",
  "super_admin",
];
const WRITE_ROLES = ["meeting_admin", "committee_secretary", "tenant_admin", "super_admin"];
const LOCK_ROLES = ["meeting_admin", "committee_secretary", "committee_chairperson", "tenant_admin", "super_admin"];
/** Unlock is chairperson-only (plus platform admins) per the state machine (Req 3.4). */
const UNLOCK_ROLES = ["meeting_admin", "committee_chairperson", "tenant_admin", "super_admin"];

const SCHEMA_VERSION = "1.0";

// ─── Path-param + agenda-book body schemas (validated at the boundary) ───────
const meetingParam = z.object({ meetingId: z.string().uuid() });
const itemParam = z.object({ meetingId: z.string().uuid(), itemId: z.string().uuid() });

/** POST agenda-book/generate body — mirrors COMMANDS.agendaBookGenerate payload (topics.ts). */
const agendaBookGenerateSchema = z.object({
  templateId: z.string().uuid().optional(),
  includeAtr: z.boolean().optional(),
});
/** POST agenda-book/circulate body — mirrors COMMANDS.agendaBookCirculate payload (topics.ts). */
const agendaBookCirculateSchema = z.object({
  agendaBookId: z.string().uuid(),
  recipientIds: z.array(z.string().uuid()).max(1000).optional(),
});

/** Standard queued-write acknowledgement (→ HTTP 202 body `{ data }`). */
interface Accepted {
  id: string;
  status: "accepted";
  correlationId: string;
}

/** Best-effort agenda read-cache invalidation after a book command is queued. */
async function invalidateAgenda(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "agenda", meetingId));
}

/** Publish a meeting-scoped agenda-book command in the standard CommandEnvelope. */
async function publishBookCommand(
  ctx: RequestContext,
  topic: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(),
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { tenantId: ctx.tenantId, ...payload },
  });
  return { id: resourceId, status: "accepted", correlationId: ctx.correlationId };
}

/** 404 unless the parent meeting exists in the caller's tenant. */
async function assertMeetingExists(tenantId: string, meetingId: string): Promise<void> {
  const meeting = await repo.getMeetingStatus(tenantId, meetingId);
  if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
}

export async function agendaRoutes(app: FastifyInstance): Promise<void> {
  // ── Submit an agenda item (Req 3.1) ──────────────────────────────────────
  app.post("/v1/meetings/:meetingId/agenda", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = agendaItemSubmitSchema.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.agendaItemSubmit(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── List agenda items, ordered by sequence (Req 3.3) ─────────────────────
  app.get("/v1/meetings/:meetingId/agenda", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const rows = await repo.getAgendaByMeeting(ctx.tenantId, meetingId);
    return reply.send({ data: rows });
  });

  // ── Update an agenda item (Req 3.1, 3.2) ─────────────────────────────────
  app.patch("/v1/meetings/:meetingId/agenda/:itemId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId, itemId } = itemParam.parse(req.params);
    // Merge the path item id, then validate version + patch shape at the boundary.
    const body = agendaItemUpdateSchema.parse({ ...(req.body as object), agendaItemId: itemId });
    const item = await repo.getAgendaItem(ctx.tenantId, itemId);
    if (!item || item.meetingId !== meetingId) throw new HttpError(404, "NOT_FOUND", "agenda item not found");
    const accepted = await commands.agendaItemUpdate(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Withdraw an agenda item (Req 3.2) — soft state change, never hard-delete ─
  app.delete("/v1/meetings/:meetingId/agenda/:itemId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId, itemId } = itemParam.parse(req.params);
    const body = agendaItemWithdrawSchema.parse({ ...(req.body as object), agendaItemId: itemId });
    const item = await repo.getAgendaItem(ctx.tenantId, itemId);
    if (!item || item.meetingId !== meetingId) throw new HttpError(404, "NOT_FOUND", "agenda item not found");
    const accepted = await commands.agendaItemWithdraw(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Reorder the agenda (Req 3.3, 3.4) ─────────────────────────────────────
  app.post("/v1/meetings/:meetingId/agenda/reorder", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = agendaReorderSchema.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.agendaReorder(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Lock the agenda (Req 3.4) ─────────────────────────────────────────────
  app.post("/v1/meetings/:meetingId/agenda/lock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCK_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = agendaLockSchema.parse({ ...(req.body as object), locked: true });
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.agendaLock(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Unlock the agenda — chairperson only (Req 3.4) ────────────────────────
  app.post("/v1/meetings/:meetingId/agenda/unlock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UNLOCK_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = agendaLockSchema.parse({ ...(req.body as object), locked: false });
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await commands.agendaLock(ctx, meetingId, body);
    return reply.code(202).send({ data: accepted });
  });

  // ── Generate the agenda book PDF (Req 4.1) ────────────────────────────────
  app.post("/v1/meetings/:meetingId/agenda-book/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = agendaBookGenerateSchema.parse(req.body ?? {});
    await assertMeetingExists(ctx.tenantId, meetingId);
    // Mint the book id here so it doubles as the message id (idempotent) and the client
    // gets a stable id to poll once the document module materialises the artifact.
    const agendaBookId = randomUUID();
    const accepted = await publishBookCommand(ctx, COMMANDS.agendaBookGenerate, agendaBookId, {
      meetingId,
      agendaBookId,
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      ...(body.includeAtr !== undefined ? { includeAtr: body.includeAtr } : {}),
    });
    await invalidateAgenda(ctx.tenantId, meetingId);
    return reply.code(202).send({ data: accepted });
  });

  // ── Circulate the agenda book (Req 4.1, 4.5) ──────────────────────────────
  app.post("/v1/meetings/:meetingId/agenda-book/circulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const body = agendaBookCirculateSchema.parse(req.body);
    await assertMeetingExists(ctx.tenantId, meetingId);
    const accepted = await publishBookCommand(ctx, COMMANDS.agendaBookCirculate, body.agendaBookId, {
      meetingId,
      agendaBookId: body.agendaBookId,
      ...(body.recipientIds !== undefined ? { recipientIds: body.recipientIds } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  // ── Agenda-book circulation status (Req 4.5) ──────────────────────────────
  app.get("/v1/meetings/:meetingId/agenda-book/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { meetingId } = meetingParam.parse(req.params);
    const meeting = await repo.getMeetingStatus(ctx.tenantId, meetingId);
    if (!meeting) throw new HttpError(404, "MEETING_NOT_FOUND", "meeting not found");
    const deadline = await repo.checkDeadline(ctx.tenantId, meetingId);
    return reply.send({
      data: {
        meetingId,
        agendaLocked: meeting.status === "agenda_locked",
        itemCount: deadline?.itemCount ?? 0,
        acceptedCount: deadline?.acceptedCount ?? 0,
        submissionDeadline: deadline?.submissionDeadline ?? null,
        pastDeadline: deadline?.pastDeadline ?? false,
        // Circulation acknowledgement tracking is owned by the document module (task 16);
        // reported as not-yet-generated until that consumer lands (no fabricated data).
        book: { generated: false, circulated: false, acknowledgements: [] as unknown[] },
      },
    });
  });
}
