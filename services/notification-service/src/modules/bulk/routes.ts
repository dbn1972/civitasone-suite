import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createCampaignBody, campaignIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function bulkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/notifications/campaigns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createCampaignBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCampaign(ctx, body));
  });

  app.patch("/notifications/campaigns/:id/send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = campaignIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.sendCampaign(ctx, id));
  });

  app.patch("/notifications/campaigns/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = campaignIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelCampaign(ctx, id));
  });

  app.get("/notifications/campaigns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = campaignIdParam.parse(req.params);
    const campaign = await queries.getCampaign(ctx.tenantId, id);
    if (!campaign) throw new HttpError(404, "NOT_FOUND", "campaign not found");
    return reply.send(campaign);
  });
}
