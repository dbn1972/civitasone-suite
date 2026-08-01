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
import { detectInjection, blocksInteraction } from "../guardrails/injection-domain.js";
import { estimateTokens, buildTurnSummary, validateMessageRole } from "./domain.js";

/**
 * F.3 customer chatbot session surface.
 *
 * Sessions and their transcript reuse ai_agent.conversations / ai_agent.messages
 * (migration 0001) — the existing schema already models exactly this (channel,
 * profile, status, language + ordered role/content rows), so no new table is
 * introduced. These routes are the customer-facing session vocabulary on top of
 * it; POST /v1/ai/chat remains the single-shot entry point.
 */

const startBody = z.object({
  channelId: z.string().uuid(),
  profileId: z.string().uuid().optional(),
  language: z.string().max(8).optional(),
});

const messageBody = z.object({
  message: z.string().min(1).max(4000),
  role: z.enum(["user", "assistant", "system"]).default("user"),
});

const idParam = z.object({ id: z.string().uuid() });

const transcriptQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function chatSessionRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/ai/chat/sessions — start a customer chat session (F.3)
  app.post("/v1/ai/chat/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = startBody.parse(req.body);

    const id = randomUUID();
    const language = body.language ?? "en";

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        channelId: body.channelId,
        profileId: body.profileId ?? ctx.actorId,
        status: "active",
        language,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.conversationStarted,
        eventType: EVENTS.conversationStarted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { conversationId: id, channelId: body.channelId, language },
      });

      await writeAudit(tx, ctx, {
        action: "chat.session_start",
        input: null,
        output: id,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(202).send({
      data: { sessionId: id, channelId: body.channelId, status: "active", language, version: 1 },
    });
  });

  // POST /v1/ai/chat/sessions/:id/messages — send a message (F.3)
  app.post("/v1/ai/chat/sessions/:id/messages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = messageBody.parse(req.body);

    const roleError = validateMessageRole(body.role);
    if (roleError) {
      throw new HttpError(422, "ROLE_INVALID", roleError);
    }

    const session = await repo.findById(id, ctx.tenantId);
    if (!session) {
      throw new HttpError(404, "NOT_FOUND", "chat session not found");
    }
    if (session.status !== "active") {
      throw new HttpError(422, "SESSION_ENDED", "chat session is not active");
    }

    // F.8: injection defence runs before the configurable guardrails and before
    // anything is persisted — a high-severity attempt never reaches the model.
    const injection = detectInjection(body.message);
    if (blocksInteraction(injection)) {
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: EVENTS.injectionDetected,
          eventType: EVENTS.injectionDetected,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: { conversationId: id, severity: injection.severity, patterns: injection.patterns, blocked: true },
        });

        // Pattern families only — never the attacker-supplied text.
        await writeAudit(tx, ctx, {
          action: "chat.session_message",
          input: null,
          output: injection.patterns.join(", "),
          blocked: true,
          reason: `prompt injection severity ${injection.severity}`,
        });
      });

      return reply.status(422).send({
        code: "PROMPT_INJECTION_BLOCKED",
        message: "message blocked by prompt-injection defence",
        correlationId: ctx.correlationId,
        retryable: false,
        details: { patterns: injection.patterns, severity: injection.severity },
      });
    }

    const rules = await guardrailsRepo.listActive(ctx.tenantId);
    const evaluation = evaluateRules(body.message, rules);

    if (!evaluation.passed) {
      const reason = evaluation.violations.map((v) => v.message).join("; ").slice(0, 500);
      await db.transaction(async (tx) => {
        await writeAudit(tx, ctx, {
          action: "chat.session_message",
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

    const messageId = randomUUID();
    const tokens = estimateTokens(evaluation.sanitizedInput);

    await db.transaction(async (tx) => {
      await repo.insertMessage(tx, {
        id: messageId,
        tenantId: ctx.tenantId,
        conversationId: id,
        role: body.role,
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
        payload: { conversationId: id, messageId, role: body.role, tokens },
      });

      await writeAudit(tx, ctx, {
        action: "chat.session_message",
        input: evaluation.sanitizedInput,
        output: null,
        blocked: false,
        reason: evaluation.violations.length > 0 ? "guardrail warnings recorded" : null,
      });
    });

    return reply.status(202).send({
      data: {
        sessionId: id,
        messageId,
        role: body.role,
        tokens,
        status: "accepted",
        sanitizedInput: evaluation.sanitizedInput,
        guardrail: { passed: true, violations: evaluation.violations },
        injection,
      },
    });
  });

  // GET /v1/ai/chat/sessions/:id/transcript — ordered, paginated transcript (F.3)
  app.get("/v1/ai/chat/sessions/:id/transcript", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = transcriptQuery.parse(req.query);

    const session = await repo.findById(id, ctx.tenantId);
    if (!session) {
      throw new HttpError(404, "NOT_FOUND", "chat session not found");
    }

    const { rows, total } = await repo.listMessages(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(repo.toMessageView),
      meta: { page, pageSize: q.limit, total },
      summary: buildTurnSummary(rows.map((r) => ({ role: r.role, content: r.content, tokens: r.tokens }))),
    });
  });
}
