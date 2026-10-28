import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];
const READ = [...ADMIN, "tenant_user"];

export async function codeListRoutes(app: FastifyInstance): Promise<void> {
  // List tenant + global code lists.
  const listLists: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const data = await repo.listLists(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  };
  // GAP2-TENANT-WIRING-01: web code-lists loader calls /api/v1/tenant/code-lists
  // (gateway forwards verbatim). Alias so it resolves instead of 404.
  app.get("/v1/code-lists", listLists);
  app.get("/v1/tenant/code-lists", listLists);

  // Lookup active values for a list code (tenant-owned or global fallback).
  const listValues: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const values = await repo.lookupActiveValues(ctx.tenantId, code);
    if (values === null) throw new HttpError(404, "LIST_NOT_FOUND", "code list not found");
    return reply.send({ data: values, meta: { total: values.length } });
  };
  app.get("/v1/code-lists/:code/values", listValues);
  // GAP-TENANT-CODE-LISTS-01: alias for the web drill-down (gateway forwards
  // /api/v1/tenant/code-lists/:code/values verbatim).
  app.get("/v1/tenant/code-lists/:code/values", listValues);

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

  // Shared envelope: ZodError->400, HttpError, malformed JSON->400 MALFORMED_BODY, Fastify 4xx passthrough (was a local
  // copy that missed JSON parse errors and answered 500).
  registerSchemaErrorHandler(app, HttpError);
}

function env(ctx: { tenantId: string; actorId: string; correlationId: string }, type: string, messageId: string, payload: Record<string, unknown>) {
  return { messageId, type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload };
}
