/**
 * External integration seam endpoints (2C — X02 AI, X03 Proctoring, X05 eSign).
 *
 * Each returns 501 with `{ source: "stub" }` when the adapter is not wired, so a
 * client knows the capability exists but is honestly unavailable. When wired, the
 * feature flag gates the rollout; the stub is replaced by the real adapter.
 *
 *   POST /v1/hrms/recruitment/ai/parse-resume         X02
 *   POST /v1/hrms/recruitment/ai/jd-match             X02
 *   POST /v1/hrms/recruitment/ai/generate-questions   X02
 *   POST /v1/hrms/recruitment/proctoring/start        X03
 *   POST /v1/hrms/recruitment/proctoring/end          X03
 *   POST /v1/hrms/recruitment/esign                   X05
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  aiEnabled, aiStub, proctoringEnabled, proctoringStub, eSignEnabled, eSignStub,
} from "./external-seams.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];

export async function externalSeamRoutes(app: FastifyInstance): Promise<void> {
  // ── X02 AI ──
  app.post("/v1/hrms/recruitment/ai/parse-resume", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ fileKey: z.string().min(1) }).parse(req.body);
    if (!aiEnabled(process.env)) return reply.code(501).send({ code: "AI_NOT_ENABLED", source: "stub", message: "AI resume parsing is not available (adapter not wired)" });
    const result = await aiStub.parseResume(body.fileKey);
    return reply.send({ data: result });
  });

  app.post("/v1/hrms/recruitment/ai/jd-match", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ applicationId: z.string().uuid(), jobOpeningId: z.string().uuid() }).parse(req.body);
    if (!aiEnabled(process.env)) return reply.code(501).send({ code: "AI_NOT_ENABLED", source: "stub", message: "AI JD-match is not available" });
    const result = await aiStub.matchJd(body.applicationId, body.jobOpeningId);
    return reply.send({ data: result });
  });

  app.post("/v1/hrms/recruitment/ai/generate-questions", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const body = z.object({ jobOpeningId: z.string().uuid(), count: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.body);
    if (!aiEnabled(process.env)) return reply.code(501).send({ code: "AI_NOT_ENABLED", source: "stub", message: "AI question generation is not available" });
    const result = await aiStub.generateQuestions(body);
    return reply.send({ data: result });
  });

  // ── X03 Proctoring ──
  app.post("/v1/hrms/recruitment/proctoring/start", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = z.object({ interviewId: z.string().uuid(), candidateId: z.string().uuid() }).parse(req.body);
    if (!proctoringEnabled(process.env)) return reply.code(501).send({ code: "PROCTORING_NOT_ENABLED", source: "stub", message: "remote proctoring is not available (adapter not wired)" });
    const result = await proctoringStub.startSession(body);
    return reply.send({ data: result });
  });

  app.post("/v1/hrms/recruitment/proctoring/end", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = z.object({ sessionId: z.string().min(1) }).parse(req.body);
    if (!proctoringEnabled(process.env)) return reply.code(501).send({ code: "PROCTORING_NOT_ENABLED", source: "stub", message: "remote proctoring is not available" });
    const result = await proctoringStub.endSession(body.sessionId);
    return reply.send({ data: result });
  });

  // ── X05 eSign ──
  app.post("/v1/hrms/recruitment/esign", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const body = z.object({ documentKey: z.string().min(1), signerRole: z.string().min(1).max(32) }).parse(req.body);
    if (!eSignEnabled(process.env)) return reply.code(501).send({ code: "ESIGN_NOT_ENABLED", source: "stub", message: "eSign is not available (DSC adapter not wired)" });
    const result = await eSignStub.signDocument(body);
    return reply.send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
