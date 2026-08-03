/**
 * Lead conversion routes (OP-001).
 * POST /v1/crm/leads/:id/convert — convert a qualified lead to account/contact/deal
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { contacts } from "./schema.js";
import { eq, and } from "drizzle-orm";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

const convertLeadBody = z.object({
  createAccount: z.boolean(),
  accountName: z.string().min(1).max(200).optional(),
  dealName: z.string().min(1).max(200).optional(),
  dealValue: z.string().regex(/^\d+$/).optional(),
});

const CONVERTIBLE_STATUSES = ["qualified", "converted"];

export async function conversionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/leads/:id/convert", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = convertLeadBody.parse(req.body);

    // Validate: if createAccount is true, accountName is required
    if (body.createAccount && !body.accountName) {
      throw new HttpError(400, "VALIDATION_FAILED", "accountName is required when createAccount is true");
    }

    // Lookup lead status
    const lead = await scopedRead(async (tx) => {
      const result = await tx.select({
        id: contacts.id,
        leadStatus: contacts.leadStatus,
        status: contacts.status,
        name: contacts.name,
      }).from(contacts).where(
        and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)),
      );
      return result[0] ?? null;
    });

    if (!lead || lead.status === "inactive") {
      throw new HttpError(404, "NOT_FOUND", "lead not found");
    }

    if (!CONVERTIBLE_STATUSES.includes(lead.leadStatus)) {
      throw new HttpError(422, "INVALID_STATUS", `lead must be in qualified or converted status to convert, currently: ${lead.leadStatus}`);
    }

    const msgId = commandId(ctx, `${COMMANDS.leadConvert}:${id}`);
    // Ids are allocated here, not in the consumer, so a redelivered command
    // re-uses them (ON CONFLICT DO NOTHING) instead of creating a second
    // account/opportunity, and the caller can be told what was created.
    const accountId = body.createAccount ? commandId(ctx, `${COMMANDS.leadConvert}:account:${id}`) : null;
    const dealId = body.dealName ? commandId(ctx, `${COMMANDS.leadConvert}:deal:${id}`) : null;
    await queue.publish(COMMANDS.leadConvert, {
      messageId: msgId,
      type: COMMANDS.leadConvert,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        leadId: id,
        leadName: lead.name,
        createAccount: body.createAccount,
        accountName: body.accountName ?? null,
        dealName: body.dealName ?? null,
        dealValue: body.dealValue ?? null,
        accountId,
        dealId,
      },
    });

    return reply.code(202).send({
      id: msgId,
      status: "accepted",
      correlationId: ctx.correlationId,
      accountId,
      dealId,
    });
  });
}
