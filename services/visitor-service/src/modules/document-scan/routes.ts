/**
 * visitor-service: document-scan HTTP routes (Fastify plugin).
 *
 * Device routes use device-auth middleware (deviceAuth preHandler).
 * Admin routes use standard JWT auth (resolveContext/requireRole).
 *
 * CQRS pattern: route → zod validate → queue.publish → 202 Accepted.
 * Read endpoints go through repo (cache.getOrLoad).
 *
 * Routes:
 *   POST /v1/visitor/scans/upload       — device auth, multipart upload
 *   GET  /v1/visitor/scans/:sessionId/result — device auth, OCR result
 *   GET  /v1/visitor/scans              — admin auth, list scans
 *   GET  /v1/visitor/scans/:sessionId   — admin auth, session details
 *
 * Requirements validated: 6.1, 6.4, 6.6
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { deviceAuth } from "../device-registry/device-auth.js";
import { uploadScanParams, getResultParams, listScansQuery } from "./validators.js";
import { validateImage } from "./domain.js";
import { publishScanProcess } from "./commands.js";
import { getScanSession, getOcrResult, listScans } from "./repo.js";

// Roles permitted for admin scan management endpoints.
const ADMIN_ROLES = ["facility_admin", "security_admin", "tenant_admin", "super_admin"];

/** S3/MinIO upload helper. */
async function uploadToStorage(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3_BUCKET must be configured for image upload");
  }

  const endpoint = process.env.S3_ENDPOINT ?? "https://s3.amazonaws.com";
  const region = process.env.S3_REGION ?? "ap-south-1";

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region,
    ...(endpoint.includes("localhost") || endpoint.includes("localstack")
      ? { endpoint, forcePathStyle: true }
      : {}),
  });

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));
}

export default async function documentScanRoutes(app: FastifyInstance): Promise<void> {
  // ─────────────────────────────────────────────────────────────────────────
  // Device routes (device-auth middleware)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /v1/visitor/scans/upload — Upload document image (multipart).
   *
   * Device auth required. Validates image → uploads to S3 → inserts
   * scan_session → publishes scanProcess command → returns 202.
   *
   * Requirements: 6.1, 6.2
   */
  app.post("/v1/visitor/scans/upload", { preHandler: [deviceAuth] }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;

    // Parse multipart file
    const file = await (req as any).file();
    if (!file) {
      throw new HttpError(400, "MISSING_FILE", "multipart file upload required");
    }

    // Consume file buffer
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Validate image (MIME type and size)
    const validation = validateImage(file.mimetype, buffer.length);
    if (!validation.valid) {
      throw new HttpError(400, "INVALID_IMAGE", validation.error!);
    }

    // Generate storage key and session ID
    const sessionId = randomUUID();
    const storageKey = `scans/${deviceCtx.tenantId}/${sessionId}/${file.filename ?? "document"}`;

    // Upload to S3/MinIO
    await uploadToStorage(storageKey, buffer, file.mimetype);

    // Insert scan session (status: uploading, expires in 1 hour)
    const { db } = await import("../../shared/db.js");
    const { scanSessions } = await import("./schema.js");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    await runWithTenant(deviceCtx.tenantId, () => db.transaction((tx) => tx.insert(scanSessions).values({
      id: sessionId,
      tenantId: deviceCtx.tenantId,
      deviceId: deviceCtx.deviceId,
      status: "uploading",
      imageStorageKey: storageKey,
      imageDeleted: false,
      imageExpiresAt: expiresAt,
      createdAt: now,
    })));

    // Publish scanProcess command → consumer handles OCR
    const ctx = {
      tenantId: deviceCtx.tenantId,
      actorId: deviceCtx.deviceId,
      correlationId: randomUUID(),
      roles: [],
      sessionId: "",
    };
    await publishScanProcess(ctx as any, {
      sessionId,
      tenantId: deviceCtx.tenantId,
      deviceId: deviceCtx.deviceId,
      imageStorageKey: storageKey,
    });

    return reply.code(202).send({
      data: { id: sessionId, status: "accepted", correlationId: ctx.correlationId },
    });
  });

  /**
   * GET /v1/visitor/scans/:sessionId/result — Get OCR result for session.
   *
   * Device auth required. Returns the OCR extraction result or 404 if
   * processing is not yet complete.
   *
   * Requirements: 6.4
   */
  app.get("/v1/visitor/scans/:sessionId/result", { preHandler: [deviceAuth] }, async (req, reply) => {
    const deviceCtx = req.deviceContext!;
    const { sessionId } = getResultParams.parse(req.params);

    const result = await getOcrResult(deviceCtx.tenantId, sessionId);
    if (!result) {
      throw new HttpError(404, "OCR_RESULT_NOT_FOUND", "OCR result not yet available for this session");
    }

    return reply.send({ data: result });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Admin routes (JWT auth via resolveContext/requireRole)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /v1/visitor/scans — List scan sessions (paginated, filterable).
   *
   * Admin auth required.
   *
   * Requirements: 6.6
   */
  app.get("/v1/visitor/scans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const query = listScansQuery.parse(req.query);

    const result = await listScans(
      ctx.tenantId,
      { ...(query.status ? { status: query.status } : {}) },
      query.page,
      query.pageSize,
    );
    return reply.send({ data: result.data, meta: result.meta });
  });

  /**
   * GET /v1/visitor/scans/:sessionId — Get scan session details.
   *
   * Admin auth required.
   *
   * Requirements: 6.6
   */
  app.get("/v1/visitor/scans/:sessionId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { sessionId } = getResultParams.parse(req.params);

    const session = await getScanSession(ctx.tenantId, sessionId);
    if (!session) {
      throw new HttpError(404, "SCAN_SESSION_NOT_FOUND", "scan session not found");
    }

    return reply.send({ data: session });
  });
}
