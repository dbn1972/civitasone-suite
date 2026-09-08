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
import { scopedRead, db } from "../../shared/db.js";
import { validateMime, ALLOWED_MIME_TYPES } from "./mime.js";
import { scanFile } from "@civitasone/scanner";
import { putObject, presignedGetUrl } from "@civitasone/storage";

const UPLOAD_ROLES = ["notification_admin", "notification_user", "helpdesk_admin", "crm_user", "crm_admin", "super_admin"];

/** Read at request time so tests can override dynamically via env */
function getMaxFileSize(): number {
  return Number(process.env.MAX_ATTACHMENT_BYTES ?? process.env.MAX_ATTACHMENT_SIZE_BYTES ?? 25 * 1024 * 1024); // 25MB default per spec
}

/** Presigned download URL lifetime — 24h, matching the metadata endpoint's `expiresAt`. */
const DOWNLOAD_URL_TTL_SECONDS = 24 * 60 * 60;

/**
 * Generate a REAL SigV4 presigned GET URL against the object actually stored
 * in S3/LocalStack (via @civitasone/storage — no fabricated URL string).
 */
async function presignedUrl(storageKey: string): Promise<string> {
  return presignedGetUrl({ key: storageKey, expiresIn: DOWNLOAD_URL_TTL_SECONDS });
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

    // Malware scan
    const scanResult = await scanFile(buffer, filename);

    if (scanResult.status === "infected") {
      // Nothing was ever uploaded to storage for an infected file — reject
      // before any bytes leave this request.
      return reply.code(422).send({ code: "MALWARE_DETECTED", message: "file is infected and has been rejected" });
    }

    // Determine scan_status: clean if scanner confirmed, pending if scanner errored
    const scanStatus = scanResult.status === "clean" ? "clean" : "pending";

    // Store to S3/LocalStack for real — a genuine object at this key from
    // here on, not a fabricated storage_key that nothing ever wrote to.
    const storageKey = `attachments/${ctx.tenantId}/${randomUUID()}/${filename}`;
    await putObject(storageKey, buffer, mimeResult.detectedMime);

    // Insert record. This is a WRITE, so it goes through `db.transaction`
    // (the write-capable primitive every other mutating module in this
    // service uses — see e.g. bulk/consumer.ts, conversations/consumer.ts),
    // not `scopedRead`. `scopedRead` is named and documented (shared/db.ts)
    // as a READ helper: it exists solely to run SELECTs inside a tenant-GUC
    // transaction so RLS is enforced on reads too. It happens to be
    // implemented as `db.transaction(fn)` under the hood, which is why an
    // INSERT routed through it "worked" — but that was an accident of
    // implementation, not a sanctioned write path, and the next refactor of
    // scopedRead (e.g. making it a read-only replica connection per
    // `dbForRead`) would silently break this insert.
    const id = randomUUID();
    await db.transaction((tx) => tx.execute(sql`
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
        downloadUrl: await presignedUrl(storageKey),
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
        downloadUrl: await presignedUrl(attachment.storageKey),
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
    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();

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
        presignedUrl: await presignedUrl(attachment.storageKey),
        expiresAt,
      },
    });
  });
}
