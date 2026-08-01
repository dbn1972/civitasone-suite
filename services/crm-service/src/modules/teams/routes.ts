/**
 * Teams, queues, ownership transfer, and workload routes (AS-002 + AS-003).
 * GET /v1/crm/teams — list teams
 * POST /v1/crm/teams — create team
 * POST /v1/crm/contacts/:id/transfer — transfer ownership
 * GET /v1/crm/teams/agents — list agents with workload
 * PATCH /v1/crm/teams/agents/:agentId/capacity — update capacity
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { sql } from "drizzle-orm";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const agentIdParam = z.object({ agentId: z.string().uuid() });

const createTeamBody = z.object({
  name: z.string().min(1).max(200),
  territory: z.record(z.unknown()).default({}),
});

const transferBody = z.object({
  toOwnerId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

const updateCapacityBody = z.object({
  maxLeads: z.number().int().min(1).max(1000).optional(),
  available: z.boolean().optional(),
}).refine((b) => b.maxLeads !== undefined || b.available !== undefined, {
  message: "at least one of maxLeads or available is required",
});

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  /** List teams for tenant */
  app.get("/v1/crm/teams", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const teams = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, name, territory, created_at as "createdAt", version
        FROM crm.teams
        WHERE tenant_id = ${ctx.tenantId}
        ORDER BY created_at DESC
      `) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ data: teams });
  });

  /** Create a new team */
  app.post("/v1/crm/teams", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createTeamBody.parse(req.body);

    const teamId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.teams (id, tenant_id, name, territory)
        VALUES (${teamId}, ${ctx.tenantId}, ${body.name}, ${JSON.stringify(body.territory)}::jsonb)
      `);
    });

    return reply.code(201).send({
      data: { id: teamId, name: body.name, territory: body.territory },
    });
  });

  /** Transfer ownership of a contact (AS-002) */
  app.post("/v1/crm/contacts/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);

    const msgId = randomUUID();
    await queue.publish(COMMANDS.transferOwnership, {
      messageId: msgId,
      type: COMMANDS.transferOwnership,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        contactId: id,
        fromOwnerId: ctx.actorId,
        toOwnerId: body.toOwnerId,
        reason: body.reason,
      },
    });

    return reply.code(202).send({
      id: msgId,
      status: "accepted",
      correlationId: ctx.correlationId,
    });
  });

  /** List agents with workload (AS-003) */
  app.get("/v1/crm/teams/agents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const agents = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, agent_id as "agentId", max_leads as "maxLeads", current_load as "currentLoad",
               available, skills, version
        FROM crm.agent_workload
        WHERE tenant_id = ${ctx.tenantId}
        ORDER BY current_load ASC
      `) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ data: agents });
  });

  /** Update agent capacity (AS-003) */
  app.patch("/v1/crm/teams/agents/:agentId/capacity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { agentId } = agentIdParam.parse(req.params);
    const body = updateCapacityBody.parse(req.body);

    const setClause = body.maxLeads !== undefined && body.available !== undefined
      ? sql`max_leads = ${body.maxLeads}, available = ${body.available}`
      : body.maxLeads !== undefined
        ? sql`max_leads = ${body.maxLeads}`
        : sql`available = ${body.available!}`;

    const result = await db.transaction(async (tx) => {
      return tx.execute(sql`
        UPDATE crm.agent_workload
        SET ${setClause}, version = version + 1
        WHERE agent_id = ${agentId} AND tenant_id = ${ctx.tenantId}
        RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
    });

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "agent workload record not found");
    }

    return reply.code(200).send({
      data: { agentId, ...body },
    });
  });
}
