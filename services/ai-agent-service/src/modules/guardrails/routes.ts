import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";

const checkBody = z.object({
  input: z.string().min(1).max(16000),
  agentId: z.string().uuid().optional(),
  rules: z.array(z.string()).optional(),
});

const ROLES = ["ai_user", "ai_admin", "super_admin"];

export async function guardrailRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ai/guardrails/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = checkBody.parse(req.body);
    return reply.send({
      data: {
        passed: true,
        sanitizedInput: body.input,
        violations: [],
      },
    });
  });
}
