import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { grantBody, closeBody, grantIdParam, listQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

// Break-glass is the most sensitive identity operation: only the highest
// authority roles may open or close one.
const BG_ADMIN = ["platform_admin", "super_admin"];
const BG_READ = ["platform_admin", "super_admin", "tenant_admin"];

export async function breakGlassRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/break-glass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BG_ADMIN);
    const body = grantBody.parse(req.body);
    const result = await commands.grant(ctx, body);
    return reply.code(201).send(result);
  });

  app.get("/identity/break-glass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BG_READ);
    const q = listQuery.parse(req.query);
    return reply.send(await queries.listGrants(ctx.tenantId, q.status, q.limit, q.offset));
  });

  app.get("/identity/break-glass/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BG_READ);
    const { id } = grantIdParam.parse(req.params);
    const view = await queries.getGrant(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "break-glass grant not found");
    return reply.send(view);
  });

  // Close — idempotent.
  app.post("/identity/break-glass/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BG_ADMIN);
    const { id } = grantIdParam.parse(req.params);
    const body = closeBody.parse(req.body ?? {});
    return reply.send(await commands.close(ctx, id, body.reason));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
