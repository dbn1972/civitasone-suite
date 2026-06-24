import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { makeBarcode } from "../register/consumer.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer", "finance_officer"];
const WORKFLOW_CREATE = "workflow.instance.create";
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";
const GL_TOPIC = "finance.gl.post";
// 4-digit finance head CODES (resolved by finance via findHeadByCodeTx).
const FIXED_ASSET_CODE  = process.env.ASSET_FIXED_ASSET_CODE ?? "1200";
const IMPAIRMENT_CODE   = process.env.ASSET_IMPAIRMENT_CODE ?? "5200";
const REVAL_RESERVE_CODE = process.env.ASSET_REVAL_RESERVE_CODE ?? "3100";

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
    return reply.send({ data: await repo.listAuc(ctx.tenantId) });
  });

  app.post("/v1/assets/projects/auc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({ projectCode: z.string(), name: z.string(), wbsRef: z.string().optional(), amountMinor: z.number().int().nonnegative().default(0) }).parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertAuc(tx, {
        id, tenantId: ctx.tenantId, projectCode: body.projectCode, name: body.name,
        wbsRef: body.wbsRef ?? null, accumulatedMinor: BigInt(body.amountMinor),
        currency: "INR", status: "under_construction", assetId: null,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/projects/auc/:id/capitalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const auc = await repo.findAucById(id, ctx.tenantId);
    if (!auc || auc.status !== "under_construction") throw new HttpError(404, "NOT_FOUND", "AUC not found");
    const assetId = randomUUID();
    const code = `AUC/${auc.projectCode}`;
    await db.transaction(async (tx) => {
      await registerRepo.insertAsset(tx, {
        id: assetId, tenantId: ctx.tenantId, name: auc.name, code,
        categoryId: DEFAULT_IT_CATEGORY, assetType: "infra", barcode: makeBarcode(code),
        status: "active", acquisitionCost: auc.accumulatedMinor, salvageValue: 0n,
        usefulLifeYears: 10, depRate: "10", depMethod: "SLM", currency: "INR",
        bookValue: auc.accumulatedMinor, accumulatedDep: 0n,
        acquisitionDate: new Date().toISOString().slice(0, 10),
        poRef: null, grnRef: null, location: null, notes: `Capitalized from AUC ${auc.projectCode}`,
        projectRef: auc.projectCode, orgUnit: null, aucId: auc.id,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await repo.updateAuc(tx, id, { status: "capitalized", assetId, updatedBy: ctx.actorId });
    });
    await queue.publish(COMMANDS.depSchedule, {
      messageId: randomUUID(), type: COMMANDS.depSchedule,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id: randomUUID(), assetId, tenantId: ctx.tenantId, method: "SLM", startDate: new Date().toISOString().slice(0, 10), depBook: "company" },
    });
    await queue.publish(COMMANDS.depSchedule, {
      messageId: randomUUID(), type: COMMANDS.depSchedule,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id: randomUUID(), assetId, tenantId: ctx.tenantId, method: "WDV", startDate: new Date().toISOString().slice(0, 10), depBook: "statutory" },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: assetId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/assets/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ data: await repo.listLeases(ctx.tenantId) });
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
    await db.transaction(async (tx) => {
      await repo.insertLease(tx, {
        id: leaseId, tenantId: ctx.tenantId, leaseNo: body.leaseNo, lessorName: body.lessorName,
        rouCostMinor: BigInt(body.rouCostMinor), liabilityMinor: BigInt(body.liabilityMinor),
        leaseStart: body.leaseStart, leaseEnd: body.leaseEnd, assetId, status: "active",
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await registerRepo.insertAsset(tx, {
        id: assetId, tenantId: ctx.tenantId, name: `ROU — ${body.lessorName}`, code,
        categoryId: DEFAULT_IT_CATEGORY, assetType: "fixed", barcode: makeBarcode(code),
        status: "active", acquisitionCost: BigInt(body.rouCostMinor), salvageValue: 0n,
        usefulLifeYears: Math.max(1, Math.ceil((new Date(body.leaseEnd).getTime() - new Date(body.leaseStart).getTime()) / (365.25 * 86400000))),
        depRate: "20", depMethod: "SLM", currency: "INR", bookValue: BigInt(body.rouCostMinor), accumulatedDep: 0n,
        acquisitionDate: body.leaseStart, poRef: null, grnRef: null, location: null,
        notes: `IFRS 16 ROU lease ${body.leaseNo}`,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
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
    const amountMinor = BigInt(body.amountMinor);
    await db.transaction(async (tx) => {
      await repo.insertImpairment(tx, {
        id: evId, tenantId: ctx.tenantId, assetId: id, eventType: "impairment",
        amountMinor, bookValueBefore: before, bookValueAfter: after,
        reason: body.reason ?? null, eventDate,
        createdBy: ctx.actorId,
      });
      // P0-4: an impairment is a loss against the carrying amount, NOT depreciation.
      // The old code wrongly bumped accumulatedDep by the impairment amount —
      // accumulatedDep stays UNCHANGED; only bookValue drops.
      await registerRepo.updateAssetBookValue(tx, id, ctx.tenantId, after, asset.accumulatedDep, ctx.actorId);
      // P0-4: emit a balanced StandardJournal Dr Impairment Loss (5200) /
      // Cr Fixed Asset (1200). Deterministic id so a retried request no-ops in
      // finance instead of double-posting.
      await enqueue(tx, {
        topic: GL_TOPIC, eventType: GL_TOPIC,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          // uuidV5 so finance's uuid journal id column accepts it and a retry
          // dedupes on the PK (evId is already unique per impairment event).
          id: uuidV5(`impairment:${evId}`),
          tenantId: ctx.tenantId,
          type: "asset_impairment",
          voucherNo: `IMP/${eventDate}/${id.slice(0, 8)}`,
          postingDate: eventDate,
          lines: [
            { accountCode: IMPAIRMENT_CODE, debitMinor: amountMinor.toString(), creditMinor: "0" },
            { accountCode: FIXED_ASSET_CODE, debitMinor: "0", creditMinor: amountMinor.toString() },
          ],
        },
      });
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
    await db.transaction(async (tx) => {
      await repo.insertImpairment(tx, {
        id: evId, tenantId: ctx.tenantId, assetId: id, eventType: "revaluation",
        amountMinor: delta, bookValueBefore: before, bookValueAfter: after,
        reason: body.reason ?? null, eventDate,
        createdBy: ctx.actorId,
      });
      await registerRepo.updateAssetBookValue(tx, id, ctx.tenantId, after, asset.accumulatedDep, ctx.actorId);
      // P0-4: revaluation hits the Revaluation Reserve (equity), not P&L.
      // Upward: Dr Fixed Asset (1200) / Cr Reval Reserve (3100).
      // Downward: Dr Reval Reserve (3100) / Cr Fixed Asset (1200). Skip a no-op
      // (delta == 0) so finance never sees a zero-total journal. Deterministic id.
      if (delta > 0n) {
        const lines = isUpward
          ? [
              { accountCode: FIXED_ASSET_CODE, debitMinor: delta.toString(), creditMinor: "0" },
              { accountCode: REVAL_RESERVE_CODE, debitMinor: "0", creditMinor: delta.toString() },
            ]
          : [
              { accountCode: REVAL_RESERVE_CODE, debitMinor: delta.toString(), creditMinor: "0" },
              { accountCode: FIXED_ASSET_CODE, debitMinor: "0", creditMinor: delta.toString() },
            ];
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
          payload: {
            id: uuidV5(`revaluation:${evId}`),
            tenantId: ctx.tenantId,
            type: "asset_revaluation",
            voucherNo: `REVAL/${eventDate}/${id.slice(0, 8)}`,
            postingDate: eventDate,
            lines,
          },
        });
      }
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: evId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/assets/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ data: await repo.listLocations(ctx.tenantId) });
  });

  app.post("/v1/assets/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({ code: z.string(), name: z.string(), orgUnit: z.string().optional(), parentId: z.string().uuid().optional() }).parse(req.body);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertLocation(tx, { id, tenantId: ctx.tenantId, code: body.code, name: body.name, orgUnit: body.orgUnit ?? null, parentId: body.parentId ?? null, createdBy: ctx.actorId });
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/work-orders/:id/spare-parts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ partCode: z.string(), description: z.string().optional(), qty: z.number().int().positive().default(1), costMinor: z.number().int().nonnegative().default(0) }).parse(req.body);
    const partId = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertSparePart(tx, { id: partId, tenantId: ctx.tenantId, workOrderId: id, partCode: body.partCode, description: body.description ?? null, qty: body.qty, costMinor: BigInt(body.costMinor), createdBy: ctx.actorId });
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: partId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/request-disposal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id: assetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ disposalDate: z.string(), disposalMethod: z.string(), proceedsMinor: z.number().int().nonnegative().default(0), currency: z.string().default("INR"), notes: z.string().optional() }).parse(req.body);
    const pendingId = randomUUID();
    const wfId = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertPendingDisposal(tx, {
        id: pendingId, tenantId: ctx.tenantId, assetId,
        disposalDate: body.disposalDate, disposalMethod: body.disposalMethod,
        proceedsMinor: BigInt(body.proceedsMinor), currency: body.currency,
        notes: body.notes ?? null, workflowStatus: "pending", createdBy: ctx.actorId,
      });
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          id: wfId, tenantId: ctx.tenantId,
          name: `Asset Disposal — ${assetId.slice(0, 8)}`,
          status: "active", definitionCode: "asset_disposal",
          startNodeKey: "committee", initialTaskName: "Write-off Committee",
          version: 1, refType: "asset_disposal", refId: pendingId,
        },
      });
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: pendingId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/inter-org-transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id: assetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ fromOrg: z.string(), toOrg: z.string(), transferDate: z.string(), notes: z.string().optional() }).parse(req.body);
    const transferId = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertInterOrgTransfer(tx, {
        id: transferId, tenantId: ctx.tenantId, assetId,
        fromOrg: body.fromOrg, toOrg: body.toOrg, transferDate: body.transferDate,
        notes: body.notes ?? null, createdBy: ctx.actorId,
      });
      await registerRepo.updateAssetLocation(tx, assetId, ctx.tenantId, String(body.toOrg), ctx.actorId);
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
    await db.transaction(async (tx) => { await repo.bulkInsertAssets(tx, rows); });
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
