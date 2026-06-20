import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { geoTagBody, photoUploadBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "field_engineer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer"];

export async function geoRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects/:id/geo-tags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = geoTagBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.geoTag(ctx, id, body));
  });

  app.post("/v1/projects/:id/site-photos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = photoUploadBody.parse(req.body);
    return reply.send(await commands.requestPhotoUpload(ctx, id, body));
  });

  app.get("/v1/projects/:id/geo-tags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await queries.getGeoTags(id, ctx.tenantId));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
