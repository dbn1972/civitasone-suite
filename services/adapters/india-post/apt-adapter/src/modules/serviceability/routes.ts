import type { FastifyInstance } from "fastify";
import { z } from "zod";

const serviceabilityQuery = z.object({
  originPin: z.string().length(6).optional(),
  destinationPin: z.string().length(6).optional(),
  articleType: z.string().max(30).optional(),
});

export async function serviceabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/adapters/apt/serviceability", async (req, reply) => {
    const query = serviceabilityQuery.parse(req.query);
    return reply.send({
      data: {
        serviceable: true,
        originPin: query.originPin ?? null,
        destinationPin: query.destinationPin ?? null,
        estimatedDays: 3,
        availableServices: ["speed-post", "registered-post", "parcel"],
      },
    });
  });
}
