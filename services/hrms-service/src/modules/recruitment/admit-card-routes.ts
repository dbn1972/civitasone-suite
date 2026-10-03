/**
 *   GET /v1/hrms/assessments/attempts/:id/admit-card   HR / invigilator roles
 *
 * Returns the structured admit card (roll number, candidate, sitting window, instructions) that
 * the web renders as a printable page. Read-only; no PDF renderer is involved.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { buildAdmitCard, admitCardBlockedReason } from "./admit-card.js";
import * as attemptRepo from "./attempt-repo.js";
import * as screeningRepo from "./screening-repo.js";
import * as candidateRepo from "./candidate-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function admitCardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/assessments/attempts/:id/admit-card", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await attemptRepo.findAttempt(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    const s = await attemptRepo.findSchedule(ctx.tenantId, a.scheduleId);
    if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
    const blocked = admitCardBlockedReason(s.status, a.status);
    if (blocked) throw new HttpError(409, "ADMIT_CARD_UNAVAILABLE", blocked);
    const application = a.applicationId ? await screeningRepo.findApplication(ctx.tenantId, a.applicationId) : null;
    const candidate = application ? null : await candidateRepo.findCandidate(ctx.tenantId, a.candidateId);
    const candidateName = application?.applicantName ?? candidate?.fullName ?? null;
    if (!candidateName) throw new HttpError(409, "ADMIT_CARD_UNAVAILABLE", "the candidate has no recorded name");
    return reply.send({
      data: buildAdmitCard({
        attemptId: a.id, scheduleId: s.id, attemptStatus: a.status, scheduleStatus: s.status,
        candidateName, applicationNo: application?.applicationNo ?? null,
        scheduleTitle: s.title, mode: s.mode, windowStart: s.windowStart, windowEnd: s.windowEnd,
        slotLabel: a.slotLabel, identityVerified: a.identityVerified,
      }),
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
