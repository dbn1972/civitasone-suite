import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { createAlertRuleBody, alertRuleIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.post("/notifications/alert-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createAlertRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAlertRule(ctx, body));
  });

  app.patch("/notifications/alert-rules/:id/enable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = alertRuleIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.enableAlertRule(ctx, id));
  });

  app.patch("/notifications/alert-rules/:id/disable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = alertRuleIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disableAlertRule(ctx, id));
  });

  app.get("/notifications/alert-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    return reply.send(await queries.listAlertRules(ctx.tenantId));
  });
}
