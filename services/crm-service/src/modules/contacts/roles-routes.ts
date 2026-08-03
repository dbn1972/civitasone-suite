/**
 * Contact relationship roles routes (CM-003) — CQRS write path.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import { scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import * as commands from "./roles-commands.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const roleIdParam = z.object({ id: z.string().uuid(), roleId: z.string().uuid() });

const VALID_ROLES = ["decision_maker", "influencer", "champion", "end_user", "approver", "technical"] as const;

const createRoleBody = z.object({
  dealId: z.string().uuid(),
  role: z.enum(VALID_ROLES),
});

export async function rolesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/contacts/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: contactId } = idParam.parse(req.params);
    const body = createRoleBody.parse(req.body);
    const roleId = commandId(ctx, `${COMMANDS.createContactRole}:${contactId}`);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createContactRole(ctx, roleId, { contactId, dealId: body.dealId, role: body.role }),
    );
  });

  app.get("/v1/crm/contacts/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: contactId } = idParam.parse(req.params);

    const roles = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, contact_id as "contactId", deal_id as "dealId", role, created_at as "createdAt", created_by as "createdBy", version
        FROM crm.contact_roles
        WHERE contact_id = ${contactId} AND tenant_id = ${ctx.tenantId}
        ORDER BY created_at DESC
      `) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ data: roles });
  });

  app.get("/v1/crm/deals/:id/stakeholders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: dealId } = idParam.parse(req.params);

    const stakeholders = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT cr.id as "roleId", cr.contact_id as "contactId", cr.role, cr.created_at as "createdAt",
               c.name as "contactName", c.email as "contactEmail"
        FROM crm.contact_roles cr
        LEFT JOIN crm.contacts c ON c.id = cr.contact_id AND c.tenant_id = cr.tenant_id
        WHERE cr.deal_id = ${dealId} AND cr.tenant_id = ${ctx.tenantId}
        ORDER BY cr.created_at DESC
      `) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ data: stakeholders });
  });

  app.delete("/v1/crm/contacts/:id/roles/:roleId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: contactId, roleId } = roleIdParam.parse(req.params);

    // Without this the consumer's DELETE simply matches nothing and the caller
    // is told 202 Accepted for a role that never existed.
    const found = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.contact_roles
        WHERE id = ${roleId} AND contact_id = ${contactId} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string }>;
    });
    if (found.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "contact role not found");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.deleteContactRole(ctx, roleId, { contactId }),
    );
  });
}
