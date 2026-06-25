import { readFile } from "node:fs/promises";
import path from "node:path";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { createExportBody, PII_EXPORT_ROLES } from "./validators.js";
import { verifyArtifact } from "./signing.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const EXPORT_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];
const READER_ROLES = EXPORT_ROLES;
const EXPORT_DIR = process.env.EXPORT_DIR ?? "/tmp/audit-exports";

// H1: the tokenized download URL must only be handed to a caller who is actually
// allowed to fetch the artifact: the requester, and for PII exports also a PII role.
// Everyone else authorized to read status gets ready:true with no token.
function canDownload(ctx: RequestContext, r: NonNullable<Awaited<ReturnType<typeof repo.findByIdTx>>>): boolean {
  const isRequester = r.createdBy === ctx.actorId;
  const piiOk = !r.includesPii || hasAnyRole(ctx, PII_EXPORT_ROLES);
  return isRequester && piiOk;
}

function statusDto(ctx: RequestContext, r: NonNullable<Awaited<ReturnType<typeof repo.findByIdTx>>>) {
  const ready = r.status === "completed" && !!r.signedUrl;
  const allowToken = ready && canDownload(ctx, r);
  return {
    id: r.id,
    status: r.status,
    format: r.format,
    periodFrom: r.periodFrom.toISOString(),
    periodTo: r.periodTo.toISOString(),
    rowCount: r.rowCount ?? null,
    includesPii: r.includesPii,
    ready,
    download: allowToken ? r.signedUrl : null,
    retentionUntil: r.retentionUntil ? r.retentionUntil.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    error: r.error ?? null,
    // AUD-2: tamper-evidence metadata so a client knows the artifact is signed.
    contentSha256: r.contentSha256 ?? null,
    signature: r.signature ?? null,
    signatureAlg: r.signatureAlg ?? null,
    signingKeyId: r.signingKeyId ?? null,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
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
    return reply.send({ data: statusDto(ctx, found) });
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
    // AUD-2: surface the integrity proof alongside the bytes so a client can
    // verify the artifact it just received was not altered in transit/at rest.
    if (row.contentSha256) void reply.header("x-content-sha256", row.contentSha256);
    if (row.signature) void reply.header("x-content-signature", row.signature);
    if (row.signatureAlg) void reply.header("x-signature-alg", row.signatureAlg);
    if (row.signingKeyId) void reply.header("x-signing-key-id", row.signingKeyId);
    return reply.send(buf);
  });

  // AUD-2: server-side integrity verification. Re-reads the artifact from disk,
  // recomputes its SHA-256 and the HMAC signature over the manifest, and reports
  // whether both still match what was persisted at signing time. This is the
  // tamper-evidence check a regulator (or an automated monitor) calls to prove the
  // WORM artifact has not been altered after generation.
  app.get("/v1/audit/exports/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findByIdTx(db, id, ctx.tenantId);
    if (!row || row.status !== "completed") throw new HttpError(404, "NOT_FOUND", "export not available");
    if (!row.contentSha256 || !row.signature) {
      throw new HttpError(409, "NOT_SIGNED", "export has no integrity signature");
    }
    const file = path.join(EXPORT_DIR, ctx.tenantId, `${id}.${row.format}`);
    const buf = await readFile(file).catch(() => null);
    if (!buf) {
      return reply.send({ data: { id, verified: false, contentMatch: false, signatureMatch: false, reason: "artifact missing" } });
    }
    const result = verifyArtifact(
      buf,
      { contentSha256: row.contentSha256, signature: row.signature },
      {
        exportId: row.id, tenantId: row.tenantId,
        from: row.periodFrom.toISOString(), to: row.periodTo.toISOString(),
        format: row.format, includesPii: row.includesPii, rowCount: row.rowCount ?? 0,
      },
    );
    return reply.send({
      data: {
        id, verified: result.ok, contentMatch: result.contentMatch, signatureMatch: result.signatureMatch,
        contentSha256: row.contentSha256, signatureAlg: row.signatureAlg, signingKeyId: row.signingKeyId,
        signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
