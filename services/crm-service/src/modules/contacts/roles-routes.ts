/**
 * Contact relationship roles routes (CM-003).
 * POST /v1/crm/contacts/:id/roles — assign a role on a deal
 * GET /v1/crm/contacts/:id/roles — list roles for a contact
 * GET /v1/crm/deals/:id/stakeholders — list contacts with roles on a deal
 * DELETE /v1/crm/contacts/:id/roles/:roleId — remove a role
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import { sql } from "drizzle-orm";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const roleIdParam = z.object({ id: z.string().uuid(), roleId: z.string().uuid() });

const VALID_ROLES = ["decision_maker", "influencer", "champion", "end_user", "approver", "technical"] as const;

const createRoleBody = z.object({
  dealId: z.string().uuid(),
  role: z.enum(VALID_ROLES),
});

export async function rolesRoutes(app: FastifyInstance): Promise<void> {
  /** Assign a role to a contact on a deal */
  app.post("/v1/crm/contacts/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: contactId } = idParam.parse(req.params);
    const body = createRoleBody.parse(req.body);

    const roleId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.contact_roles (id, tenant_id, contact_id, deal_id, role, created_by)
        VALUES (${roleId}, ${ctx.tenantId}, ${contactId}, ${body.dealId}, ${body.role}, ${ctx.actorId})
      `);
    });

    return reply.code(201).send({
      data: { id: roleId, contactId, dealId: body.dealId, role: body.role },
    });
  });

  /** List all roles for a contact */
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

  /** List stakeholders (contacts with roles) on a deal */
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

  /** Remove a role assignment */
  app.delete("/v1/crm/contacts/:id/roles/:roleId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id: contactId, roleId } = roleIdParam.parse(req.params);

    const result = await db.transaction(async (tx) => {
      return tx.execute(sql`
        DELETE FROM crm.contact_roles
        WHERE id = ${roleId} AND contact_id = ${contactId} AND tenant_id = ${ctx.tenantId}
        RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
    });

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "role assignment not found");
    }

    return reply.code(204).send();
  });
}
