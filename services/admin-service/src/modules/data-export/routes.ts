/**
 * Data Export module HTTP routes (Fastify plugin).
 * DPDP Act 2023 compliant — tenant users can request their data export.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as commands from "./commands.js";
import { exportRequests } from "./schema.js";
import { db } from "../../shared/db.js";
import { eq, and, desc } from "drizzle-orm";

const RESOURCE = "data_export";

const createBody = z.object({
  type: z.enum(["full", "module", "entity"]),
  moduleFilter: z.string().min(1).max(100).optional(),
  format: z.enum(["csv", "json", "pdf"]),
});

const idParam = z.object({ id: z.string().uuid() });

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
    if (body.type === "module" && !body.moduleFilter) {
      throw new HttpError(400, "MODULE_REQUIRED", "moduleFilter is required when type is 'module'");
    }
    const result = await commands.exportRequest(ctx, body);
    return reply.code(202).send(result);
  });

  // LIST export requests for tenant
  app.get("/v1/admin/data-export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const rows = await db.select().from(exportRequests)
      .where(eq(exportRequests.tenantId, ctx.tenantId))
      .orderBy(desc(exportRequests.createdAt))
      .limit(50);
    return reply.send({ data: rows });
  });

  // DOWNLOAD export (returns signed URL or triggers download)
  app.get("/v1/admin/data-export/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    const rows = await db.select().from(exportRequests)
      .where(and(eq(exportRequests.id, id), eq(exportRequests.tenantId, ctx.tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "export request not found");
    if (row.status !== "ready") {
      throw new HttpError(409, "NOT_READY", `export status is '${row.status}', must be 'ready'`);
    }
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      throw new HttpError(410, "EXPIRED", "export has expired, please request a new one");
    }
    return reply.send({ downloadUrl: row.downloadUrl, expiresAt: row.expiresAt });
  });
}
