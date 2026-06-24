import { readFile } from "node:fs/promises";
import path from "node:path";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { createExportBody, PII_EXPORT_ROLES } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const EXPORT_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];
const READER_ROLES = EXPORT_ROLES;
const EXPORT_DIR = process.env.EXPORT_DIR ?? "/tmp/audit-exports";

function statusDto(r: NonNullable<Awaited<ReturnType<typeof repo.findByIdTx>>>) {
  return {
    id: r.id,
    status: r.status,
    format: r.format,
    periodFrom: r.periodFrom.toISOString(),
    periodTo: r.periodTo.toISOString(),
    rowCount: r.rowCount ?? null,
    includesPii: r.includesPii,
    download: r.signedUrl ?? null,
    retentionUntil: r.retentionUntil ? r.retentionUntil.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    error: r.error ?? null,
  };
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/audit/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPORT_ROLES);
    const body = createExportBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestExport(ctx, body));
  });

  // P1-5: poll export status / get the download location.
  app.get("/v1/audit/exports/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const found = await repo.findByIdTx(db, id, ctx.tenantId);
    if (!found) throw new HttpError(404, "NOT_FOUND", "export not found");
    return reply.send({ data: statusDto(found) });
  });

  // P1-5: tenant-scoped, time-limited, token-guarded download. PII artifacts re-check role.
  app.get("/v1/audit/exports/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { token } = z.object({ token: z.string().min(1) }).parse(req.query);
    const row = await repo.findByIdTx(db, id, ctx.tenantId);
    if (!row || row.status !== "completed" || !row.downloadToken) {
      throw new HttpError(404, "NOT_FOUND", "export not available");
    }
    if (row.downloadToken !== token) throw new HttpError(403, "FORBIDDEN", "invalid download token");
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, "EXPIRED", "download link expired");
    }
    if (row.includesPii && !hasAnyRole(ctx, PII_EXPORT_ROLES)) {
      throw new HttpError(403, "PII_EXPORT_FORBIDDEN", "PII export download requires audit_admin+");
    }
    const file = path.join(EXPORT_DIR, ctx.tenantId, `${id}.${row.format}`);
    const buf = await readFile(file).catch(() => null);
    if (!buf) throw new HttpError(404, "NOT_FOUND", "artifact missing");
    void reply.header("content-type", row.format === "csv" ? "text/csv" : "application/json");
    void reply.header("content-disposition", `attachment; filename="audit-export-${id}.${row.format}"`);
    return reply.send(buf);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
