/**
 * sync module — HTTP routes (Fastify plugin `registerSyncRoutes`, 4 endpoints).
 *
 * Follows the suite CQRS + envelope conventions:
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *   • READS  — cache-first `repo.*` lookups
 *
 * RBAC: all sync operations require `inspector` role (or admin overrides).
 *
 * Endpoints (4):
 *   POST /v1/inspection/sync/packages         — request offline package generation
 *   GET  /v1/inspection/sync/packages/:id     — get package status/download info
 *   POST /v1/inspection/sync/upload           — submit offline-completed data
 *   GET  /v1/inspection/sync/status/:inspectorId — get sync status for inspector
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
}
