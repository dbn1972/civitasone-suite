import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createCampaignBody, campaignIdParam, listCampaignsQuery, recordResponseBody } from "./validators.js";
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

  // MK-001: paginated, tenant-scoped campaign list.
  app.get("/notifications/campaigns", async (req, reply) => {
    const ctx = resolveContext(req);
    const { limit, offset } = listCampaignsQuery.parse(req.query);
    return reply.send(await queries.listCampaigns(ctx.tenantId, limit, offset));
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

  // MK-004: server-computed campaign metrics (recipients/responses/ROI).
  app.get("/notifications/campaigns/:id/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = campaignIdParam.parse(req.params);
    const metrics = await queries.getCampaignMetrics(ctx.tenantId, id);
    if (!metrics) throw new HttpError(404, "NOT_FOUND", "campaign not found");
    return reply.send(metrics);
  });

  // MK-004: record/attribute a response — the seam CRM conversions call.
  // Authed as a write, matching the other campaign write routes (ADMIN).
  app.post("/notifications/campaigns/:id/responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = campaignIdParam.parse(req.params);
    const body = recordResponseBody.parse(req.body);
    const result = await queries.recordResponse(ctx.tenantId, {
      campaignId: id,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      converted: body.converted ?? false,
      revenueMinor: body.revenueMinor ?? "0",
    }, ctx.actorId);
    if (!result) throw new HttpError(404, "NOT_FOUND", "campaign not found");
    return reply.send(result);
  });

  app.get("/notifications/campaigns/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = campaignIdParam.parse(req.params);
    const campaign = await queries.getCampaign(ctx.tenantId, id);
    if (!campaign) throw new HttpError(404, "NOT_FOUND", "campaign not found");
    return reply.send(campaign);
  });
}
