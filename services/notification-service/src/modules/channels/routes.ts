import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createChannelBody, setChannelEnabledBody, channelIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  // This module is registered BEFORE app.ts installs its root error handler, so a
  // ZodError from these routes fell through to Fastify's default and surfaced as a
  // 500. Install the uniform envelope locally (400 VALIDATION_FAILED).
  registerSchemaErrorHandler(app, HttpError);
  app.post("/notifications/channels", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createChannelBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createChannel(ctx, body));
  });

  // GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01: enable / disable. 404 for a channel
  // that is not in the caller's tenant (never reveals another tenant's channel).
  app.patch("/notifications/channels/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = channelIdParam.parse(req.params);
    const body = setChannelEnabledBody.parse(req.body);
    const existing = await queries.getChannel(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "notification channel not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.setChannelEnabled(ctx, id, body));
  });

  app.get("/notifications/channels", async (req, reply) => {
    const ctx = resolveContext(req);
    return reply.send(await queries.listChannels(ctx.tenantId));
  });
}
