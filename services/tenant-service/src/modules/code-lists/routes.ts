import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];
const READ = [...ADMIN, "tenant_user"];

export async function codeListRoutes(app: FastifyInstance): Promise<void> {
  // List tenant + global code lists.
  app.get("/v1/code-lists", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const data = await repo.listLists(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  // Lookup active values for a list code (tenant-owned or global fallback).
  app.get("/v1/code-lists/:code/values", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const values = await repo.lookupActiveValues(ctx.tenantId, code);
    if (values === null) throw new HttpError(404, "LIST_NOT_FOUND", "code list not found");
    return reply.send({ data: values, meta: { total: values.length } });
  });

  // Create a tenant-scoped code list.
  app.post("/v1/code-lists", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ code: z.string().min(1).max(64), name: z.string().min(1).max(200), description: z.string().max(2000).optional() }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.code_list.create", env(ctx, "tenant.code_list.create", id, { id, tenantId: ctx.tenantId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // Add a value to a list (resolved by code).
  app.post("/v1/code-lists/:code/values", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({ code: z.string().min(1).max(64), label: z.string().min(1).max(200), sortOrder: z.number().int().optional(), metadata: z.record(z.unknown()).optional() }).parse(req.body);
    const list = await repo.resolveList(ctx.tenantId, code);
    if (!list) throw new HttpError(404, "LIST_NOT_FOUND", "code list not found");
    if (list.tenantId === null) throw new HttpError(409, "GLOBAL_LIST_READONLY", "cannot add values to a platform-global list");
    const id = randomUUID();
    await queue.publish("tenant.code_value.add", env(ctx, "tenant.code_value.add", id, { id, tenantId: ctx.tenantId, listId: list.id, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // Supersede a value (effective-dated version bump).
  app.patch("/v1/code-lists/:code/values/:valueCode/supersede", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { code, valueCode } = z.object({ code: z.string().min(1).max(64), valueCode: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({ label: z.string().min(1).max(200), sortOrder: z.number().int().optional() }).parse(req.body);
    const list = await repo.resolveList(ctx.tenantId, code);
    if (!list || list.tenantId === null) throw new HttpError(404, "LIST_NOT_FOUND", "tenant code list not found");
    await queue.publish("tenant.code_value.supersede", env(ctx, "tenant.code_value.supersede", randomUUID(), { tenantId: ctx.tenantId, listId: list.id, code: valueCode, ...body }));
    return reply.code(202).send({ data: { status: "accepted" } });
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
