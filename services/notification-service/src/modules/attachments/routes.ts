/**
 * CH-19 — Attachment upload/download routes.
 *
 * POST /notifications/attachments/upload    — multipart file upload with MIME validation + malware scan
 * GET  /notifications/attachments/:id/download — serve presigned download URL (checks scan status)
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { validateMime, ALLOWED_MIME_TYPES } from "./mime.js";

const UPLOAD_ROLES = ["notification_admin", "notification_user", "helpdesk_admin", "crm_user", "crm_admin", "super_admin"];

/** Read at request time so tests can override dynamically via env */
function getMaxFileSize(): number {
  return Number(process.env.MAX_ATTACHMENT_BYTES ?? process.env.MAX_ATTACHMENT_SIZE_BYTES ?? 25 * 1024 * 1024); // 25MB default per spec
}
const CLAMAV_URL = process.env.CLAMAV_URL ?? "http://localhost:3310/scan";
const CLAMAV_TIMEOUT_MS = Number(process.env.CLAMAV_TIMEOUT_MS ?? 10_000);
const STORAGE_BASE = process.env.STORAGE_URL ?? "http://localhost:4566";

interface ScanResult {
  status: "clean" | "infected" | "error";
}

/**
 * Call ClamAV REST API to scan file buffer.
 * Returns scan result or 'pending' on failure (fail-open for availability).
 */
async function scanFile(buffer: Buffer, filename: string): Promise<ScanResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAMAV_TIMEOUT_MS);
  try {
    const formData = new FormData();
    formData.append("file", new Blob([buffer]), filename);

    const res = await fetch(CLAMAV_URL, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) return { status: "error" };
    const json = await res.json() as { infected?: boolean; status?: string };
    if (json.infected === true || json.status === "infected") return { status: "infected" };
    return { status: "clean" };
  } catch {
    // Scanner unavailable — fail open
    return { status: "error" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a presigned download URL (simulated for now; in prod this calls S3/MinIO).
 */
function presignedUrl(storageKey: string): string {
  return `${STORAGE_BASE}/${storageKey}?X-Amz-Expires=86400`;
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  // Upload
  app.post("/notifications/attachments/upload", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UPLOAD_ROLES);

    // Parse multipart — expect raw body with file data
    // In production this uses @fastify/multipart; here we accept raw buffer from content-type
    const contentType = req.headers["content-type"] ?? "";
    const contentLength = Number(req.headers["content-length"] ?? 0);

    const maxSize = getMaxFileSize();

    // Size cap check (header-based early rejection)
    if (contentLength > maxSize) {
      return reply.code(413).send({ code: "FILE_TOO_LARGE", message: `max file size is ${maxSize} bytes` });
    }

    // For testing/integration: accept JSON body with base64-encoded file
    const body = req.body as { filename?: string; mimeType?: string; data?: string; size?: number };
    if (!body || !body.filename || !body.data) {
      throw new HttpError(400, "INVALID_UPLOAD", "filename and data (base64) required");
    }

    const buffer = Buffer.from(body.data, "base64");
    const filename = body.filename;
    const declaredMime = body.mimeType ?? "application/octet-stream";

    // Size cap (actual buffer)
    if (buffer.length > maxSize) {
      return reply.code(413).send({ code: "FILE_TOO_LARGE", message: `max file size is ${maxSize} bytes` });
    }

    // MIME validation via magic bytes
    const mimeResult = validateMime(buffer, filename, declaredMime);
    if (!mimeResult.valid) {
      return reply.code(415).send({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: `file type not allowed. Detected: ${mimeResult.detectedMime}. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
      });
    }

    // Store to S3/MinIO (simulated: generate storage key)
    const storageKey = `attachments/${ctx.tenantId}/${randomUUID()}/${filename}`;

    // Malware scan
    const scanResult = await scanFile(buffer, filename);

    if (scanResult.status === "infected") {
      // Delete from storage (in production) and reject
      return reply.code(422).send({ code: "MALWARE_DETECTED", message: "file is infected and has been rejected" });
    }

    // Determine scan_status: clean if scanner confirmed, pending if scanner errored
    const scanStatus = scanResult.status === "clean" ? "clean" : "pending";

    // Insert record
    const id = randomUUID();
    await scopedRead((tx) => tx.execute(sql`
      INSERT INTO notification.message_attachments
        (id, tenant_id, filename, mime_type, size_bytes, storage_key, scan_status, scanned_at, uploaded_by)
      VALUES
        (${id}, ${ctx.tenantId}, ${filename}, ${mimeResult.detectedMime},
         ${buffer.length}, ${storageKey},
         ${scanStatus}, ${scanStatus === "clean" ? sql`now()` : sql`NULL`}, ${ctx.actorId})
    `));

    return reply.code(200).send({
      data: {
        id,
        filename,
        mimeType: mimeResult.detectedMime,
        sizeBytes: buffer.length,
        scanStatus,
        downloadUrl: presignedUrl(storageKey),
      },
    });
  });

  // Download
  app.get("/notifications/attachments/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UPLOAD_ROLES);
    const { id } = req.params as { id: string };

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, storage_key AS "storageKey", scan_status AS "scanStatus", filename
      FROM notification.message_attachments
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      LIMIT 1
    `)) as unknown as Array<{ id: string; storageKey: string; scanStatus: string; filename: string }>;

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "attachment not found");
    }

    const attachment = rows[0]!;

    if (attachment.scanStatus === "infected") {
      return reply.code(403).send({ code: "INFECTED_FILE", message: "file flagged as infected" });
    }

    if (attachment.scanStatus === "pending") {
      void reply.header("X-Scan-Warning", "scan_pending");
    }

    return reply.code(200).send({
      data: {
        id: attachment.id,
        filename: attachment.filename,
        downloadUrl: presignedUrl(attachment.storageKey),
        scanStatus: attachment.scanStatus,
      },
    });
  });

  // Get attachment metadata + fresh presigned URL (24h expiry)
  app.get("/notifications/attachments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UPLOAD_ROLES);
    const { id } = req.params as { id: string };

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes",
             storage_key AS "storageKey", scan_status AS "scanStatus",
             scanned_at AS "scannedAt", uploaded_by AS "uploadedBy", created_at AS "createdAt"
      FROM notification.message_attachments
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      LIMIT 1
    `)) as unknown as Array<{
      id: string; filename: string; mimeType: string; sizeBytes: string;
      storageKey: string; scanStatus: string; scannedAt: string | null;
      uploadedBy: string; createdAt: string;
    }>;

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "attachment not found");
    }

    const attachment = rows[0]!;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return reply.code(200).send({
      data: {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        scanStatus: attachment.scanStatus,
        scannedAt: attachment.scannedAt,
        uploadedBy: attachment.uploadedBy,
        createdAt: attachment.createdAt,
        presignedUrl: presignedUrl(attachment.storageKey),
        expiresAt,
      },
    });
  });
}
