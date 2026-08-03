import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { makeBarcode } from "../register/consumer.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer", "finance_officer"];
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";

export async function enterpriseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/assets/scan/:barcode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { barcode } = z.object({ barcode: z.string().min(1) }).parse(req.params);
    const asset = await repo.findAssetByBarcode(ctx.tenantId, barcode);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "no asset for barcode");
    return reply.send({ id: asset.id, code: asset.code, name: asset.name, barcode: asset.barcode, status: asset.status, bookValue: Number(asset.bookValue) });
  });

  app.get("/v1/assets/projects/auc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const all = await repo.listAuc(ctx.tenantId);
    return reply.send({ data: all.slice(offset, offset + limit) });
  });

  app.post("/v1/assets/projects/auc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({ projectCode: z.string(), name: z.string(), wbsRef: z.string().optional(), amountMinor: z.number().int().nonnegative().default(0) }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "auc_create", id, { projectCode: body.projectCode, name: body.name, wbsRef: body.wbsRef, amountMinor: body.amountMinor });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/projects/auc/:id/capitalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const auc = await repo.findAucById(id, ctx.tenantId);
    if (!auc || auc.status !== "under_construction") throw new HttpError(404, "NOT_FOUND", "AUC not found");
    const assetId = randomUUID();
    await publishF3Write(ctx, "auc_capitalize", assetId, {
      aucId: id,
      assetId,
      projectCode: auc.projectCode,
      name: auc.name,
      accumulatedMinor: auc.accumulatedMinor.toString(),
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: assetId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/assets/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const all = await repo.listLeases(ctx.tenantId);
    return reply.send({ data: all.slice(offset, offset + limit) });
  });

  app.post("/v1/assets/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({
      leaseNo: z.string(), lessorName: z.string(), rouCostMinor: z.number().int().positive(),
      liabilityMinor: z.number().int().positive(), leaseStart: z.string(), leaseEnd: z.string(),
    }).parse(req.body);
    const leaseId = randomUUID();
    const assetId = randomUUID();
    const code = `ROU/${body.leaseNo}`;
    await publishF3Write(ctx, "lease_create", leaseId, {
      leaseId,
      assetId,
      leaseNo: body.leaseNo,
      lessorName: body.lessorName,
      rouCostMinor: body.rouCostMinor,
      liabilityMinor: body.liabilityMinor,
      leaseStart: body.leaseStart,
      leaseEnd: body.leaseEnd,
      code,
      usefulLifeYears: Math.max(1, Math.ceil((new Date(body.leaseEnd).getTime() - new Date(body.leaseStart).getTime()) / (365.25 * 86400000))),
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: leaseId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/impairment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ amountMinor: z.number().int().positive(), reason: z.string().optional(), eventDate: z.string().optional() }).parse(req.body);
    const asset = await registerRepo.findAssetById(id, ctx.tenantId);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    const before = asset.bookValue;
    const after = before - BigInt(body.amountMinor);
    if (after < 0n) throw new HttpError(400, "INVALID", "impairment exceeds book value");
    const evId = randomUUID();
    const eventDate = body.eventDate ?? new Date().toISOString().slice(0, 10);
    await publishF3Write(ctx, "impairment", evId, {
      assetId: id,
      amountMinor: body.amountMinor,
      bookValueBefore: before.toString(),
      bookValueAfter: after.toString(),
      accumulatedDep: asset.accumulatedDep.toString(),
      reason: body.reason,
      eventDate,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: evId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/revaluation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ newBookValueMinor: z.number().int().positive(), reason: z.string().optional() }).parse(req.body);
    const asset = await registerRepo.findAssetById(id, ctx.tenantId);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    const before = asset.bookValue;
    const after = BigInt(body.newBookValueMinor);
    const isUpward = after > before;
    const delta = isUpward ? after - before : before - after;
    const evId = randomUUID();
    const eventDate = new Date().toISOString().slice(0, 10);
    await publishF3Write(ctx, "revaluation", evId, {
      assetId: id,
      bookValueBefore: before.toString(),
      bookValueAfter: after.toString(),
      delta: delta.toString(),
      isUpward,
      accumulatedDep: asset.accumulatedDep.toString(),
      reason: body.reason,
      eventDate,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: evId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/assets/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const all = await repo.listLocations(ctx.tenantId);
    return reply.send({ data: all.slice(offset, offset + limit) });
  });

  app.post("/v1/assets/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({ code: z.string(), name: z.string(), orgUnit: z.string().optional(), parentId: z.string().uuid().optional() }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "location_create", id, { code: body.code, name: body.name, orgUnit: body.orgUnit, parentId: body.parentId });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/work-orders/:id/spare-parts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ partCode: z.string(), description: z.string().optional(), qty: z.number().int().positive().default(1), costMinor: z.number().int().nonnegative().default(0) }).parse(req.body);
    const partId = randomUUID();
    await publishF3Write(ctx, "spare_part", partId, { workOrderId: id, partCode: body.partCode, description: body.description, qty: body.qty, costMinor: body.costMinor });
    return sendAccepted(reply, acceptedResponseSchema, { id: partId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/request-disposal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id: assetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ disposalDate: z.string(), disposalMethod: z.string(), proceedsMinor: z.number().int().nonnegative().default(0), currency: z.string().default("INR"), notes: z.string().optional() }).parse(req.body);
    const pendingId = randomUUID();
    const wfId = randomUUID();
    await publishF3Write(ctx, "request_disposal", pendingId, {
      assetId,
      disposalDate: body.disposalDate,
      disposalMethod: body.disposalMethod,
      proceedsMinor: body.proceedsMinor,
      currency: body.currency,
      notes: body.notes,
      wfId,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: pendingId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/inter-org-transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id: assetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ fromOrg: z.string(), toOrg: z.string(), transferDate: z.string(), notes: z.string().optional() }).parse(req.body);
    const transferId = randomUUID();
    await publishF3Write(ctx, "inter_org_transfer", transferId, {
      assetId,
      fromOrg: body.fromOrg,
      toOrg: body.toOrg,
      transferDate: body.transferDate,
      notes: body.notes,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: transferId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/bulk/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({
      assets: z.array(z.object({
        name: z.string(), code: z.string(), assetType: z.string().default("fixed"),
        acquisitionCostMinor: z.number().int().nonnegative(), orgUnit: z.string().optional(),
      })).min(1).max(500),
    }).parse(req.body);
    const batchId = randomUUID();
    const rows = body.assets.map((a) => ({
      id: randomUUID(), tenantId: ctx.tenantId, name: a.name, code: a.code,
      categoryId: DEFAULT_IT_CATEGORY, assetType: a.assetType, barcode: makeBarcode(a.code),
      status: "active" as const, acquisitionCost: BigInt(a.acquisitionCostMinor), salvageValue: 0n,
      usefulLifeYears: 5, depRate: "20", depMethod: "SLM" as const, currency: "INR" as const,
      bookValue: BigInt(a.acquisitionCostMinor), accumulatedDep: 0n,
      acquisitionDate: new Date().toISOString().slice(0, 10),
      poRef: null, grnRef: null, location: null, notes: `bulk:${batchId}`,
      orgUnit: a.orgUnit ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    await publishF3Write(ctx, "bulk_import", batchId, { rows });
    return sendAccepted(reply, acceptedResponseSchema, { id: batchId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
