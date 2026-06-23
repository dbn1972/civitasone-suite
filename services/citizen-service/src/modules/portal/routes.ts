import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, resolvePublicContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, tenantQuery, createProfileBody, deleteProfileBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/profiles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createProfileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createProfile(ctx, body));
  });

  /** DPDP §12: right to erasure — citizen requests deletion of their profile and PII */
  app.delete("/v1/citizen/profiles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = deleteProfileBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteProfile(ctx, id, body));
  });

  app.get("/v1/citizen/services", { config: { public: true } }, async (req, reply) => {
    const { tenantId } = tenantQuery.parse(req.query);
    resolvePublicContext(req, tenantId);
    return reply.send(await queries.listServices(tenantId));
  });

  app.get("/v1/citizen/services/:id", { config: { public: true } }, async (req, reply) => {
    const { tenantId } = tenantQuery.parse(req.query);
    resolvePublicContext(req, tenantId);
    const { id } = idParam.parse(req.params);
    const service = await queries.getService(tenantId, id);
    if (!service) throw new HttpError(404, "NOT_FOUND", "service not found");
    return reply.send(service);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
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
