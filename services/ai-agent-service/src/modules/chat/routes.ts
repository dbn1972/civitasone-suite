import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const sendMessageBody = z.object({
  conversationId: z.string().uuid().optional(),
  channelId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  language: z.string().max(8).optional(),
});

const conversationIdParam = z.object({ conversationId: z.string().uuid() });

const ROLES = ["ai_user", "ai_admin", "super_admin"];

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ai/chat", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = sendMessageBody.parse(req.body);
    return reply.status(202).send({
      data: {
        conversationId: body.conversationId ?? crypto.randomUUID(),
        status: "queued",
        message: "Message accepted for processing",
      },
    });
  });

  app.get("/v1/ai/chat/:conversationId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { conversationId } = conversationIdParam.parse(req.params);
    return reply.send({
      data: [],
      meta: { page: 1, pageSize: 50, total: 0 },
    });
  });
}
