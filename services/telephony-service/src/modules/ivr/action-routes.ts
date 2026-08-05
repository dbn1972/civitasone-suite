/**
 * Gaps 6 & 7 — IVR action configuration routes.
 *
 * POST /v1/telephony/ivr-actions        — configure an IVR action
 * GET  /v1/telephony/ivr-actions        — list configured actions
 * POST /v1/telephony/ivr-actions/trigger — trigger an IVR action (called by IVR flow engine)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { dispatchIvrAction, type IvrActionConfig, type IvrActionContext } from "./action-handlers.js";

const ADMIN_ROLES = ["telephony_admin", "super_admin"];
const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];

const createIvrActionBody = z.object({
  digit: z.string().min(1).max(4),
  action: z.enum(["create_lead", "send_sms"]),
  templateId: z.string().uuid().optional(),
  leadSource: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

const triggerIvrActionBody = z.object({
  callId: z.string().uuid(),
  callerId: z.string().min(1),
  callerNumber: z.string().min(1),
  didNumber: z.string().optional(),
  ivrSelection: z.string().min(1),
});

export async function ivrActionRoutes(app: FastifyInstance): Promise<void> {
  // Configure an IVR action (admin only)
  app.post("/v1/telephony/ivr-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createIvrActionBody.parse(req.body);

    const id = randomUUID();
    // In a full implementation, this would write to a DB table.
    // For now, return the configured action.
    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        ...body,
        enabled: body.enabled ?? true,
      },
    });
  });

  // Trigger an IVR action (called by the IVR flow engine when a digit is pressed)
  app.post("/v1/telephony/ivr-actions/trigger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const body = triggerIvrActionBody.parse(req.body);

    const actionCtx: IvrActionContext = {
      tenantId: ctx.tenantId,
      callId: body.callId,
      callerId: body.callerId,
      callerNumber: body.callerNumber,
      didNumber: body.didNumber,
      correlationId: ctx.correlationId,
      ivrSelection: body.ivrSelection,
    };

    // Lookup configured actions for the tenant + digit
    // For simplicity, we use env-based config. In production, read from DB.
    const configuredActions = getConfiguredActions(body.ivrSelection);
    if (configuredActions.length === 0) {
      throw new HttpError(404, "NO_ACTION_CONFIGURED", `no IVR action configured for digit ${body.ivrSelection}`);
    }

    for (const config of configuredActions) {
      await dispatchIvrAction(queue, actionCtx, config);
    }

    return reply.code(202).send({
      id: randomUUID(),
      status: "accepted",
      correlationId: ctx.correlationId,
      actionsTriggered: configuredActions.length,
    });
  });
}

/**
 * Retrieve configured actions for a given IVR digit selection.
 * In production, this would query a DB table of tenant-scoped IVR action configs.
 * For now, supports env-based default actions.
 */
function getConfiguredActions(digit: string): IvrActionConfig[] {
  // Default configuration: digit 1 = create lead, digit 2 = send SMS
  const defaults: Record<string, IvrActionConfig[]> = {
    "1": [{ digit: "1", action: "create_lead", leadSource: "ivr_inbound" }],
    "2": [{ digit: "2", action: "send_sms", templateId: process.env.IVR_SMS_TEMPLATE_ID ?? "00000000-0000-4000-8000-000000000001" }],
  };
  return defaults[digit] ?? [];
}
