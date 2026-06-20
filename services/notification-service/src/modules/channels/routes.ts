import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { createChannelBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.post("/notifications/channels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createChannelBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createChannel(ctx, body));
  });

  app.get("/notifications/channels", async (req, reply) => {
    const ctx = resolveContext(req);
    return reply.send(await queries.listChannels(ctx.tenantId));
  });
}
