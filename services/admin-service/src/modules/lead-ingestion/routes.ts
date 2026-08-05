/**
 * lead-ingestion — operator routes (admin-gated, tenant-scoped by RLS).
 *
 *   POST /v1/admin/integrations/:provider/:env/ingest       run one file-sweep now
 *   GET  /v1/admin/integrations/:provider/:env/ingestions   list recent runs (counts/status)
 *
 * These live under the same /v1/admin/integrations/:provider/:env prefix as the
 * integration-settings routes but are registered as their own plugin so they do
 * not disturb that module. Only provider='sftp' supports ingestion.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { ENV_SCOPES, isEnvScope } from "../integration-settings/providers.js";
import * as repo from "./repo.js";
import { runIngestion } from "./service.js";
import type { SftpIngestionRunRow } from "./schema.js";

const ROLES = [...TENANT_ADMIN_ROLES];

function parseTarget(params: unknown): { env: string } {
  const p = params as { provider?: string; env?: string };
  if (p.provider !== "sftp") {
    throw new HttpError(400, "UNSUPPORTED_PROVIDER", "lead ingestion is only supported for provider 'sftp'");
  }
  if (!p.env || !isEnvScope(p.env)) {
    throw new HttpError(400, "INVALID_ENV_SCOPE", `env must be one of: ${ENV_SCOPES.join(", ")}`);
  }
  return { env: p.env };
}

function serializeRun(r: SftpIngestionRunRow): Record<string, unknown> {
  return {
    id: r.id,
    provider: r.provider,
    env: r.env,
    status: r.status,
    filesSeen: r.filesSeen,
    rowsTotal: r.rowsTotal,
    rowsCreated: r.rowsCreated,
    rowsFailed: r.rowsFailed,
    error: r.error ?? null,
    startedAt: r.startedAt?.toISOString?.() ?? null,
    finishedAt: r.finishedAt?.toISOString?.() ?? null,
  };
}

export async function leadIngestionRoutes(app: FastifyInstance): Promise<void> {
  // ── run one file-sweep now ─────────────────────────────────────────────────
  app.post("/v1/admin/integrations/:provider/:env/ingest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { env } = parseTarget(req.params);
    const outcome = await runIngestion(ctx.tenantId, env, { correlationId: ctx.correlationId });
    if (outcome.status === "skipped") {
      return reply.code(409).send({ status: "skipped", reason: outcome.reason });
    }
    return reply.send({
      status: outcome.status,
      runId: outcome.runId,
      error: outcome.error ?? null,
      summary: outcome.summary
        ? {
            filesSeen: outcome.summary.filesSeen,
            filesIngested: outcome.summary.filesIngested,
            filesSkipped: outcome.summary.filesSkipped,
            rowsTotal: outcome.summary.rowsTotal,
            rowsCreated: outcome.summary.rowsCreated,
            rowsFailed: outcome.summary.rowsFailed,
            fileErrors: outcome.summary.fileErrors,
          }
        : null,
    });
  });

  // ── list recent runs ───────────────────────────────────────────────────────
  app.get("/v1/admin/integrations/:provider/:env/ingestions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { env } = parseTarget(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const rows = await repo.listRuns(ctx.tenantId, env, q.limit);
    return reply.send({ data: rows.map(serializeRun), meta: { total: rows.length } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
