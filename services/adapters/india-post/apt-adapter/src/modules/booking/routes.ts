import type { FastifyInstance } from "fastify";
import { z } from "zod";

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
    const body = bookingBody.parse(req.body);
    return reply.status(202).send({
      data: {
        bookingId: crypto.randomUUID(),
        articleType: body.articleType,
        status: "queued",
        estimatedCost: null,
      },
    });
  });
}
