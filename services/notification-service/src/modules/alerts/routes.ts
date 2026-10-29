import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAlertRuleBody, alertRuleIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

// Synchronous, tenant-scoped existence check before publishing: an unknown id is a
// 404, not a 202 for a command the consumer can only drop (UAT W6 P1). The consumer
// remains the race-safe authority. findRuleById is not tenant-filtered, so the
// tenant comparison here is what isolates tenants.
async function requireAlertRule(tenantId: string, id: string): Promise<void> {
  const rule = await queries.getAlertRule(tenantId, id);
  if (!rule || rule.tenantId !== tenantId) throw new HttpError(404, "NOT_FOUND", "alert rule not found");
}

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
    await requireAlertRule(ctx.tenantId, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.enableAlertRule(ctx, id));
  });

  app.patch("/notifications/alert-rules/:id/disable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = alertRuleIdParam.parse(req.params);
    await requireAlertRule(ctx.tenantId, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.disableAlertRule(ctx, id));
  });

  app.get("/notifications/alert-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    return reply.send(await queries.listAlertRules(ctx.tenantId));
  });
}
