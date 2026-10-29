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
 *   GET                /v1/crm/escalation-rules/recipients  (role + user pickers for the editor)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { assertEscalationRecipientExists } from "./recipients.js";
import { recipientsToVerify } from "../../shared/recipient-changes.js";
import { resolveUserNames, listDirectoryRoles, listDirectoryUsers } from "../../shared/user-directory.js";

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
type TargetKind = "queue" | "territory" | "partner" | "branch";
interface NamedRef { id: string; name: string }
export interface TargetReferences {
  assignmentRules: NamedRef[];
  assignmentRuleCount: number;
  branches: NamedRef[];
  branchCount: number;
}

/** At most this many names are echoed back per category; the counts stay exact. */
const REFERENCE_SAMPLE = 10;

/**
 * Everything that still points at a queue / territory / partner / branch: assignment
 * rules (via their criteria) and, for a territory, the branches filed under it
 * (branches.territory_id). Returns null when nothing references the target.
 */
async function findReferences(
  tenantId: string,
  targetId: string,
  kind: TargetKind,
): Promise<TargetReferences | null> {
  const ruleRows = (await scopedRead((tx) => tx.execute(sql`
    SELECT id, name, count(*) OVER ()::int AS total
    FROM crm.assignment_rules
    WHERE tenant_id = ${tenantId}
      AND criteria::text LIKE ${"%" + targetId + "%"}
    ORDER BY ordinal ASC
    LIMIT ${REFERENCE_SAMPLE}
  `))) as unknown as Array<{ id: string; name: string; total: number }>;
  const branchRows = kind === "territory"
    ? ((await scopedRead((tx) => tx.execute(sql`
        SELECT id, name, count(*) OVER ()::int AS total
        FROM crm.branches
        WHERE tenant_id = ${tenantId} AND territory_id = ${targetId}
        ORDER BY name ASC
        LIMIT ${REFERENCE_SAMPLE}
      `))) as unknown as Array<{ id: string; name: string; total: number }>)
    : [];
  if (ruleRows.length === 0 && branchRows.length === 0) return null;
  return {
    assignmentRules: ruleRows.map((r) => ({ id: r.id, name: r.name })),
    assignmentRuleCount: ruleRows[0]?.total ?? 0,
    branches: branchRows.map((r) => ({ id: r.id, name: r.name })),
    branchCount: branchRows[0]?.total ?? 0,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * GAP-CRM-ASSIGNMENT-DIRECTORY-04: the body of a 409 IN_USE refusal -- a structured
 * `references` list (names + exact counts) so the UI can say WHAT still uses the
 * target instead of a generic conflict. The route sends it with
 * `return reply.code(409).send(...)` (returning the reply from an async helper would
 * resolve to undefined and let the handler carry on and enqueue the delete).
 */
function inUseBody(req: FastifyRequest, refs: TargetReferences) {
  const parts: string[] = [];
  if (refs.assignmentRuleCount > 0) parts.push(plural(refs.assignmentRuleCount, "assignment rule", "assignment rules"));
  if (refs.branchCount > 0) parts.push(plural(refs.branchCount, "branch", "branches"));
  return {
    code: "IN_USE",
    message: `cannot delete: still referenced by ${parts.join(" and ")}. Reassign or remove those first.`,
    correlationId: (req.headers["x-correlation-id"] as string) ?? req.id,
    retryable: false,
    references: refs,
  };
}

/**
 * GAP-CRM-ESCALATION-RULES-05: refuse a duplicate lead-escalation rule (same
 * trigger + threshold + recipient) synchronously, before enqueueing the CQRS
 * command, so the admin gets an immediate 409 rather than a silently-dropped
 * async write. The unique index uq_escalation_rules_dedupe (migration 0106) is
 * the hard DB backstop; this pre-check mirrors the IN_USE guard above
 * (findReferences / inUseBody) so the UI sees a 409 it can map to a clear message. `excludeId` lets a PUT
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
    // GAP-CRM-ASSIGNMENT-RULES-05: show WHO last changed the chain. The rule row keeps
    // only the user id, so resolve a display name from identity-service (best effort:
    // an unresolved id simply has no name; the raw id is never shown as a label).
    const names = await resolveUserNames(ctx.tenantId, rules.map((r) => r.updatedBy));
    const data = rules.map((r) => {
      const updatedByName = r.updatedBy ? names.get(r.updatedBy) : undefined;
      return updatedByName ? { ...r, updatedByName } : r;
    });
    return reply.send({ data, meta: { page: 1, pageSize: data.length, total: data.length } });
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
    // UAT W6 P1: same predicate the consumer's markAccepted uses (active lead in this
    // tenant); anything else is a 404 instead of a 202 the consumer can only reject.
    if (!(await repo.isActiveLead(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "lead not found");
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
    const inUse = await findReferences(ctx.tenantId, id, "queue");
    if (inUse) return reply.code(409).send(inUseBody(req, inUse));
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
    const inUse = await findReferences(ctx.tenantId, id, "territory");
    if (inUse) return reply.code(409).send(inUseBody(req, inUse));
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
    const inUse = await findReferences(ctx.tenantId, id, "partner");
    if (inUse) return reply.code(409).send(inUseBody(req, inUse));
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
    const inUse = await findReferences(ctx.tenantId, id, "branch");
    if (inUse) return reply.code(409).send(inUseBody(req, inUse));
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTarget(ctx, COMMANDS.deleteBranch, id));
  });

  // ── Escalation rules (AS-004) ──────────────────────────────────────────────
  app.get("/v1/crm/escalation-rules", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, CRM_ROLES);
    const rows = await repo.listEscalationRuleViews(ctx.tenantId);
    return reply.send({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
  });
  // GAP-CRM-ESCALATION-RULES-01: the editor's recipient pickers. Served here (not read
  // straight from policy-/identity-service) because those list endpoints are
  // tenant_admin-only, so a crm_admin got empty pickers and typed free text. Admin
  // roles only; roles are tenant roles, users are ACTIVE users (id + display name).
  app.get(
    "/v1/crm/escalation-rules/recipients",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
      // Same directory (and same semantics: active users, active roles, fail-closed) as
      // GET /v1/crm/directory/{users,roles}; only the envelope and the admin-only gate differ.
      // `fresh`: an editor that has just added a role or user must see it, not a 60s-old list.
      const [roles, users] = await Promise.all([
        listDirectoryRoles(ctx.tenantId, { fresh: true }),
        listDirectoryUsers(ctx.tenantId, { fresh: true }),
      ]);
      return reply.send({
        data: {
          roles: roles ?? [],
          users: users?.users ?? [],
        },
        // `*Available:false` = that directory could not be read (NOT "there are none"), so the
        // editor can say so and refuse to save an unverifiable recipient.
        meta: {
          rolesAvailable: roles !== undefined,
          usersAvailable: users !== undefined,
          usersTruncated: users?.truncated ?? false,
        },
      });
    },
  );
  app.post("/v1/crm/escalation-rules", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = v.upsertEscalationRuleBody.parse(req.body);
    await assertEscalationRecipientExists(ctx.tenantId, body);
    await assertNoDuplicateEscalationRule(ctx.tenantId, body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertEscalationRule(ctx, body));
  });
  app.put("/v1/crm/escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    const body = v.upsertEscalationRuleBody.parse(req.body);
    // The editor sends the whole rule on every save, so only a recipient that is being CHANGED (or every
    // recipient of a rule being switched back ON) is re-verified. A rule whose role was retired or whose
    // manager left can still be tuned, and above all DISABLED -- same semantics as the task-escalation
    // rules (shared/recipient-changes.ts). A PUT for an id with no stored rule is a create: all verified.
    const current = await repo.getEscalationRuleRecipients(ctx.tenantId, id);
    await assertEscalationRecipientExists(
      ctx.tenantId,
      recipientsToVerify(current, { recipientRole: body.recipientRole, recipientId: body.recipientId, enabled: body.enabled ?? true }),
    );
    await assertNoDuplicateEscalationRule(ctx.tenantId, body, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateEscalationRule(ctx, id, body));
  });
  app.delete("/v1/crm/escalation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = v.idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteEscalationRule(ctx, id));
  });
}
