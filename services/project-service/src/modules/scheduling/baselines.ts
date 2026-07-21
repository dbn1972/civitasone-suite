/**
 * Baseline Snapshots — schema, domain, repo, and routes.
 *
 * A baseline captures the planned schedule (task dates, costs, WBS structure)
 * at a point in time. Max 20 baselines per project.
 *
 * EVM metrics are computed against the active (most recent) baseline.
 */

import { pgSchema, uuid, varchar, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { eq, and, count, desc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { tenantTransaction } from "@civitasone/db";

// ═══════════════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════════════

const projectSchema = pgSchema("project");

export const baselines = projectSchema.table("baselines", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  projectId:    uuid("project_id").notNull(),
  label:        varchar("label", { length: 255 }).notNull(),
  snapshotData: jsonb("snapshot_data").notNull(),
  createdBy:    uuid("created_by").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:      integer("version").notNull().default(1),
});

export type BaselineRow = typeof baselines.$inferSelect;
export type BaselineInsert = typeof baselines.$inferInsert;

export const baselinesSchema = { baselines };

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const MAX_BASELINES_PER_PROJECT = 20;

// ═══════════════════════════════════════════════════════════════════════════════
// Validators
// ═══════════════════════════════════════════════════════════════════════════════

const projectIdParam = z.object({
  id: z.string().uuid(),
});

const createBaselineBody = z.object({
  label: z.string().min(1).max(255),
  snapshotData: z.record(z.unknown()),
});

const listBaselinesQuery = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Repository
// ═══════════════════════════════════════════════════════════════════════════════

type DbLike = typeof db;

async function countBaselines(dbOrTx: DbLike, projectId: string, tenantId: string): Promise<number> {
  const [result] = await dbOrTx
    .select({ cnt: count() })
    .from(baselines)
    .where(and(eq(baselines.projectId, projectId), eq(baselines.tenantId, tenantId)));
  return result?.cnt ?? 0;
}

async function insertBaseline(dbOrTx: DbLike, input: BaselineInsert) {
  const [row] = await dbOrTx.insert(baselines).values(input).returning();
  return row;
}

async function listBaselineRows(projectId: string, tenantId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set.
  const [rows, totalResult] = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(baselines)
      .where(and(eq(baselines.projectId, projectId), eq(baselines.tenantId, tenantId)))
      .orderBy(desc(baselines.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await tx
      .select({ cnt: count() })
      .from(baselines)
      .where(and(eq(baselines.projectId, projectId), eq(baselines.tenantId, tenantId)));

    return [rows, totalResult] as const;
  });

  return {
    data: rows,
    meta: { page, pageSize: limit, total: totalResult?.cnt ?? 0 },
  };
}

export async function getLatestBaseline(dbOrTx: DbLike, projectId: string, tenantId: string): Promise<BaselineRow | undefined> {
  const [row] = await dbOrTx
    .select()
    .from(baselines)
    .where(and(eq(baselines.projectId, projectId), eq(baselines.tenantId, tenantId)))
    .orderBy(desc(baselines.createdAt))
    .limit(1);
  return row;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════════

const PROJ_ROLES = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];

export async function baselineRoutes(app: FastifyInstance): Promise<void> {

  // Local error handler — handles ZodError and HttpError within this scope
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")) {
      const zodErr = err as unknown as ZodError;
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: zodErr.issues.map((i: { path: Array<string | number>; message: string }) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });

  /**
   * POST /v1/projects/:id/baselines — create a baseline snapshot.
   * Max 20 baselines per project.
   */
  app.post("/v1/projects/:id/baselines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);

    const { id: projectId } = projectIdParam.parse(req.params);
    const body = createBaselineBody.parse(req.body);

    const row = await tenantTransaction(db, ctx.tenantId, async (tx) => {
      const txDb = tx as typeof db;

      // Check max 20 baselines per project
      const currentCount = await countBaselines(txDb, projectId, ctx.tenantId);
      if (currentCount >= MAX_BASELINES_PER_PROJECT) {
        throw new HttpError(422, "MAX_BASELINES_EXCEEDED", `maximum ${MAX_BASELINES_PER_PROJECT} baselines per project`);
      }

      return insertBaseline(txDb, {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        label: body.label,
        snapshotData: body.snapshotData,
        createdBy: ctx.actorId,
      });
    });

    return reply.code(201).send({ data: row });
  });

  /**
   * GET /v1/projects/:id/baselines — list baselines (newest first).
   */
  app.get("/v1/projects/:id/baselines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { id: projectId } = projectIdParam.parse(req.params);
    const q = listBaselinesQuery.parse(req.query);

    const result = await listBaselineRows(projectId, ctx.tenantId, q.page, q.limit);
    return reply.send(result);
  });
}
