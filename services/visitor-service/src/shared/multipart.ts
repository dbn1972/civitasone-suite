import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";

/** Max document-scan image size (documented: 10 MiB; mirrors document-scan/domain.ts). */
export const SCAN_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Register @fastify/multipart so `req.file()` exists for the document-scan
 * upload route (V4-F-02). Without it every upload threw TypeError -> 500.
 * Limits: one file per request, capped at SCAN_UPLOAD_MAX_BYTES (oversize -> 413).
 */
export async function registerMultipart(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: SCAN_UPLOAD_MAX_BYTES, files: 1 },
  });
}
