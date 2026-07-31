import type { FastifyInstance } from "fastify";
import { z } from "zod";

const articleIdParam = z.object({ articleId: z.string().min(1).max(30) });

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/adapters/apt/tracking/:articleId", async (req, reply) => {
    const { articleId } = articleIdParam.parse(req.params);
    return reply.send({
      data: {
        articleId,
        status: "in-transit",
        events: [],
        lastUpdated: null,
      },
    });
  });
}
