import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { READ_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import * as guardrailsRepo from "../guardrails/repo.js";
import { evaluateRules } from "../guardrails/domain.js";
import { estimateTokens, buildTurnSummary, validateStatusTransition } from "./domain.js";
import * as commands from "./commands.js";

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
  app.post("/v1/ai/chat", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = sendMessageBody.parse(req.body);

    const rules = await guardrailsRepo.listActive(ctx.tenantId);
    const evaluation = evaluateRules(body.message, rules);

    if (!evaluation.passed) {
      const reason = evaluation.violations.map((v) => v.message).join("; ").slice(0, 500);
      await commands.recordBlockedAudit(ctx, {
        action: "chat.send",
        input: evaluation.sanitizedInput,
        reason,
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

    const accepted = await commands.sendMessage(ctx, {
      conversationId,
      messageId,
      isNew,
      channelId: body.channelId,
      profileId: body.profileId ?? ctx.actorId,
      language: body.language ?? "en",
      sanitizedInput: evaluation.sanitizedInput,
      tokens,
      violationCount: evaluation.violations.length,
    });

    return reply.code(202).send(accepted);
  });

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
    if (version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "conversation has been modified; retry with current version");
    }

    return reply.code(202).send(
      await commands.endConversation(ctx, conversationId, { version, reason: body.reason ?? null }),
    );
  });
}
