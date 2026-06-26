import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { grantBody, closeBody, grantIdParam, listQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";

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

    // SEC REM-07: enforce a hard TTL cap at the route level in addition to the
    // DB-level expiresAt. If the grant is still "active" but has exceeded
    // MAX_BREAKGLASS_TTL_SECONDS since it was opened, auto-close it transactionally
    // and emit an audit event before rejecting the request.
    const MAX_BREAKGLASS_TTL_MS = Number(process.env.BREAKGLASS_MAX_TTL_SECONDS ?? 3600) * 1000;
    if (!view.closedAt && view.status === "active" && Date.now() - new Date(view.grantedAt).getTime() > MAX_BREAKGLASS_TTL_MS) {
      await db.transaction(async (tx) => {
        const row = await repo.findByIdForUpdate(tx, ctx.tenantId, id);
        // Only act if the row is still active (guard against concurrent close)
        if (row && row.status === "active") {
          await repo.setStatus(tx, ctx.tenantId, id, row.version, {
            status: "expired", closedBy: ctx.actorId, closeReason: "auto_expired", closedAt: new Date(),
          });
          await repo.emitAudit(tx, {
            eventType: "identity.breakglass.auto_expired",
            tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
            action: "breakglass_auto_expire", resourceId: id, severity: "critical",
            payload: { service: "identity", action: "breakglass_auto_expire", resourceType: "breakglass", resourceId: id, outcome: "expired" },
          });
        }
      });
      return reply.code(403).send({ code: "BREAKGLASS_EXPIRED", message: "Break-glass session has expired and was automatically closed." });
    }

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
