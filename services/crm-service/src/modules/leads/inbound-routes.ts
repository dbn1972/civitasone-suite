/**
 * Inbound Lead Capture Route — POST /v1/crm/leads/inbound
 *
 * Accepts lead data from any channel (email, telephony, chatbot, whatsapp,
 * partner_api) and queues it for creation as a CRM contact with lead_status='new'.
 * Supports LM-005 requirement.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

/**
 * Roles that may push inbound leads. Machine/integration path only: `integration_bot`
 * for the automated pipelines (email, telephony, chatbot, whatsapp, partner_api) plus
 * the admins who operate them.
 *
 * `crm_user` was removed deliberately. This route creates a contact with no
 * mandatory-field enforcement at all, so leaving the human data-entry role here made
 * LM-001 bypassable by the very role it governs: a crm_user blocked at
 * POST /v1/crm/contacts with 422 could post the identical lead here and get it saved.
 * A human creating a lead by hand must go through POST /v1/crm/contacts, where the
 * tenant's configured mandatory fields are checked.
 */
const INBOUND_ROLES = ["crm_admin", "super_admin", "tenant_admin", "integration_bot"];

const inboundLeadBody = z.object({
  channel: z.enum(["email", "telephony", "chatbot", "whatsapp", "partner_api"]),
  source: z.string().min(1, "source is required"),
  attributes: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    designation: z.string().optional(),
    city: z.string().optional(),
    leadSource: z.string().optional(),
  }).passthrough(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InboundLeadBody = z.infer<typeof inboundLeadBody>;

export async function inboundLeadRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/leads/inbound", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INBOUND_ROLES);

    const body = inboundLeadBody.parse(req.body);
    const messageId = commandId(ctx, COMMANDS.inboundCapture);
    // Allocated here so a redelivered capture command updates the same contact
    // row rather than inserting a duplicate lead.
    const contactId = commandId(ctx, `${COMMANDS.inboundCapture}:contact`);

    await queue.publish(COMMANDS.inboundCapture, {
      messageId,
      type: COMMANDS.inboundCapture,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        contactId,
        channel: body.channel,
        source: body.source,
        attributes: body.attributes,
        metadata: body.metadata ?? {},
      },
    });

    return reply.code(202).send({
      id: messageId,
      status: "accepted",
      correlationId: ctx.correlationId,
      contactId,
    });
  });
}
