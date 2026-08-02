import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { READ_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as guardrailsRepo from "../guardrails/repo.js";
import { evaluateRules } from "../guardrails/domain.js";
import { detectInjection, blocksInteraction } from "../guardrails/injection-domain.js";
import { estimateTokens, buildTurnSummary, validateMessageRole } from "./domain.js";

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
  app.post("/v1/ai/chat/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = startBody.parse(req.body);
    const id = randomUUID();
    const language = body.language ?? "en";
    return reply.code(202).send(
      await commands.startChatSession(ctx, {
        id,
        channelId: body.channelId,
        profileId: body.profileId ?? ctx.actorId,
        language,
      }),
    );
  });

  app.post("/v1/ai/chat/sessions/:id/messages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = messageBody.parse(req.body);

    const roleError = validateMessageRole(body.role);
    if (roleError) throw new HttpError(422, "ROLE_INVALID", roleError);

    const session = await repo.findById(id, ctx.tenantId);
    if (!session) throw new HttpError(404, "NOT_FOUND", "chat session not found");
    if (session.status !== "active") throw new HttpError(422, "SESSION_ENDED", "chat session is not active");

    const injection = detectInjection(body.message);
    if (blocksInteraction(injection)) {
      await commands.recordBlockedAudit(ctx, {
        action: "chat.session_message",
        input: null,
        reason: `prompt injection severity ${injection.severity}`,
        output: injection.patterns.join(", "),
        extra: {
          kind: "injection",
          conversationId: id,
          severity: injection.severity,
          patterns: injection.patterns,
        },
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
      await commands.recordBlockedAudit(ctx, {
        action: "chat.session_message",
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

    const messageId = randomUUID();
    const tokens = estimateTokens(evaluation.sanitizedInput);
    return reply.code(202).send(
      await commands.sendSessionMessage(ctx, {
        conversationId: id,
        messageId,
        role: body.role,
        sanitizedInput: evaluation.sanitizedInput,
        tokens,
        violationCount: evaluation.violations.length,
      }),
    );
  });

  app.get("/v1/ai/chat/sessions/:id/transcript", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = transcriptQuery.parse(req.query);
    const session = await repo.findById(id, ctx.tenantId);
    if (!session) throw new HttpError(404, "NOT_FOUND", "chat session not found");
    const { rows, total } = await repo.listMessages(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toMessageView),
      meta: { page, pageSize: q.limit, total },
      summary: buildTurnSummary(rows.map((r) => ({ role: r.role, content: r.content, tokens: r.tokens }))),
    });
  });
}
