import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createDefinitionBody, serviceKeyQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];
const ADMIN_ROLES   = ["citizen_admin", "super_admin"];

export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  // --- Authoring / maker-checker versioned publish ---------------------------
  app.post("/v1/citizen/catalogue/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createDefinitionBody.parse(req.body);
    return reply.code(201).send(await commands.createDefinition(ctx, body));
  });

  app.post("/v1/citizen/catalogue/services/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.submitDefinition(ctx, id));
  });

  app.post("/v1/citizen/catalogue/services/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.publishDefinition(ctx, id));
  });

  app.get("/v1/citizen/catalogue/services", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listDefinitions(ctx.tenantId) });
  });

  // --- Citizen-facing browse + detail (published only) -----------------------
  app.get("/v1/citizen/catalogue/published", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    return reply.send({ data: await queries.browsePublished(ctx.tenantId) });
  });

  app.get("/v1/citizen/catalogue/published/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { serviceKey } = serviceKeyQuery.parse(req.query);
    const def = await queries.getPublishedByKey(ctx.tenantId, serviceKey);
    if (!def) throw new HttpError(404, "NOT_FOUND", "no published definition for service key");
    return reply.send(def);
  });

  app.get("/v1/citizen/catalogue/services/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const def = await queries.getDefinition(ctx.tenantId, id);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    return reply.send(def);
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
