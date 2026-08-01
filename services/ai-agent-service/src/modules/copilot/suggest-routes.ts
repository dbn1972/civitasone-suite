import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { buildSuggestion } from "./suggest-domain.js";
import { detectInjection, blocksInteraction } from "../guardrails/injection-domain.js";

const TASK_TYPE_ENUM = z.enum([
  "draft_reply",
  "summarize",
  "next_action",
  "classify",
  "escalate",
  "explain",
]);

const suggestBody = z.object({
  context: z.record(z.unknown()),
  taskType: TASK_TYPE_ENUM,
});

export async function copilotSuggestRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/ai/copilot/suggest — employee copilot suggestion envelope (F.3)
  app.post("/v1/ai/copilot/suggest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = suggestBody.parse(req.body);

    // The context is user-supplied free text in places, so it goes through the
    // injection gate too (F.8) — a poisoned case note must not steer the copilot.
    const serializedContext = JSON.stringify(body.context);
    const injection = detectInjection(serializedContext);
    if (blocksInteraction(injection)) {
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: EVENTS.injectionDetected,
          eventType: EVENTS.injectionDetected,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: { severity: injection.severity, patterns: injection.patterns, blocked: true },
        });

        await writeAudit(tx, ctx, {
          action: "copilot.suggest",
          input: null,
          output: injection.patterns.join(", "),
          blocked: true,
          reason: `prompt injection severity ${injection.severity}`,
        });
      });

      return reply.status(422).send({
        code: "PROMPT_INJECTION_BLOCKED",
        message: "context blocked by prompt-injection defence",
        correlationId: ctx.correlationId,
        retryable: false,
        details: { patterns: injection.patterns, severity: injection.severity },
      });
    }

    const envelope = buildSuggestion({ taskType: body.taskType, context: body.context });
    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        userId: ctx.actorId,
        // Only the task type is persisted as the prompt: the raw context can hold
        // citizen data and the copilot turn table is not the place for it.
        prompt: `copilot.suggest:${body.taskType}`,
        response: null,
        sourceCitations: [],
        model: null,
        tokens: null,
        latencyMs: null,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { turnId: id, kind: "copilot_suggest", taskType: body.taskType, confidence: envelope.confidence },
      });

      await writeAudit(tx, ctx, {
        action: "copilot.suggest",
        input: body.taskType,
        output: null,
        blocked: false,
        reason: null,
      });
    });

    return reply.status(202).send({ data: { id, ...envelope } });
  });
}
