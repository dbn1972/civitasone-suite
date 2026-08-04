import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createActivityBody, updateActivityBody, idParam, activitiesListSchema, listActivitiesQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

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

  app.patch("/v1/crm/activities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateActivityBody.parse(req.body);
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
