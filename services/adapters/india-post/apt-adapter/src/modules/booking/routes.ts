import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const ALLOWED_ROLES = ["adapter_admin", "logistics_officer", "super_admin", "tenant_admin"];

const bookingBody = z.object({
  senderName: z.string().min(1).max(200),
  senderPin: z.string().length(6),
  recipientName: z.string().min(1).max(200),
  recipientPin: z.string().length(6),
  articleType: z.string().min(1).max(30),
  weight: z.number().positive(),
  declaredValue: z.number().nonnegative().optional(),
});

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/adapters/apt/booking", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);

    const parsed = bookingBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const body = parsed.data;
    return reply.status(202).send({
      data: {
        bookingId: randomUUID(),
        articleType: body.articleType,
        status: "queued",
        estimatedCost: null,
      },
    });
  });
}
