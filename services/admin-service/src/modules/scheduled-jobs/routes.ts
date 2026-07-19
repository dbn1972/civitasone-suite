/**
 * Scheduled Jobs module HTTP routes (Fastify plugin).
 * CRUD + pause/resume/run-now + execution history.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import * as commands from "./commands.js";
import { createJobBody, updateJobBody, jobIdParam } from "./validators.js";
import { scheduledJobs, jobExecutionHistory } from "./schema.js";
import { eq, and, desc } from "drizzle-orm";

const ADMIN_ROLES = ["platform_admin", "super_admin"];
const RESOURCE = "scheduled_job";

// See custom-domains/routes.ts safeParse for why Input is widened to `any`
// instead of using z.ZodSchema<T> (Input=T): schemas with `.default(...)`
// fields need T inferred from the parsed *output*, not the optional *input*.
function safeParse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function scheduledJobRoutes(app: FastifyInstance): Promise<void> {
  // LIST all jobs for tenant
  app.get("/v1/admin/scheduled-jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const rows = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, "list"),
      // Wrapped in scopedRead() (db.transaction) so wrapWithTenantGuc injects
      // app.tenant_id before this read — a bare db.select() under FORCE RLS
      // returns zero rows with no GUC set.
      async () => scopedRead((tx) => tx.select().from(scheduledJobs).where(eq(scheduledJobs.tenantId, ctx.tenantId))),
    );
    return reply.send({ data: rows ?? [] });
  });

  // CREATE job
  app.post("/v1/admin/scheduled-jobs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = safeParse(createJobBody, req.body);
    const result = await commands.jobCreate(ctx, body);
    return reply.code(202).send(result);
  });

  // UPDATE job
  app.put("/v1/admin/scheduled-jobs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(jobIdParam, req.params);
    const body = safeParse(updateJobBody, req.body);
    const result = await commands.jobUpdate(ctx, id, body);
    return reply.code(202).send(result);
  });

  // DELETE job
  app.delete("/v1/admin/scheduled-jobs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(jobIdParam, req.params);
    const result = await commands.jobDelete(ctx, id);
    return reply.code(202).send(result);
  });

  // RUN NOW — trigger immediate execution
  app.post("/v1/admin/scheduled-jobs/:id/run-now", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(jobIdParam, req.params);
    const result = await commands.jobRunNow(ctx, id);
    return reply.code(202).send(result);
  });

  // PAUSE job
  app.post("/v1/admin/scheduled-jobs/:id/pause", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(jobIdParam, req.params);
    const result = await commands.jobPause(ctx, id);
    return reply.code(202).send(result);
  });

  // RESUME job
  app.post("/v1/admin/scheduled-jobs/:id/resume", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(jobIdParam, req.params);
    const result = await commands.jobResume(ctx, id);
    return reply.code(202).send(result);
  });

  // EXECUTION HISTORY — last 50 runs
  app.get("/v1/admin/scheduled-jobs/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(jobIdParam, req.params);
    // Wrapped in scopedRead() (db.transaction) so wrapWithTenantGuc injects
    // app.tenant_id before this read — a bare db.select() under FORCE RLS
    // returns zero rows with no GUC set.
    const rows = await scopedRead((tx) => tx.select().from(jobExecutionHistory)
      .where(and(eq(jobExecutionHistory.jobId, id), eq(jobExecutionHistory.tenantId, ctx.tenantId)))
      .orderBy(desc(jobExecutionHistory.startedAt))
      .limit(50));
    return reply.send({ data: rows });
  });
}
