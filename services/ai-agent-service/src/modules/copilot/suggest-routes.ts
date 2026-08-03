import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";
import { READ_ROLES } from "../../shared/roles.js";
import * as commands from "./commands.js";
import { buildSuggestion } from "./suggest-domain.js";
import { detectInjection, blocksInteraction } from "../guardrails/injection-domain.js";

const TASK_TYPE_ENUM = z.enum([
  "draft_reply", "summarize", "next_action", "classify", "escalate", "explain",
]);

const suggestBody = z.object({
  context: z.record(z.unknown()),
  taskType: TASK_TYPE_ENUM,
});

export async function copilotSuggestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ai/copilot/suggest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = suggestBody.parse(req.body);

    const serializedContext = JSON.stringify(body.context);
    const injection = detectInjection(serializedContext);
    if (blocksInteraction(injection)) {
      await commands.recordBlockedAudit(ctx, {
        action: "copilot.suggest",
        input: null,
        reason: `prompt injection severity ${injection.severity}`,
        output: injection.patterns.join(", "),
        extra: {
          kind: "injection",
          severity: injection.severity,
          patterns: injection.patterns,
        },
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
    await commands.suggest(ctx, {
      id,
      taskType: body.taskType,
      confidence: envelope.confidence,
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId, data: { id, ...envelope } });
  });
}
