/**
 * Teams, queues, ownership transfer, and workload routes (AS-002 + AS-003).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { sql } from "drizzle-orm";
import * as commands from "./commands.js";

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
  // AS-003: on_leave excludes the agent from assignment independently of the
  // manual `available` switch (e.g. HRMS-driven leave). Engine exclusion already
  // reads the column; this makes it settable.
  onLeave: z.boolean().optional(),
}).refine((b) => b.maxLeads !== undefined || b.available !== undefined || b.onLeave !== undefined, {
  message: "at least one of maxLeads, available or onLeave is required",
});

export async function teamRoutes(app: FastifyInstance): Promise<void> {
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

  app.post("/v1/crm/teams", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createTeamBody.parse(req.body);
    const teamId = commandId(ctx, COMMANDS.createTeam);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createTeam(ctx, teamId, body),
    );
  });

  app.post("/v1/crm/contacts/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);

    const msgId = commandId(ctx, `${COMMANDS.transferOwnership}:${id}`);
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

  app.patch("/v1/crm/teams/agents/:agentId/capacity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { agentId } = agentIdParam.parse(req.params);
    const body = updateCapacityBody.parse(req.body);

    // Accepting a capacity change for an agent that has no workload row would
    // answer 202 and then apply to nothing, so the caller is told up front.
    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT 1 FROM crm.agent_workload
        WHERE agent_id = ${agentId} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<unknown>;
    });
    if (existing.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "agent workload not found");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.updateAgentCapacity(ctx, agentId, body),
    );
  });
}
