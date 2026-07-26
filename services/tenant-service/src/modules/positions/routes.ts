import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { findById as findOrgUnit } from "../org-hierarchy/repo.js";

const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];

export async function positionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/positions", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const data = await repo.listPositions(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.get("/v1/positions/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const position = await repo.findPosition(ctx.tenantId, id);
    if (!position) throw new HttpError(404, "NOT_FOUND", "Position not found");
    const roles = await repo.listRoles(ctx.tenantId, id);
    return reply.send({ data: { ...position, roles } });
  });

  app.post("/v1/positions", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      code: z.string().min(1).max(48),
      title: z.string().min(1).max(200),
      orgUnitId: z.string().uuid().optional(),
      grade: z.string().max(48).optional(),
      sanctionedStrength: z.number().int().min(0).default(1),
    }).parse(req.body);
    if (body.orgUnitId) {
      const unit = await findOrgUnit(ctx.tenantId, body.orgUnitId);
      if (!unit) throw new HttpError(404, "ORG_UNIT_NOT_FOUND", "org unit not found");
    }
    const id = randomUUID();
    await queue.publish("tenant.position.create", env(ctx, "tenant.position.create", id, { id, tenantId: ctx.tenantId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // CAP-015 — map a platform role onto a sanctioned position.
  app.post("/v1/positions/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id: positionId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ roleKey: z.string().min(1).max(64) }).parse(req.body);
    const position = await repo.findPosition(ctx.tenantId, positionId);
    if (!position) throw new HttpError(404, "POSITION_NOT_FOUND", "position not found");
    const id = randomUUID();
    await queue.publish("tenant.position_role.map", env(ctx, "tenant.position_role.map", id, { id, tenantId: ctx.tenantId, positionId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.get("/v1/positions/:id/roles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const position = await repo.findPosition(ctx.tenantId, id);
    if (!position) throw new HttpError(404, "NOT_FOUND", "Position not found");
    const roles = await repo.listRoles(ctx.tenantId, id);
    return reply.send({ data: roles, meta: { total: roles.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}

function env(ctx: { tenantId: string; actorId: string; correlationId: string }, type: string, messageId: string, payload: Record<string, unknown>) {
  return { messageId, type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload };
}
