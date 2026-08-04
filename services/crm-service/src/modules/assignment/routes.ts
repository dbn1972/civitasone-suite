/**
 * Lead assignment & escalation routes (AS-001..004).
 *
 * Admin config (rules, queues, territories, partners, branches, escalation
 * rules) is CQRS: validate → publish → 202, applied by assignment/consumer.ts.
 * Reads (GET) are synchronous through RLS-scoped queries.
 *
 *   GET/POST/PUT/DELETE /v1/crm/assignment-rules[/:id]
 *   POST               /v1/crm/leads/:id/assign        { ownerId? | runRules:true }
 *   POST               /v1/crm/leads/:id/accept
 *   GET                /v1/crm/leads/:id/assignment-log  (AS-002 unified history)
 *   GET/POST/PUT/DELETE /v1/crm/assignment-queues[/:id]
 *   GET/POST/PUT/DELETE /v1/crm/territories[/:id]
 *   GET/POST/PUT/DELETE /v1/crm/partners[/:id]
 *   GET/POST/PUT/DELETE /v1/crm/branches[/:id]
 *   GET/POST/PUT/DELETE /v1/crm/escalation-rules[/:id]
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

export async function assignmentRoutes(app: FastifyInstance): Promise<void> {
  // ── Assignment rules ───────────────────────────────────────────────────────
  app.get("/v1/crm/assignment-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const rules = await repo.listRuleViews(ctx.tenantId);
    return reply.send({ data: rules, meta: { page: 1, pageSize: rules.length, total: rules.length } });
  });

  app.post("/v1/crm/assignment-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = v.createAssignmentRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAssignmentRule(ctx, body));
  });

  app.put("/v1/crm/assignment-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.updateAssignmentRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateAssignmentRule(ctx, id, body));
  });

  app.delete("/v1/crm/assignment-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteAssignmentRule(ctx, id));
  });

  // ── Manual assign / accept ─────────────────────────────────────────────────
  app.post("/v1/crm/leads/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.assignLeadBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignLeadManual(ctx, id, body));
  });

  app.post("/v1/crm/leads/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.acceptLead(ctx, id));
  });

  app.get("/v1/crm/leads/:id/assignment-log", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = v.idParam.parse(req.params);
    const rows = await repo.listAssignmentLog(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  // ── Assignment targets (AS-002) ────────────────────────────────────────────
  app.get("/v1/crm/assignment-queues", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, CRM_ROLES);
    return reply.send({ data: await repo.listTargets(ctx.tenantId, "assignment_queues") });
  });
  app.post("/v1/crm/assignment-queues", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = v.createQueueBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTarget(ctx, COMMANDS.createAssignmentQueue, body));
  });
  app.put("/v1/crm/assignment-queues/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.updateQueueBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTarget(ctx, COMMANDS.updateAssignmentQueue, id, body));
  });
  app.delete("/v1/crm/assignment-queues/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTarget(ctx, COMMANDS.deleteAssignmentQueue, id));
  });

  app.get("/v1/crm/territories", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, CRM_ROLES);
    return reply.send({ data: await repo.listTargets(ctx.tenantId, "territories") });
  });
  app.post("/v1/crm/territories", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = v.createTerritoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTarget(ctx, COMMANDS.createTerritory, body));
  });
  app.put("/v1/crm/territories/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.updateTerritoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTarget(ctx, COMMANDS.updateTerritory, id, body));
  });
  app.delete("/v1/crm/territories/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTarget(ctx, COMMANDS.deleteTerritory, id));
  });

  app.get("/v1/crm/partners", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, CRM_ROLES);
    return reply.send({ data: await repo.listTargets(ctx.tenantId, "partners") });
  });
  app.post("/v1/crm/partners", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = v.createPartnerBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTarget(ctx, COMMANDS.createPartner, body));
  });
  app.put("/v1/crm/partners/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.updatePartnerBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTarget(ctx, COMMANDS.updatePartner, id, body));
  });
  app.delete("/v1/crm/partners/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTarget(ctx, COMMANDS.deletePartner, id));
  });

  app.get("/v1/crm/branches", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, CRM_ROLES);
    return reply.send({ data: await repo.listTargets(ctx.tenantId, "branches") });
  });
  app.post("/v1/crm/branches", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = v.createBranchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTarget(ctx, COMMANDS.createBranch, body));
  });
  app.put("/v1/crm/branches/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.updateBranchBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTarget(ctx, COMMANDS.updateBranch, id, body));
  });
  app.delete("/v1/crm/branches/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTarget(ctx, COMMANDS.deleteBranch, id));
  });

  // ── Escalation rules (AS-004) ──────────────────────────────────────────────
  app.get("/v1/crm/escalation-rules", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, CRM_ROLES);
    const rows = await repo.listEscalationRuleViews(ctx.tenantId);
    return reply.send({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
  });
  app.post("/v1/crm/escalation-rules", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = v.upsertEscalationRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertEscalationRule(ctx, body));
  });
  app.put("/v1/crm/escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.upsertEscalationRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateEscalationRule(ctx, id, body));
  });
  app.delete("/v1/crm/escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteEscalationRule(ctx, id));
  });
}
