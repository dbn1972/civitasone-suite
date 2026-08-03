import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Candidate resume versioning (checklist R-RA-0087) — multiple resume versions
 * with a single active version per candidate.
 *
 *   POST /v1/hrms/candidates/:id/resumes                       upload a new version
 *   GET  /v1/hrms/candidates/:id/resumes                       list versions (newest first)
 *   POST /v1/hrms/candidates/:id/resumes/:resumeId/activate    make a version active
 *
 * The resume file lives in object storage; only its key + metadata are stored
 * here. MIME type and size are validated server-side. The first version a
 * candidate uploads is automatically active; thereafter the uploader may pass
 * `makeActive` or switch later via the activate route.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { validateResumeUpload, resumeKeyPrefix, RESUME_MIME_TYPES } from "./resume-domain.js";
import { emitAudit } from "./audit-emit.js";
import * as candidateRepo from "./candidate-repo.js";
import * as repo from "./resume-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const resumeParams = z.object({ id: z.string().uuid(), resumeId: z.string().uuid() });

export async function candidateResumeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/candidates/:id/resumes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      fileKey: z.string().min(1).max(512),
      fileName: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(128),
      fileSizeBytes: z.coerce.number().int().positive(),
      fingerprint: z.string().max(128).optional(),
      label: z.string().max(120).optional(),
      makeActive: z.boolean().optional(),
    }).parse(req.body);

    await mustCandidate(ctx.tenantId, id);
    const errors = validateResumeUpload({ ...body, expectedKeyPrefix: resumeKeyPrefix(id) });
    if (errors.length > 0) throw new HttpError(422, "INVALID_RESUME", errors.join("; "));

    const rid = randomUUID();
    const result = await publishF3Write(ctx, "recruitment_resume_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({ id: rid, candidateId: id, versionNo: result.versionNo, isActive: result.isActive }) as any;
  });

  app.get("/v1/hrms/candidates/:id/resumes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await mustCandidate(ctx.tenantId, id);
    const rows = await repo.listResumes(ctx.tenantId, id);
    return reply.send({
      id,
      data: rows.map((r) => ({
        id: r.id, versionNo: r.versionNo, fileKey: r.fileKey, fileName: r.fileName,
        mimeType: r.mimeType, fileSizeBytes: r.fileSizeBytes.toString(),
        fingerprint: r.fingerprint ?? undefined, label: r.label ?? undefined,
        isActive: r.isActive, createdAt: r.createdAt,
      })),
    });
  });

  app.post("/v1/hrms/candidates/:id/resumes/:resumeId/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id, resumeId } = resumeParams.parse(req.params);
    await mustCandidate(ctx.tenantId, id);
    const resume = await repo.findResume(ctx.tenantId, id, resumeId);
    if (!resume) throw new HttpError(404, "NOT_FOUND", "resume version not found");
    const n = await publishF3Write(ctx, "recruitment_resume_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (n === 0) throw new HttpError(404, "NOT_FOUND", "resume version not found") as any;
    return reply.send({ id: resumeId, candidateId: id, versionNo: resume.versionNo, isActive: true });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    // A duplicate (tenant, candidate, version_no) from a concurrent upload race.
    if (String((err as { code?: string }).code) === "23505") {
      return reply.code(409).send({ code: "RESUME_CONFLICT", message: "a concurrent upload won the version race; please retry", correlationId });
    }
    // Honour Fastify's own client errors (e.g. FST_ERR_CTP_EMPTY_JSON_BODY = 400)
    // instead of masking them as a 500.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustCandidate(tenantId: string, id: string) {
    const c = await candidateRepo.findCandidate(tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
    return c;
  }
}

// Re-export for discoverability / symmetry with sibling modules.
export { RESUME_MIME_TYPES };
