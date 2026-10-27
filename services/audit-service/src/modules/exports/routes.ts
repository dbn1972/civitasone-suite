import { readFile } from "node:fs/promises";
import path from "node:path";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError, z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { createExportBody, PII_EXPORT_ROLES } from "./validators.js";
import { verifyArtifact, verifyDownloadToken } from "./signing.js";
import { canDownload, downloadGrant } from "./download.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const EXPORT_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];
const READER_ROLES = EXPORT_ROLES;
const EXPORT_DIR = process.env.EXPORT_DIR ?? "/tmp/audit-exports";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_FORMATS: ReadonlySet<string> = new Set(["json", "csv"]);

/**
 * Resolve an export artifact path under EXPORT_DIR. Tenant and export id must be UUIDs and the format a known
 * extension, and the resolved path must stay inside EXPORT_DIR, so no path segment can traverse out of it
 * (CodeQL js/path-injection).
 */
export function exportArtifactPath(tenantId: string, exportId: string, format: string): string | null {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(exportId) || !ARTIFACT_FORMATS.has(format)) return null;
  const base = path.resolve(EXPORT_DIR);
  const file = path.resolve(base, tenantId, `${exportId}.${format}`);
  return file.startsWith(base + path.sep) ? file : null;
}

function statusDto(ctx: RequestContext, r: NonNullable<Awaited<ReturnType<typeof repo.findByIdTx>>>) {
  const ready = r.status === "completed" && !!r.signedUrl;
  const grant = downloadGrant(ctx, r);
  return {
    id: r.id,
    status: r.status,
    format: r.format,
    periodFrom: r.periodFrom.toISOString(),
    periodTo: r.periodTo.toISOString(),
    rowCount: r.rowCount ?? null,
    includesPii: r.includesPii,
    ready,
    // Short-lived, requester-bound download token (NOT the stored path); null when withheld.
    download: grant ? grant.token : null,
    downloadExpiresAt: grant ? grant.expiresAt : null,
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

async function createExportHandler(req: FastifyRequest, reply: FastifyReply) {
  const ctx = resolveContext(req);
  requireRole(ctx, EXPORT_ROLES);
  const body = createExportBody.parse(req.body);
  return sendAccepted(reply, acceptedResponseSchema, await commands.requestExport(ctx, body));
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // G-FIX-4: this route only ever existed under the legacy /audit prefix
  // (gateway "audit-events", /api/audit) — every other export endpoint
  // (status, download, verify, below) is v1-only. Confirmed live: POST
  // /api/v1/audit/exports 404'd while POST /api/audit/exports reached this
  // handler. The web app's ExportConsole.tsx already knew about the split
  // and calls /api/proxy/audit/exports specifically for create, so nothing
  // was actually broken end-to-end — but any other client assuming the v1
  // prefix is a complete, self-sufficient namespace for this resource would
  // 404 trying to create an export. Registering the same handler under both
  // prefixes closes that trap without touching the legacy path anything
  // else might still depend on.
  app.post("/audit/exports", createExportHandler);
  app.post("/v1/audit/exports", createExportHandler);

  // P1-5: poll export status / get the download location.
  app.get("/v1/audit/exports/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set (mirrors
    // repo.findByToken / repo.listExportsByTenant).
    const found = await db.transaction((tx) => repo.findByIdTx(tx, id, ctx.tenantId));
    if (!found) throw new HttpError(404, "NOT_FOUND", "export not found");
    return reply.send({ data: statusDto(ctx, found) });
  });

  // P1-5: tenant-scoped, time-limited, token-guarded download. PII artifacts re-check role.
  app.get("/v1/audit/exports/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { token } = z.object({ token: z.string().min(1) }).parse(req.query);
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const row = await db.transaction((tx) => repo.findByIdTx(tx, id, ctx.tenantId));
    if (!row || row.status !== "completed" || !row.signedUrl) {
      throw new HttpError(404, "NOT_FOUND", "export not available");
    }
    // Token is short-lived and HMAC-bound to (export, tenant, requester): a token
    // lifted from a URL/log cannot be replayed by any other reader.
    const check = verifyDownloadToken(token, { exportId: id, tenantId: ctx.tenantId, actorId: ctx.actorId });
    if (check === "invalid") throw new HttpError(403, "FORBIDDEN", "invalid download token");
    if (check === "expired") throw new HttpError(410, "EXPIRED", "download link expired");
    if (!canDownload(ctx, row)) {
      if (row.includesPii && !hasAnyRole(ctx, PII_EXPORT_ROLES)) {
        throw new HttpError(403, "PII_EXPORT_FORBIDDEN", "PII export download requires audit_admin+");
      }
      throw new HttpError(403, "FORBIDDEN", "only the requester may download this export");
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, "EXPIRED", "export retention window elapsed");
    }
    const file = exportArtifactPath(ctx.tenantId, id, row.format);
    const buf = file ? await readFile(file).catch(() => null) : null;
    if (!buf) throw new HttpError(404, "NOT_FOUND", "artifact missing");
    // Q34: single-use. Redeemed only once every other check has passed and the
    // artifact is in hand, so a refused or failed attempt does not burn the token;
    // the first successful download does, and any replay (a token lifted from a
    // log, history or Referer header) is refused.
    const redeemed = await db.transaction((tx) =>
      repo.redeemDownloadToken(tx, { tenantId: ctx.tenantId, exportId: id, redeemedBy: ctx.actorId, token }));
    if (!redeemed) throw new HttpError(410, "TOKEN_USED", "download link already used; request a new one");
    void reply.header("cache-control", "no-store");
    void reply.header("referrer-policy", "no-referrer");
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
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const row = await db.transaction((tx) => repo.findByIdTx(tx, id, ctx.tenantId));
    if (!row || row.status !== "completed") throw new HttpError(404, "NOT_FOUND", "export not available");
    if (!row.contentSha256 || !row.signature) {
      throw new HttpError(409, "NOT_SIGNED", "export has no integrity signature");
    }
    const file = exportArtifactPath(ctx.tenantId, id, row.format);
    const buf = file ? await readFile(file).catch(() => null) : null;
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
