import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as guardrailsRepo from "../guardrails/repo.js";
import { evaluateRules } from "../guardrails/domain.js";
import { estimateTokens, buildTurnSummary, validateStatusTransition } from "./domain.js";

const sendMessageBody = z.object({
  conversationId: z.string().uuid().optional(),
  channelId: z.string().uuid(),
  profileId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  language: z.string().max(8).optional(),
});

const conversationIdParam = z.object({ conversationId: z.string().uuid() });

const endBody = z.object({
  version: z.number().int().min(1).optional(),
  reason: z.string().max(500).optional(),
}).optional();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["active", "ended"]).optional(),
  profileId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/ai/chat — send a message; creates the conversation on first turn
  app.post("/v1/ai/chat", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = sendMessageBody.parse(req.body);

    // Guardrails run BEFORE anything is persisted.
    const rules = await guardrailsRepo.listActive(ctx.tenantId);
    const evaluation = evaluateRules(body.message, rules);

    if (!evaluation.passed) {
      const reason = evaluation.violations.map((v) => v.message).join("; ").slice(0, 500);
      await db.transaction(async (tx) => {
        // Redacted text only — DPDP Act 2023.
        await writeAudit(tx, ctx, {
          action: "chat.send",
          input: evaluation.sanitizedInput,
          output: null,
          blocked: true,
          reason,
        });
      });
      return reply.status(422).send({
        code: "GUARDRAIL_BLOCKED",
        message: "message blocked by guardrails",
        correlationId: ctx.correlationId,
        retryable: false,
        details: { violations: evaluation.violations },
      });
    }

    const existing = body.conversationId
      ? await repo.findById(body.conversationId, ctx.tenantId)
      : null;

    if (body.conversationId && !existing) {
      throw new HttpError(404, "NOT_FOUND", "conversation not found");
    }
    if (existing && existing.status !== "active") {
      throw new HttpError(422, "CONVERSATION_ENDED", "conversation is not active");
    }

    const isNew = existing === null;
    const conversationId = existing?.id ?? randomUUID();
    const messageId = randomUUID();
    const tokens = estimateTokens(evaluation.sanitizedInput);

    await db.transaction(async (tx) => {
      if (isNew) {
        await repo.insert(tx, {
          id: conversationId,
          tenantId: ctx.tenantId,
          channelId: body.channelId,
          profileId: body.profileId ?? ctx.actorId,
          status: "active",
          language: body.language ?? "en",
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.conversationStarted,
          eventType: EVENTS.conversationStarted,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: { conversationId, channelId: body.channelId, language: body.language ?? "en" },
        });
      }

      await repo.insertMessage(tx, {
        id: messageId,
        tenantId: ctx.tenantId,
        conversationId,
        role: "user",
        content: evaluation.sanitizedInput,
        tokens,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { conversationId, messageId, role: "user", tokens, violations: evaluation.violations.length },
      });

      await writeAudit(tx, ctx, {
        action: "chat.send",
        input: evaluation.sanitizedInput,
        output: null,
        blocked: false,
        reason: evaluation.violations.length > 0 ? "guardrail warnings recorded" : null,
      });
    });

    return reply.status(isNew ? 201 : 202).send({
      data: {
        conversationId,
        messageId,
        status: isNew ? "started" : "accepted",
        tokens,
        sanitizedInput: evaluation.sanitizedInput,
        guardrail: { passed: true, violations: evaluation.violations },
      },
    });
  });

  // GET /v1/ai/chat — list conversations
  app.get("/v1/ai/chat", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.profileId !== undefined ? { profileId: q.profileId } : {}),
      ...(q.channelId !== undefined ? { channelId: q.channelId } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/ai/chat/:conversationId/history — paginated transcript
  app.get("/v1/ai/chat/:conversationId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    const q = historyQuery.parse(req.query);

    const conversation = await repo.findById(conversationId, ctx.tenantId);
    if (!conversation) {
      throw new HttpError(404, "NOT_FOUND", "conversation not found");
    }

    const { rows, total } = await repo.listMessages(conversationId, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(repo.toMessageView),
      meta: { page, pageSize: q.limit, total },
      summary: buildTurnSummary(rows.map((r) => ({ role: r.role, content: r.content, tokens: r.tokens }))),
    });
  });

  // POST /v1/ai/chat/:conversationId/end — close the conversation
  app.post("/v1/ai/chat/:conversationId/end", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    const body = endBody.parse(req.body ?? undefined) ?? {};

    const existing = await repo.findById(conversationId, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "conversation not found");
    }

    const transitionError = validateStatusTransition(existing.status, "ended");
    if (transitionError) {
      throw new HttpError(422, "INVALID_TRANSITION", transitionError);
    }

    const version = body.version ?? existing.version;

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        conversationId,
        ctx.tenantId,
        { status: "ended", endedAt: new Date(), updatedBy: ctx.actorId },
        version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "conversation has been modified; retry with current version");
      }

      await writeAudit(tx, ctx, {
        action: "chat.end",
        input: null,
        output: null,
        blocked: false,
        reason: body.reason ?? null,
      });
    });

    return reply.send({ data: { conversationId, status: "ended", version: version + 1 } });
  });
}
