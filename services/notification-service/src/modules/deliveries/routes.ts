import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { sendNotificationBody, deliveryIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

export async function deliveryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/notifications/send", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = sendNotificationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.sendNotification(ctx, body));
  });

  app.get("/notifications/deliveries", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = z.object({
      userId: z.string().uuid().optional(),
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    return reply.send(await queries.listDeliveries(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/notifications/deliveries/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = deliveryIdParam.parse(req.params);
    const delivery = await queries.getDelivery(ctx.tenantId, id);
    if (!delivery) throw new HttpError(404, "NOT_FOUND", "delivery not found");
    return reply.send(delivery);
  });
}
