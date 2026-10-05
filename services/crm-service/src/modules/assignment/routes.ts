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
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/**
 * GAP-CRM-ASSIGNMENT-DIRECTORY-04: deleting a queue / territory / partner /
 * branch that an assignment rule still points at would leave a dangling
 * reference (the rule's `criteria` JSONB carries the target id under a
 * rule-specific key, e.g. queueId/territoryId/partnerId/branchId), so a lead it
 * would have routed to is silently never assigned. The DELETE is CQRS (fire and
 * forget), so guard SYNCHRONOUSLY in the route before enqueueing: if any
 * assignment rule references this id, refuse with 409 IN_USE and the count,
 * instead of a 202 that quietly orphans rules. UUIDs are globally unique, so a
 * text search of the criteria JSON is a safe, key-agnostic reference test.
 */
async function assertNotReferencedByRules(
  tenantId: string,
  targetId: string,
): Promise<void> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT count(*)::int AS count
    FROM crm.assignment_rules
    WHERE tenant_id = ${tenantId}
      AND criteria::text LIKE ${"%" + targetId + "%"}
  `))) as unknown as Array<{ count: number }>;
  const count = rows[0]?.count ?? 0;
  if (count > 0) {
    throw new HttpError(
      409,
      "IN_USE",
      `cannot delete: still referenced by ${count} assignment rule${count === 1 ? "" : "s"}. Reassign or remove those rules first.`,
    );
  }
}

/**
 * GAP-CRM-ESCALATION-RULES-05: refuse a duplicate lead-escalation rule (same
 * trigger + threshold + recipient) synchronously, before enqueueing the CQRS
 * command, so the admin gets an immediate 409 rather than a silently-dropped
 * async write. The unique index uq_escalation_rules_dedupe (migration 0106) is
 * the hard DB backstop; this pre-check mirrors assertNotReferencedByRules above
 * so the UI sees a 409 it can map to a clear message. `excludeId` lets a PUT
 * update a rule without colliding with itself.
 */
async function assertNoDuplicateEscalationRule(
  tenantId: string,
  body: v.UpsertEscalationRuleBody,
  excludeId?: string,
): Promise<void> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT count(*)::int AS count
    FROM crm.escalation_rules
    WHERE tenant_id = ${tenantId}
      AND trigger = ${body.trigger}
      AND threshold_minutes = ${body.thresholdMinutes}
      AND COALESCE(recipient_role, '') = ${body.recipientRole ?? ""}
      AND COALESCE(recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = ${body.recipientId ?? "00000000-0000-0000-0000-000000000000"}::uuid
      AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)
  `))) as unknown as Array<{ count: number }>;
  if ((rows[0]?.count ?? 0) > 0) {
    throw new HttpError(
      409,
      "DUPLICATE_RULE",
      "a rule with the same trigger, threshold and recipient already exists",
    );
  }
}

export async function assignmentRoutes(app: FastifyInstance): Promise<void> {
  // ── Assignment rules ────────────────────────────────────────────────────────
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
    await assertNotReferencedByRules(ctx.tenantId, id);
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
    await assertNotReferencedByRules(ctx.tenantId, id);
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
    await assertNotReferencedByRules(ctx.tenantId, id);
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
    await assertNotReferencedByRules(ctx.tenantId, id);
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
    await assertNoDuplicateEscalationRule(ctx.tenantId, body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertEscalationRule(ctx, body));
  });
  app.put("/v1/crm/escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.upsertEscalationRuleBody.parse(req.body);
    await assertNoDuplicateEscalationRule(ctx.tenantId, body, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateEscalationRule(ctx, id, body));
  });
  app.delete("/v1/crm/escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteEscalationRule(ctx, id));
  });
}
