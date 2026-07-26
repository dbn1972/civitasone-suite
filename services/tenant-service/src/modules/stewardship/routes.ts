import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];
const CLASS = ["public", "internal", "confidential", "restricted"] as const;

export async function stewardshipRoutes(app: FastifyInstance): Promise<void> {
  // ── data domains ──────────────────────────────────────────────────
  app.get("/v1/data-governance/domains", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const data = await repo.listDomains(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.get("/v1/data-governance/domains/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const domain = await repo.findDomain(ctx.tenantId, id);
    if (!domain) throw new HttpError(404, "NOT_FOUND", "Data domain not found");
    const [stewards, assets] = await Promise.all([
      repo.listStewards(ctx.tenantId, id),
      repo.listAssets(ctx.tenantId, id),
    ]);
    return reply.send({ data: { ...domain, stewards, assets } });
  });

  app.post("/v1/data-governance/domains", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      code: z.string().min(1).max(48),
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      ownerOffice: z.string().min(1).max(160),
      ownerRole: z.string().min(1).max(80),
      classification: z.enum(CLASS).default("internal"),
    }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.data_domain.create", envelope(ctx, "tenant.data_domain.create", id, { id, tenantId: ctx.tenantId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // ── steward assignments ───────────────────────────────────────────
  app.post("/v1/data-governance/domains/:id/stewards", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id: domainId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ stewardUserId: z.string().uuid(), role: z.enum(["owner", "steward", "custodian"]).default("steward") }).parse(req.body);
    const domain = await repo.findDomain(ctx.tenantId, domainId);
    if (!domain) throw new HttpError(404, "DOMAIN_NOT_FOUND", "data domain not found");
    const id = randomUUID();
    await queue.publish("tenant.data_steward.assign", envelope(ctx, "tenant.data_steward.assign", id, { id, tenantId: ctx.tenantId, domainId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // ── data assets catalogue ─────────────────────────────────────────
  app.get("/v1/data-governance/assets", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { domainId } = z.object({ domainId: z.string().uuid().optional() }).parse(req.query);
    const data = await repo.listAssets(ctx.tenantId, domainId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.post("/v1/data-governance/assets", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      domainId: z.string().uuid(),
      name: z.string().min(1).max(200),
      assetType: z.string().min(1).max(48),
      classification: z.enum(CLASS).default("internal"),
      systemOfRecord: z.string().max(120).optional(),
    }).parse(req.body);
    const domain = await repo.findDomain(ctx.tenantId, body.domainId);
    if (!domain) throw new HttpError(404, "DOMAIN_NOT_FOUND", "data domain not found");
    const id = randomUUID();
    await queue.publish("tenant.data_asset.register", envelope(ctx, "tenant.data_asset.register", id, { id, tenantId: ctx.tenantId, ...body }));
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}

function envelope(ctx: { tenantId: string; actorId: string; correlationId: string }, type: string, messageId: string, payload: Record<string, unknown>) {
  return { messageId, type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload };
}
