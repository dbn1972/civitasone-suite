import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  RiskSummaryListSchema,
  BreakglassSummaryListSchema,
  AuditExportJobListSchema,
} from "@civitasone/schemas/web";
import { listQuerySchema } from "@civitasone/schemas/common";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as riskQueries from "../risk/queries.js";
import * as exportsRepo from "../exports/repo.js";

const READER_ROLES = ["audit_officer", "audit_admin", "finance_admin", "super_admin", "platform_admin"];

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/risks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const risks = await riskQueries.listRisks(ctx.tenantId, q.limit);
    sendValidated(reply, RiskSummaryListSchema, risks);
  });

  app.get("/v1/audit/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, BreakglassSummaryListSchema, []);
  });

  app.get("/v1/audit/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await exportsRepo.listExportsByTenant(ctx.tenantId, q.limit);
    const jobs = rows.map((row) => ({
      id: row.id,
      jobType: `${new Date(row.periodFrom as unknown as string).toISOString().slice(0, 7)}-export`,
      requestedBy: row.createdBy,
      requestedAt: new Date(row.createdAt as unknown as string).toISOString(),
      completedAt: row.status === "completed" ? new Date(row.updatedAt as unknown as string).toISOString() : undefined,
      format: (["pdf", "xlsx", "csv"].includes(row.format) ? row.format : "pdf") as "pdf" | "xlsx" | "csv",
      status: (
        row.status === "pending" ? "queued" :
        row.status === "completed" ? "completed" :
        row.status === "failed" ? "failed" :
        "processing"
      ) as "queued" | "processing" | "completed" | "failed",
      downloadUrl: row.signedUrl ?? undefined,
    }));
    sendValidated(reply, AuditExportJobListSchema, jobs);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
