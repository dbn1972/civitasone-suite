import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createActivityBody, updateActivityBody, idParam, activitiesListSchema, listActivitiesQuery, activityFeedQuery, activityFeedListSchema, overdueTasksQuery, overdueTasksListSchema } from "./validators.js";
import * as repo from "./repo.js";
import { assertAccountLinkable } from "../contacts/account-guard.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { isActiveTenantUser } from "../../shared/identity-client.js";
import { resolveUserNames } from "../../shared/user-directory.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
// Tenant-wide feed visibility (CRM admin tier; crm_user is scoped to own + team-member records).
const FEED_ADMIN_ROLES = ["crm_admin", "super_admin"];
// GAP-CRM-TASK-ESCALATION-03: the overdue-task monitor is also open to tenant_admin. The web
// CRM layout already admits tenant_admin to /crm/overdue-tasks, and the sibling escalation-rule
// and service-request reads list it, so without this the page loaded and then failed on 403.
const OVERDUE_READ_ROLES = [...CRM_ROLES, "tenant_admin"];
// Who may reassign a task they do not own (crm-service has no separate manager role: the
// admin tier is the same one that manages assignment/escalation rules).
const TASK_MANAGER_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

/**
 * Reassign guard: only the task's current owner or a manager/admin may hand it over, and the new
 * owner must be an ACTIVE user of the caller's tenant (identity-service is the source of truth).
 */
async function assertMayReassign(ctx: ReturnType<typeof resolveContext>, id: string, newOwnerId: string): Promise<void> {
  const task = await repo.findOwner(ctx.tenantId, id);
  if (!task) throw new HttpError(404, "NOT_FOUND", "activity not found");
  const isManager = hasAnyRole(ctx, TASK_MANAGER_ROLES);
  if (!isManager && task.ownerId !== ctx.actorId) {
    throw new HttpError(403, "FORBIDDEN", "only the task owner or a manager can reassign this task");
  }
  const active = await isActiveTenantUser(ctx.tenantId, newOwnerId);
  if (active === undefined) throw new HttpError(503, "IDENTITY_UNAVAILABLE", "could not verify the new owner; try again");
  if (!active) throw new HttpError(422, "INVALID_OWNER", "ownerId must be an active user in this tenant");
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/activities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createActivityBody.parse(req.body);
    // F5: a merged / inactive / unknown account is a synchronous 422, not a 202 the consumer drops.
    await assertAccountLinkable(ctx.tenantId, body.accountId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createActivity(ctx, body));
  });

  // Per-record timeline (subjectType+subjectId given) OR the scoped feed (neither given).
  // The timeline is always scoped to one subject; the feed is scoped to the caller: crm_user sees
  // activities they own/are assigned or that belong to records they own, crm_admin/super_admin
  // see the tenant. Supplying only one of subjectType/subjectId is still a 400 (never a leak).
  app.get("/v1/crm/activities", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const raw = (req.query ?? {}) as Record<string, unknown>;
    if (raw["subjectType"] === undefined && raw["subjectId"] === undefined) {
      const fq = activityFeedQuery.parse(raw);
      return sendValidated(reply, activityFeedListSchema, await queries.listFeed(ctx.tenantId, ctx.actorId, hasAnyRole(ctx, FEED_ADMIN_ROLES), fq));
    }
    const q = listActivitiesQuery.parse(raw);
    sendValidated(reply, activitiesListSchema, await queries.listActivities(ctx.tenantId, q.subjectType, q.subjectId, q.limit, q.offset));
  });

  // GAP-CRM-TASK-ESCALATION-06: the overdue-task alerts list. Registered as a
  // static path so it never collides with /:id routes.
  app.get("/v1/crm/activities/overdue-tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OVERDUE_READ_ROLES);
    const q = overdueTasksQuery.parse(req.query ?? {});
    const { rows, total } = await repo.listOverdueTasks(ctx.tenantId, q.limit, q.offset, q.minAgeMinutes);
    // GAP-CRM-TASK-ESCALATION-02: owner ids -> display names for every viewer (fail-open).
    const names = await resolveUserNames(ctx.tenantId, rows.map((r) => r["ownerId"] as string));
    const data = rows.map((r) => ({ ...r, ownerName: names.get(r["ownerId"] as string) ?? null }));
    sendValidated(reply, overdueTasksListSchema, { data, meta: { total, limit: q.limit, offset: q.offset } });
  });

  app.patch("/v1/crm/activities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateActivityBody.parse(req.body);
    if (body.ownerId !== undefined) await assertMayReassign(ctx, id, body.ownerId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateActivity(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
