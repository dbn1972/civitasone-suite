/**
 * Service Recovery — CQRS routes (202 Accepted for mutations).
 *
 * Roles:
 *  - helpdesk_admin: manage recovery policies
 *  - helpdesk_agent: create recovery actions for tickets
 *  - helpdesk_manager: approve/reject recovery actions
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  createPolicyBody,
  createActionBody,
  approveRejectBody,
  idParam,
  ticketIdParam,
  listQuery,
} from "./validators.js";

const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];
const AGENT_ROLES = ["helpdesk_agent", "helpdesk_admin", "helpdesk_manager", "super_admin", "admin"];
const MANAGER_ROLES = ["helpdesk_manager", "helpdesk_admin", "super_admin", "admin"];

export async function recoveryRoutes(app: FastifyInstance): Promise<void> {
  // --- Policy routes ---

  app.get("/v1/helpdesk/recovery-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const query = listQuery.parse(req.query);
    const { rows, total } = await queries.listPolicies(ctx.tenantId, query.limit, query.offset);
    return reply.send({
      data: rows.map(serializePolicy),
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
    });
  });

  app.post("/v1/helpdesk/recovery-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createPolicyBody.parse(req.body);
    const result = await commands.createPolicy(ctx, {
      severityThreshold: body.severityThreshold,
      productCode: body.productCode ?? null,
      maxGoodwillMinor: body.maxGoodwillMinor,
      currency: body.currency,
      requiresApproval: body.requiresApproval,
      approverRole: body.approverRole,
      active: body.active,
    });
    return reply.code(202).send(result);
  });

  // --- Action routes ---

  app.get("/v1/helpdesk/tickets/:ticketId/recovery-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const { ticketId } = ticketIdParam.parse(req.params);
    const query = listQuery.parse(req.query);
    const { rows, total } = await queries.listActionsByTicket(ctx.tenantId, ticketId, query.limit, query.offset);
    return reply.send({
      data: rows.map(serializeAction),
      meta: { page: Math.floor(query.offset / query.limit) + 1, pageSize: query.limit, total },
    });
  });

  app.post("/v1/helpdesk/tickets/:ticketId/recovery-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const { ticketId } = ticketIdParam.parse(req.params);
    const body = createActionBody.parse(req.body);
    const result = await commands.createAction(ctx, ticketId, {
      policyId: body.policyId,
      actionType: body.actionType,
      amountMinor: body.amountMinor ?? null,
      currency: body.currency,
      reason: body.reason,
    });
    return reply.code(202).send(result);
  });

  app.post("/v1/helpdesk/recovery-actions/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MANAGER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveRejectBody.parse(req.body ?? {});
    const result = await commands.approveAction(ctx, id, body.reason);
    return reply.code(202).send(result);
  });

  app.post("/v1/helpdesk/recovery-actions/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MANAGER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveRejectBody.parse(req.body ?? {});
    const result = await commands.rejectAction(ctx, id, body.reason);
    return reply.code(202).send(result);
  });
}

// --- Serialization helpers (bigint → string for JSON) ---

function serializePolicy(row: Record<string, unknown>) {
  return {
    ...row,
    maxGoodwillMinor: String(row.maxGoodwillMinor),
  };
}

function serializeAction(row: Record<string, unknown>) {
  return {
    ...row,
    amountMinor: row.amountMinor != null ? String(row.amountMinor) : null,
  };
}
