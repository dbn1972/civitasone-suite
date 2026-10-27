import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "platform_admin"];
// OWNER DECISION #23: the migration admin may read migrations/import batches and is
// the ONLY role that may retry failed records (super/platform admin cannot).
const MIGRATION_ADMIN = ["migration_admin"];
const READ = [...ADMIN, ...MIGRATION_ADMIN];

/** RFC 4180 CSV with a formula-injection guard (a leading = + - @ is neutralised). */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function dataMigrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/org/migrations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ sourceTenantId: z.string().uuid(), targetTenantId: z.string().uuid(), entities: z.array(z.string()).min(1), dryRun: z.boolean().default(true) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.migration.start", { messageId: id, type: "tenant.migration.start", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { migrationId: id, status: "queued", dryRun: body.dryRun } });
  });

  const listMigrations: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const data = await repo.listMigrations(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  };
  // GAP2-TENANT-WIRING-01: web loader calls /api/v1/tenant/org/migrations
  // (gateway forwards verbatim). Alias so it resolves instead of 404.
  app.get("/v1/org/migrations", listMigrations);
  app.get("/v1/tenant/org/migrations", listMigrations);

  app.get("/v1/org/migrations/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const migration = await repo.findMigration(ctx.tenantId, id);
    if (!migration) throw new HttpError(404, "NOT_FOUND", "Migration not found");
    return reply.send({ data: migration });
  });

  app.post("/v1/org/reconciliation", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ tenantId: z.string().uuid(), entityType: z.string().min(1), sourceSystem: z.string().min(1) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.reconciliation.start", { messageId: id, type: "tenant.reconciliation.start", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { reconciliationId: id, status: "queued" } });
  });

  app.get("/v1/org/reconciliation/:id/breaks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await repo.listReconciliationBreaks(ctx.tenantId, id);
    if (!result) throw new HttpError(404, "NOT_FOUND", "Reconciliation not found");
    return reply.send({ data: result.breaks, meta: { total: result.breakCount } });
  });

  // CAP-020 — import batch status + per-record error report (real persisted outcome).
  app.get("/v1/org/master-data/import/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await repo.findImportBatch(ctx.tenantId, id);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "Import batch not found");
    return reply.send({ data: repo.toBatchView(batch) });
  });

  // OWNER DECISION #23: import batches for the Data Migration page.
  const listImports: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const data = await repo.listImportBatches(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  };
  app.get("/v1/org/master-data/imports", listImports);
  app.get("/v1/tenant/org/imports", listImports);

  // OWNER DECISION #23: CSV error report (row, field, error) for one batch.
  const errorReport: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READ);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await repo.findImportBatch(ctx.tenantId, id);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "Import batch not found");
    const errs = (Array.isArray(batch.errors) ? batch.errors : []) as { index?: number; row?: number; field?: string; error?: string }[];
    const lines = ["row,field,error", ...errs.map((e) => [e.row ?? (typeof e.index === "number" ? e.index + 1 : ""), e.field ?? "", e.error ?? ""].map(csvCell).join(","))];
    void reply.header("content-type", "text/csv; charset=utf-8");
    void reply.header("content-disposition", `attachment; filename="import-${id.slice(0, 8)}-errors.csv"`);
    void reply.header("cache-control", "no-store");
    return reply.send(`\uFEFF${lines.join("\r\n")}\r\n`);
  };
  app.get("/v1/org/master-data/import/:id/errors.csv", errorReport);
  app.get("/v1/tenant/org/imports/:id/errors.csv", errorReport);

  // OWNER DECISION #23: retry the FAILED records of a batch (migration admin only).
  // CQRS: 202 + consumer; each command carries its own messageId so two retries of
  // the same batch are two commands, not a replay.
  const retryImport: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, MIGRATION_ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const batch = await repo.findImportBatch(ctx.tenantId, id);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "Import batch not found");
    if (batch.status === "processing") throw new HttpError(409, "BATCH_IN_PROGRESS", "this import is still running");
    if ((batch.failedRecords ?? []).length === 0) throw new HttpError(409, "NOTHING_TO_RETRY", "this import has no failed records to retry");
    await queue.publish("tenant.master_data.import.retry", { messageId: randomUUID(), type: "tenant.master_data.import.retry", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { batchId: id } });
    return reply.code(202).send({ data: { batchId: id, status: "retry_queued", records: batch.failedRecords.length } });
  };
  app.post("/v1/org/master-data/import/:id/retry", retryImport);
  app.post("/v1/tenant/org/imports/:id/retry", retryImport);

  // CAP-020 — export job status + materialised payload.
  app.get("/v1/org/master-data/export/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const job = await repo.findExportJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "Export job not found");
    return reply.send({ data: job });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
