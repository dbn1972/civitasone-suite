/**
 * Experiment Routes — GET /v1/ml/experiments, POST /v1/ml/experiments, PATCH /v1/ml/experiments/:id
 *
 * Manages A/B experiments for model comparison via traffic splitting.
 * List, create, and end experiments.
 *
 * Validates: Requirements 24.2, 24.5
 */

import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { mlExperiments } from "../training/schema.js";
import * as commands from "./commands.js";

const EXPERIMENT_ROLES = ["ml_admin", "super_admin"];

const VALID_DOMAINS = ["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"] as const;

const listExperimentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  domain: z.enum(VALID_DOMAINS).optional(),
  status: z.enum(["active", "completed", "cancelled"]).optional(),
});

const createExperimentBody = z.object({
  domain: z.enum(VALID_DOMAINS),
  name: z.string().min(1).max(255),
  challengerModelId: z.string().uuid(),
  currentModelId: z.string().uuid(),
  splitPct: z.number().int().min(1).max(99).default(50),
});

const endExperimentBody = z.object({
  status: z.enum(["completed", "cancelled"]),
});

const experimentIdParams = z.object({
  id: z.string().uuid(),
});

export async function experimentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/ml/experiments — List A/B experiments (paginated, tenant-scoped)
   * Requires: ml_admin
   */
  app.get("/v1/ml/experiments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPERIMENT_ROLES);

    const query = listExperimentsQuery.parse(req.query);
    const { page, pageSize, domain, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(mlExperiments.tenantId, ctx.tenantId)];
    if (domain) conditions.push(eq(mlExperiments.domain, domain));
    if (status) conditions.push(eq(mlExperiments.status, status));

    const whereClause = and(...conditions);

    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before these reads — a bare db.select() runs with no RLS GUC set.
    const { total, rows } = await db.transaction(async (tx) => {
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(mlExperiments)
        .where(whereClause);

      const experimentRows = await tx
        .select()
        .from(mlExperiments)
        .where(whereClause)
        .orderBy(desc(mlExperiments.createdAt))
        .limit(pageSize)
        .offset(offset);

      return { total: countResult?.count ?? 0, rows: experimentRows };
    });

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        domain: r.domain,
        name: r.name,
        challengerModelId: r.challengerModelId,
        currentModelId: r.currentModelId,
        splitPct: r.splitPct,
        status: r.status,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      meta: { page, pageSize, total },
    });
  });

  /**
   * POST /v1/ml/experiments — Create a new A/B experiment (CQRS — 202 Accepted)
   * Requires: ml_admin
   */
  app.post("/v1/ml/experiments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPERIMENT_ROLES);

    const body = createExperimentBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.experimentCreate(ctx, body));
  });

  /**
   * PATCH /v1/ml/experiments/:id — End an experiment (CQRS — 202 Accepted)
   * Requires: ml_admin
   */
  app.patch("/v1/ml/experiments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPERIMENT_ROLES);

    const { id } = experimentIdParams.parse(req.params);
    const body = endExperimentBody.parse(req.body);

    // Synchronous read validates state before enqueueing the command.
    await db.transaction(async (tx) => {
      const [experiment] = await tx
        .select()
        .from(mlExperiments)
        .where(and(eq(mlExperiments.id, id), eq(mlExperiments.tenantId, ctx.tenantId)))
        .limit(1);

      if (!experiment) {
        throw new HttpError(404, "NOT_FOUND", "experiment not found");
      }

      if (experiment.status !== "active") {
        throw new HttpError(422, "ALREADY_ENDED", `experiment is already ${experiment.status}`);
      }
    });

    sendAccepted(reply, acceptedResponseSchema, await commands.experimentEnd(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}
