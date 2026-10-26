/**
 * Data Export module HTTP routes (Fastify plugin).
 * DPDP Act 2023 compliant — tenant users can request their data export.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import * as commands from "./commands.js";
import { exportRequests } from "./schema.js";
import { scopedRead } from "../../shared/db.js";
import { eq, and, desc } from "drizzle-orm";
import { presignedGetUrl, StorageNotConfiguredError } from "@civitasone/storage";

const createBody = z.object({
  type: z.enum(["full", "module", "entity"]),
  moduleFilter: z.string().min(1).max(100).optional(),
  format: z.enum(["csv", "json", "pdf"]),
  // GAP-TENANT-ADMIN-DATA-EXPORT-02: a reason/purpose for exporting personal
  // data (payroll/HRMS). Recorded in the audit event. Required for a full
  // export (the broadest personal-data egress); optional otherwise.
  purpose: z.string().min(10).max(2000).optional(),
  entityId: z.string().min(1).max(160).optional(),
});

/** Modules whose export carries personal data (salary, identity, employment). */
const PERSONAL_DATA_MODULES = new Set(["payroll", "hrms"]);

const idParam = z.object({ id: z.string().uuid() });

/** OWNER DECISION #22: signed download links live for 15 minutes. */
export const DOWNLOAD_LINK_TTL_SECONDS = 15 * 60;

/**
 * What a list row may expose to the browser: storage keys never leave the
 * server, only a per-file summary the UI can show.
 */
export function toExportView<T extends { files?: unknown }>(row: T): Omit<T, "files"> & { files: { entity: string; rowCount: number; sizeBytes: number }[] } {
  const { files, ...rest } = row;
  const list = Array.isArray(files) ? (files as Array<{ entity: string; rowCount: number; sizeBytes: number }>) : [];
  return { ...rest, files: list.map((f) => ({ entity: f.entity, rowCount: f.rowCount, sizeBytes: f.sizeBytes })) };
}

/** A ready export whose expiry has passed is "expired" (and offers no download URL). */
export function effectiveExportStatus<T extends { status: string; expiresAt: Date | string | null; downloadUrl: string | null }>(row: T, now = Date.now()): T {
  if (row.status === "ready" && row.expiresAt && new Date(row.expiresAt).getTime() < now) {
    return { ...row, status: "expired", downloadUrl: null };
  }
  return row;
}

function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function dataExportRoutes(app: FastifyInstance): Promise<void> {
  // CREATE export request
  app.post("/v1/admin/data-export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const body = safeParse(createBody, req.body);
    // GAP-TENANT-ADMIN-DATA-EXPORT-02: purpose is required wherever personal data
    // leaves in bulk -- a full export, or a payroll / HRMS module export. The web
    // dialog asks for the same; this is the authority.
    if (!body.purpose && (body.type === "full" || (body.type === "module" && PERSONAL_DATA_MODULES.has(body.moduleFilter ?? "")))) {
      throw new HttpError(400, "PURPOSE_REQUIRED", "purpose is required for a full export or a payroll/HRMS export");
    }
    if (body.type === "module" && !body.moduleFilter) {
      throw new HttpError(400, "MODULE_REQUIRED", "moduleFilter is required when type is 'module'");
    }
    // GAP-TENANT-ADMIN-DATA-EXPORT-02/03: purpose is REQUIRED server-side for a
    // full export (enforced above) and audited whenever supplied; entityId is
    // captured and audited when supplied.
    // exactOptionalPropertyTypes: only spread moduleFilter into the payload
    // when it's actually provided, so we never assign `undefined` to a
    // property typed as optional-string (never optional-string-or-undefined).
    const result = await commands.exportRequest(ctx, {
      type: body.type,
      format: body.format,
      ...(body.moduleFilter !== undefined ? { moduleFilter: body.moduleFilter } : {}),
      ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
      ...(body.entityId !== undefined ? { entityId: body.entityId } : {}),
    });
    return reply.code(202).send(result);
  });

  // LIST export requests for tenant
  app.get("/v1/admin/data-export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    // Wrapped in scopedRead() (db.transaction) so wrapWithTenantGuc injects
    // app.tenant_id before this read — a bare db.select() under FORCE RLS
    // returns zero rows with no GUC set.
    const rows = await scopedRead((tx) => tx.select().from(exportRequests)
      .where(eq(exportRequests.tenantId, ctx.tenantId))
      .orderBy(desc(exportRequests.createdAt))
      .limit(50));
    // GAP-TENANT-ADMIN-DATA-EXPORT-06: nothing ever flips a ready export to
    // "expired" in the table, so after 48h the list kept offering a Download link
    // that the download route answers with 410. Report the EFFECTIVE status.
    const now = Date.now();
    return reply.send({ data: rows.map((r) => toExportView(effectiveExportStatus(r, now))) });
  });

  // DOWNLOAD export (returns signed URL or triggers download)
  app.get("/v1/admin/data-export/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    // Wrapped in scopedRead() (db.transaction) so wrapWithTenantGuc injects
    // app.tenant_id before this read — a bare db.select() under FORCE RLS
    // returns zero rows with no GUC set.
    const rows = await scopedRead((tx) => tx.select().from(exportRequests)
      .where(and(eq(exportRequests.id, id), eq(exportRequests.tenantId, ctx.tenantId)))
      .limit(1));
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "export request not found");
    if (row.status !== "ready") {
      throw new HttpError(409, "NOT_READY", `export status is '${row.status}', must be 'ready'`);
    }
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      throw new HttpError(410, "EXPIRED", "export has expired, please request a new one");
    }
    // OWNER DECISION #22: files live in object storage; each link is signed for
    // 15 minutes at the moment of THIS request and is never persisted. The issue
    // is audited BEFORE any link is returned (fail closed), and the raw storage
    // key is never sent to the browser.
    const stored = Array.isArray(row.files) ? row.files : [];
    if (stored.length === 0) {
      // Legacy rows created before files were stored: nothing to sign.
      return reply.send({ downloadUrl: row.downloadUrl, expiresAt: row.expiresAt, files: [] });
    }
    await commands.exportDownloadIssued(ctx, id, stored.length, DOWNLOAD_LINK_TTL_SECONDS);
    let files: { entity: string; fileName: string; rowCount: number; sizeBytes: number; url: string }[];
    try {
      files = await Promise.all(stored.map(async (f) => ({
        entity: f.entity,
        fileName: f.key.slice(f.key.lastIndexOf("/") + 1),
        rowCount: f.rowCount,
        sizeBytes: f.sizeBytes,
        url: await presignedGetUrl({ key: f.key, expiresIn: DOWNLOAD_LINK_TTL_SECONDS }),
      })));
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) throw new HttpError(503, "STORAGE_UNAVAILABLE", "file storage is not available right now");
      throw new HttpError(502, "STORAGE_FAILED", "the export file could not be prepared for download");
    }
    void reply.header("cache-control", "no-store");
    return reply.send({
      downloadUrl: files[0]?.url ?? null,
      expiresAt: row.expiresAt,
      linkExpiresAt: new Date(Date.now() + DOWNLOAD_LINK_TTL_SECONDS * 1000).toISOString(),
      files,
    });
  });
}
