/**
 * evidence module — HTTP routes (Fastify plugin `registerEvidenceRoutes`, 6 endpoints).
 *
 * Follows the suite CQRS + envelope conventions:
 *   • WRITES — `resolveContext` → `requireRole` → zod validate → command publish → 202
 *   • READS  — cache-first `repo.*` lookups
 *   • PRESIGN — synchronous presigned URL generation → 200
 *
 * RBAC:
 *   - inspector: upload evidence, presign, read own
 *   - reviewing_officer: verify integrity
 *   - audit_officer: read chain of custody
 *
 * Endpoints (6):
 *   POST /v1/inspection/evidence/presign         — generate presigned S3 PUT URL (sync, 200)
 *   POST /v1/inspection/evidence                 — register evidence metadata (CQRS, 202)
 *   GET  /v1/inspection/evidence/:id             — get evidence by ID
 *   GET  /v1/inspection/evidence                 — list evidence by inspection
 *   POST /v1/inspection/evidence/:id/verify      — trigger integrity verification (CQRS, 202)
 *   GET  /v1/inspection/evidence/:id/custody     — get chain of custody
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateMimeType, validateFileSize, DomainError } from "./domain.js";
import { resolveStorageConfig, generatePresignedPutUrl } from "./storage.js";
import {
  publishEvidenceRegister,
  publishEvidenceVerifyIntegrity,
} from "./commands.js";
import {
  findEvidenceById,
  findEvidenceByInspection,
  findCustodyByEvidence,
} from "./repo.js";

// ─── RBAC role groups ────────────────────────────────────────────────────────

/** Evidence upload: inspectors and admins. */
const UPLOAD_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];

/** Integrity verification: reviewing officers and admins. */
const VERIFY_ROLES = ["reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Chain of custody access: audit officers and admins. */
const CUSTODY_ROLES = ["audit_officer", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Read evidence: inspectors, reviewers, audit officers. */
const READ_ROLES = ["inspector", "reviewing_officer", "audit_officer", "inspection_admin", "tenant_admin", "super_admin"];

// ─── Zod validation schemas ─────────────────────────────────────────────────

/** POST /v1/inspection/evidence/presign — request presigned upload URL (Req 7.3, 7.7, 7.8). */
const presignSchema = z.object({
  fileName: z.string().min(1, "fileName is required"),
  mimeType: z.string().min(1, "mimeType is required"),
  fileSizeBytes: z.number().int().positive("fileSizeBytes must be a positive integer"),
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
});

/** POST /v1/inspection/evidence — register evidence metadata (Req 7.1, 7.2). */
const registerEvidenceSchema = z.object({
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  findingId: z.string().uuid("findingId must be a valid UUID").optional(),
  sha256Hash: z.string().min(1, "sha256Hash is required"),
  mimeType: z.string().min(1, "mimeType is required"),
  fileSizeBytes: z.number().int().positive("fileSizeBytes must be a positive integer"),
  s3Key: z.string().min(1, "s3Key is required"),
  captureLatitude: z.string().optional(),
  captureLongitude: z.string().optional(),
  captureTimestamp: z.string().min(1, "captureTimestamp is required"),
  deviceId: z.string().min(1, "deviceId is required"),
  inspectorId: z.string().uuid("inspectorId must be a valid UUID"),
});

/** Reusable UUID path param schema. */
const idParam = z.object({
  id: z.string().uuid("id must be a valid UUID"),
});

/** Query params for list endpoint. */
const listQuerySchema = z.object({
  inspectionId: z.string().uuid("inspectionId must be a valid UUID"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});

// ─── Presigned URL expiry ────────────────────────────────────────────────────

/** Presigned URL expiry in seconds (15 minutes). */
const PRESIGN_EXPIRY_SECONDS = 15 * 60;

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/evidence/presign — generate presigned S3 PUT URL (Req 7.3, 7.7, 7.8) ──
  app.post("/v1/inspection/evidence/presign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UPLOAD_ROLES);

    const body = presignSchema.parse(req.body);

    // Validate MIME type (Req 7.3)
    try {
      validateMimeType(body.mimeType);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }

    // Validate file size (Req 7.7)
    try {
      validateFileSize(body.fileSizeBytes);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }

    // Build the deterministic object key + evidence id up front so the client can
    // correlate the subsequent register call regardless of storage availability.
    const evidenceId = randomUUID();
    const s3Key = `evidence/${ctx.tenantId}/${body.inspectionId}/${evidenceId}/${body.fileName}`;

    // Env-gated: only mint a REAL presigned URL when bucket + region + creds exist.
    const storageConfig = resolveStorageConfig();
    if (!storageConfig) {
      // Explicit "not configured" — never a fabricated success URL (Req 7.8).
      return reply.code(200).send({
        data: {
          status: "not_configured",
          reason: "S3 storage is not configured (missing bucket/region/credentials)",
          evidenceId,
          s3Key,
        },
      });
    }

    // Generate a REAL AWS SigV4 presigned PUT URL (Req 7.8).
    const uploadUrl = await generatePresignedPutUrl(
      storageConfig,
      s3Key,
      body.mimeType,
      PRESIGN_EXPIRY_SECONDS,
    );
    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();

    return reply.code(200).send({
      data: {
        status: "ready",
        uploadUrl,
        evidenceId,
        s3Key,
        expiresAt,
      },
    });
  });

  // ── POST /v1/inspection/evidence — register evidence metadata (Req 7.1, 7.2) ──
  app.post("/v1/inspection/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UPLOAD_ROLES);

    const body = registerEvidenceSchema.parse(req.body);

    // Validate MIME type (Req 7.3)
    try {
      validateMimeType(body.mimeType);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }

    // Validate file size (Req 7.7)
    try {
      validateFileSize(body.fileSizeBytes);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }

    const result = await publishEvidenceRegister(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/evidence/:id — get evidence artifact by ID ──
  app.get("/v1/inspection/evidence/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);

    const { id } = idParam.parse(req.params);
    const evidence = await findEvidenceById(ctx.tenantId, id);
    if (!evidence) throw new HttpError(404, "NOT_FOUND", "evidence artifact not found");

    return reply.send({ data: evidence });
  });

  // ── GET /v1/inspection/evidence — list evidence by inspection ──
  app.get("/v1/inspection/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);

    const query = listQuerySchema.parse(req.query);
    const result = await findEvidenceByInspection(ctx.tenantId, query.inspectionId, {
      page: query.page,
      pageSize: query.pageSize,
    });

    return reply.send(result);
  });

  // ── POST /v1/inspection/evidence/:id/verify — trigger integrity verification (Req 7.4) ──
  app.post("/v1/inspection/evidence/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VERIFY_ROLES);

    const { id } = idParam.parse(req.params);

    // Ensure evidence exists before queueing verification
    const evidence = await findEvidenceById(ctx.tenantId, id);
    if (!evidence) throw new HttpError(404, "NOT_FOUND", "evidence artifact not found");

    const result = await publishEvidenceVerifyIntegrity({ evidenceId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/evidence/:id/custody — get chain of custody (Req 7.5) ──
  app.get("/v1/inspection/evidence/:id/custody", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CUSTODY_ROLES);

    const { id } = idParam.parse(req.params);

    // Ensure evidence exists
    const evidence = await findEvidenceById(ctx.tenantId, id);
    if (!evidence) throw new HttpError(404, "NOT_FOUND", "evidence artifact not found");

    const custodyEntries = await findCustodyByEvidence(ctx.tenantId, id);
    return reply.send({ data: custodyEntries });
  });
}
