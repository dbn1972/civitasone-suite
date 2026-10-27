import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createChannelBody, setChannelEnabledBody, channelIdParam, testSendBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];
const TESTABLE_TYPES = new Set(["email", "in_app"]);

/**
 * F10 (UAT B4): a plain-language reason an admin sees when a channel cannot be test-sent
 * because no number or device is on file for their own account. No status codes or
 * internal terms; says what to do instead.
 */
function testSendDeclineMessage(type: string): string {
  if (type === "sms" || type === "whatsapp") {
    const label = type === "sms" ? "SMS" : "WhatsApp";
    return `We cannot send a test ${label} message because your account has no mobile number on file. Add a mobile number to your profile, or test an email channel instead.`;
  }
  return "We cannot send a test message on this channel because your account has no registered device. Test an email or in-app channel instead.";
}

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

  // Owner decision #25: test-send to the calling admin's OWN address. Only channel
  // types whose address we hold for the admin (email via identity-service; in_app
  // by user id) can be tested; sms/whatsapp/push have no admin number/device on file
  // and are refused rather than guessed. 404 for another tenant's channel.
  app.post("/notifications/channels/:id/test-send", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = channelIdParam.parse(req.params);
    testSendBody.parse(req.body ?? {});
    const existing = await queries.getChannel(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "notification channel not found");
    if (!TESTABLE_TYPES.has(existing.type)) {
      throw new HttpError(422, "TEST_SEND_UNSUPPORTED", testSendDeclineMessage(existing.type));
    }
    if (!existing.enabled) throw new HttpError(409, "CHANNEL_DISABLED", "enable this channel before sending a test");
    return sendAccepted(reply, acceptedResponseSchema, await commands.testSendChannel(ctx, id));
  });

  app.get("/notifications/channels", async (req, reply) => {
    const ctx = resolveContext(req);
    return reply.send(await queries.listChannels(ctx.tenantId));
  });
}
