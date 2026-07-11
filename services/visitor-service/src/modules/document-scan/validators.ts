/**
 * visitor-service: document-scan zod validators (routes.ts boundary).
 *
 * Validates HTTP request bodies, path params, and query strings for the
 * document scan module endpoints. Enforces shape/type at the HTTP boundary
 * so malformed requests are rejected before reaching the queue.
 *
 * Requirements validated: 6.1, 6.2
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

const scanStatusEnum = z.enum(["uploading", "processing", "completed", "failed"], {
  errorMap: () => ({ message: "status must be one of: uploading, processing, completed, failed" }),
});

// ---------------------------------------------------------------------------
// 1. uploadScanParams — validates multipart upload context
//    (device auth context provides deviceId/tenantId automatically)
// ---------------------------------------------------------------------------

export const uploadScanParams = z.object({
  /** MIME type validated server-side from multipart metadata. */
  mimetype: z.string().refine(
    (val) => val === "image/jpeg" || val === "image/png",
    { message: "image must be JPEG or PNG (image/jpeg or image/png)" },
  ),
  /** File size in bytes. */
  size: z.number().int().positive("file size must be positive")
    .max(10 * 1024 * 1024, "file size must not exceed 10 MB"),
});
export type UploadScanParams = z.infer<typeof uploadScanParams>;

// ---------------------------------------------------------------------------
// 2. getResultParams — path param for retrieving OCR result
// ---------------------------------------------------------------------------

export const getResultParams = z.object({
  sessionId: z.string().uuid("invalid sessionId"),
});
export type GetResultParams = z.infer<typeof getResultParams>;

// ---------------------------------------------------------------------------
// 3. listScansQuery — query params for listing scan sessions
// ---------------------------------------------------------------------------

export const listScansQuery = z.object({
  page: z.coerce.number().int().min(1, "page must be >= 1").default(1),
  pageSize: z.coerce.number().int().min(1, "pageSize must be >= 1").max(200, "pageSize must be <= 200").default(20),
  status: scanStatusEnum.optional(),
});
export type ListScansQuery = z.infer<typeof listScansQuery>;
