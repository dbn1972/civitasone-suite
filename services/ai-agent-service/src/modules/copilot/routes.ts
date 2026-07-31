import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const askBody = z.object({
  prompt: z.string().min(1).max(8000),
  context: z.record(z.unknown()).optional(),
  model: z.string().max(64).optional(),
});

const summarizeBody = z.object({
  content: z.string().min(1).max(32000),
  maxLength: z.number().int().min(50).max(2000).optional(),
});

const ROLES = ["ai_user", "ai_admin", "super_admin"];

export async function copilotRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ai/copilot/ask", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = askBody.parse(req.body);
    return reply.status(202).send({
      data: {
        turnId: crypto.randomUUID(),
        status: "queued",
        prompt: body.prompt,
      },
    });
  });

  app.post("/v1/ai/copilot/summarize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = summarizeBody.parse(req.body);
    return reply.status(202).send({
      data: {
        turnId: crypto.randomUUID(),
        status: "queued",
        contentLength: body.content.length,
      },
    });
  });
}
