/**
 * sync module — HTTP routes (Fastify plugin `registerSyncRoutes`, 7 endpoints).
 *
 * Follows the suite CQRS + envelope conventions:
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *   • READS  — cache-first `repo.*` lookups
 *
 * RBAC: all sync operations require `inspector` role (or admin overrides).
 *
 * Endpoints (7):
 *   POST /v1/inspection/sync/packages             — request offline package generation
 *   GET  /v1/inspection/sync/packages/:id         — get package status/download info
 *   POST /v1/inspection/sync/upload               — submit offline-completed data
 *   GET  /v1/inspection/sync/status/:inspectorId  — get sync status for inspector
 *   POST /v1/inspection/sync/upload/chunked       — chunked upload for large evidence (SVC-102)
 *   POST /v1/inspection/sync/responses/partial    — save partial checklist responses (SVC-102)
 *   GET  /v1/inspection/sync/packages/:id/manifest — lightweight manifest (SVC-102)
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishSyncPackageGenerate,
  publishSyncUpload,
} from "./commands.js";
import {
  findPackageById,
  findCursorsByInspector,
} from "./repo.js";

// ─── RBAC role groups ────────────────────────────────────────────────────────

/** Sync operations: inspectors, inspection admins, and super admins. */
const SYNC_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** POST /v1/inspection/sync/packages — generate offline bundle (Req 6.1). */
const generatePackageSchema = z.object({
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
  inspectionIds: z.array(z.string().uuid()).optional(),
  includeMapTiles: z.boolean().optional(),
});

/** POST /v1/inspection/sync/upload — submit offline data (Req 6.2). */
const syncUploadSchema = z.object({
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  deviceId: z.string().min(1, "deviceId is required"),
  sequenceNumber: z.number().int().positive("sequenceNumber must be a positive integer"),
  payload: z.object({
    responses: z.record(z.object({
      value: z.unknown(),
      answeredAt: z.string().min(1),
    })),
    evidence: z.array(z.object({
      evidenceId: z.string().min(1),
      sha256: z.string().min(1),
    })),
  }),
  sha256Hash: z.string().min(1, "sha256Hash is required"),
  networkState: z.enum(["online", "offline"]),
});

/** POST /v1/inspection/sync/upload/chunked — chunked evidence upload (SVC-102). */
const chunkedUploadSchema = z.object({
  evidenceId: z.string().uuid("evidenceId must be a valid UUID"),
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  deviceId: z.string().min(1, "deviceId is required"),
  totalSizeBytes: z.number().int().positive("totalSizeBytes must be positive"),
  sha256: z.string().min(1, "sha256 is required"),
  mimeType: z.string().min(1, "mimeType is required"),
  chunkIndex: z.number().int().nonnegative("chunkIndex must be non-negative"),
  totalChunks: z.number().int().positive("totalChunks must be positive"),
  capturedAt: z.string().min(1, "capturedAt is required"),
  gpsLatitude: z.number().optional(),
  gpsLongitude: z.number().optional(),
});

/** POST /v1/inspection/sync/responses/partial — partial save (SVC-102). */
const partialResponseSchema = z.object({
  instanceId: z.string().uuid("instanceId must be a valid UUID"),
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
  deviceId: z.string().min(1, "deviceId is required"),
  responses: z.record(z.object({
    value: z.unknown(),
    answeredAt: z.string().min(1),
    deviceTimestamp: z.number(),
    gpsLatitude: z.number().optional(),
    gpsLongitude: z.number().optional(),
  })),
  savedAt: z.string().min(1, "savedAt is required"),
  completionPercent: z.number().min(0).max(100),
});

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

/** Path param for inspector ID. */
const inspectorIdParam = z.object({
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/sync/packages — request package generation (Req 6.1) ──
  app.post("/v1/inspection/sync/packages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const body = generatePackageSchema.parse(req.body);
    const result = await publishSyncPackageGenerate(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/sync/packages/:id — get package details (Req 6.1) ──
  app.get("/v1/inspection/sync/packages/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const { id } = idParam.parse(req.params);
    const pkg = await findPackageById(ctx.tenantId, id);
    if (!pkg) throw new HttpError(404, "NOT_FOUND", "sync package not found");
    return reply.send({ data: pkg });
  });

  // ── POST /v1/inspection/sync/upload — submit offline data (Req 6.2, 6.3, 6.4, 6.5, 6.6, 6.8) ──
  app.post("/v1/inspection/sync/upload", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const body = syncUploadSchema.parse(req.body);
    const result = await publishSyncUpload(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/sync/status/:inspectorId — get sync cursors (Req 6.8) ──
  app.get("/v1/inspection/sync/status/:inspectorId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const { inspectorId } = inspectorIdParam.parse(req.params);
    const cursors = await findCursorsByInspector(ctx.tenantId, inspectorId);
    return reply.send({ data: cursors });
  });

  // ─── Mobile-Specific Endpoints (SVC-102) ──────────────────────────────────

  // ── POST /v1/inspection/sync/upload/chunked — chunked upload for large evidence files ──
  app.post("/v1/inspection/sync/upload/chunked", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const body = chunkedUploadSchema.parse(req.body);
    const result = await publishSyncUpload(
      {
        inspectorId: ctx.actorId,
        inspectionId: body.inspectionId,
        deviceId: body.deviceId,
        sequenceNumber: body.chunkIndex,
        payload: { responses: {}, evidence: [{ evidenceId: body.evidenceId, sha256: body.sha256 }] },
        sha256Hash: body.sha256,
        networkState: "online",
      },
      ctx,
    );
    return reply.code(202).send({
      data: {
        progressToken: result.messageId,
        chunksReceived: body.chunkIndex,
        totalChunks: body.totalChunks,
        complete: body.chunkIndex >= body.totalChunks,
      },
    });
  });

  // ── POST /v1/inspection/sync/responses/partial — save partial checklist responses ──
  app.post("/v1/inspection/sync/responses/partial", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const body = partialResponseSchema.parse(req.body);
    const result = await publishSyncUpload(
      {
        inspectorId: body.inspectorId,
        inspectionId: body.instanceId,
        deviceId: body.deviceId,
        sequenceNumber: Date.now(),
        payload: {
          responses: body.responses as Record<string, { value: unknown; answeredAt: string }>,
          evidence: [],
        },
        sha256Hash: "",
        networkState: "online",
      },
      ctx,
    );
    return reply.code(202).send({
      data: {
        accepted: true,
        instanceId: body.instanceId,
        savedAt: body.savedAt,
        completionPercent: body.completionPercent,
        messageId: result.messageId,
      },
    });
  });

  // ── GET /v1/inspection/sync/packages/:id/manifest — lightweight manifest before full download ──
  app.get("/v1/inspection/sync/packages/:id/manifest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SYNC_ROLES);
    const { id } = idParam.parse(req.params);
    const pkg = await findPackageById(ctx.tenantId, id);
    if (!pkg) throw new HttpError(404, "NOT_FOUND", "sync package not found");
    return reply.send({
      data: {
        packageId: id,
        generatedAt: pkg.generatedAt?.toISOString() ?? new Date().toISOString(),
        totalSizeBytes: pkg.sizeBytes ?? 0,
        items: [],
      },
    });
  });
}
