import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createActivityBody, updateActivityBody, idParam, activitiesListSchema, listActivitiesQuery, overdueTasksQuery, overdueTasksListSchema } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { isActiveTenantUser } from "../../shared/identity-client.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
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
    return sendAccepted(reply, acceptedResponseSchema, await commands.createActivity(ctx, body));
  });

  // Per-record timeline. subjectType+subjectId are REQUIRED: without them this used
  // to return the whole tenant's activities, which the FE embeds on every contact/
  // account page — a same-tenant leak. Now it is always scoped to one subject.
  app.get("/v1/crm/activities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listActivitiesQuery.parse(req.query);
    sendValidated(reply, activitiesListSchema, await queries.listActivities(ctx.tenantId, q.subjectType, q.subjectId, q.limit, q.offset));
  });

  // GAP-CRM-TASK-ESCALATION-06: the overdue-task alerts list. Registered as a
  // static path so it never collides with /:id routes.
  app.get("/v1/crm/activities/overdue-tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = overdueTasksQuery.parse(req.query ?? {});
    const { rows, total } = await repo.listOverdueTasks(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, overdueTasksListSchema, { data: rows, meta: { total, limit: q.limit, offset: q.offset } });
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
