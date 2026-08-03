import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as projectRepo from "../project/repo.js";
import * as commands from "./commands.js";

const PROJECT_ROLES = ["project_manager", "project_officer", "project_admin", "super_admin"];

const createBody = z.object({
  fileName: z.string().min(1).max(255),
  fileUrl: z.string().url(),
  fileType: z.string().min(1).max(64),
  notes: z.string().max(1000).optional(),
});

function toDto(row: repo.EvidenceRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    milestoneId: row.milestoneId,
    fileName: row.fileName ?? row.fileKey,
    fileUrl: row.fileKey,
    fileType: "document",
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    notes: null,
  };
}

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects/milestones/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJECT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = createBody.parse(req.body);

    const milestone = await projectRepo.findMilestoneById(id, ctx.tenantId);
    if (!milestone) {
      throw new HttpError(404, "NOT_FOUND", "milestone not found");
    }

    return reply.code(202).send(await commands.attachEvidence(ctx, id, {
      fileName: body.fileName,
      fileUrl: body.fileUrl,
      fileType: body.fileType,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    }));
  });

  app.get("/v1/projects/milestones/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJECT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await repo.listByMilestone(ctx.tenantId, id);
    return reply.send({ data: rows.map(toDto) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
