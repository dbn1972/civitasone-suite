import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { createAssetBody, assetQueryParams, idParam, tagBarcodeBody, createCategoryBody, updateCategoryBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const ASSET_ROLES  = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer"];

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Gateway upstreamPath "/v1/assets" + loader prefix "/assets" → service sees "/v1/assets/assets"
  // ── Category master data ────────────────────────────────────────────────
  app.post("/v1/assets/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin"]);
    const body = createCategoryBody.parse(req.body);
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertCategory(tx, {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        code: body.code,
        depMethod: body.depMethod as "SLM" | "WDV",
        depRate: String(body.depRate),
        usefulLifeYears: body.usefulLifeYears,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    });
    return reply.code(201).send({ id });
  });

  app.get("/v1/assets/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_manager", "asset_admin", "super_admin", "audit_officer"]);
    const categories = await repo.findCategoriesByTenant(ctx.tenantId);
    return reply.send({ data: categories });
  });

  app.patch("/v1/assets/categories/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin"]);
    const { id } = idParam.parse(req.params);
    const body = updateCategoryBody.parse(req.body);
    const existing = await repo.findCategoryById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "category not found");
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.code !== undefined) patch.code = body.code;
    if (body.depMethod !== undefined) patch.depMethod = body.depMethod;
    if (body.depRate !== undefined) patch.depRate = String(body.depRate);
    if (body.usefulLifeYears !== undefined) patch.usefulLifeYears = body.usefulLifeYears;
    await repo.updateCategory(id, ctx.tenantId, patch, ctx.actorId);
    return reply.send({ id });
  });

  app.post("/v1/assets/assets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = createAssetBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAsset(ctx, body));
  });

  app.get("/v1/assets/assets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const asset = await queries.getAsset(ctx.tenantId, id);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    return reply.send(asset);
  });

  // Alias: /v1/assets/register → same as /v1/assets/assets (UAT compat)
  app.get("/v1/assets/register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = assetQueryParams.parse(req.query);
    const opts: { category?: string; status?: string; type?: string; search?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.category !== undefined) opts.category = q.category;
    if (q.status !== undefined) opts.status = q.status;
    if (q.type !== undefined) opts.type = q.type;
    if (q.search !== undefined) opts.search = q.search;
    const assets = await queries.listAssets(ctx.tenantId, opts);
    return reply.send({ data: assets, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/assets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = assetQueryParams.parse(req.query);
    const opts: { category?: string; status?: string; type?: string; search?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.category !== undefined) opts.category = q.category;
    if (q.status !== undefined) opts.status = q.status;
    if (q.type !== undefined) opts.type = q.type;
    if (q.search !== undefined) opts.search = q.search;
    const assets = await queries.listAssets(ctx.tenantId, opts);
    return reply.send({ data: assets, limit: q.limit, offset: q.offset });
  });

  app.patch("/v1/assets/assets/:id/barcode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = idParam.parse(req.params);
    const body = tagBarcodeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.tagBarcode(ctx, id, body.barcode));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
