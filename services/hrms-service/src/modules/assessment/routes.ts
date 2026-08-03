import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import {
  gradeAttempt, decidePass, canAttempt, issueCertificate, evaluateCertificateStatus,
  type GradableQuestion, type Qtype,
} from "./domain.js";
import {
  createBankBody, createQuestionBody, createAssessmentBody,
  updatePassingScoreBody, startAttemptBody, submitAttemptBody,
} from "./validators.js";
import * as repo from "./repo.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

const idParam = z.object({ id: z.string().uuid() });

export async function assessmentRoutes(app: FastifyInstance): Promise<void> {
  // ── Question banks ──────────────────────────────────────────────
  app.get("/v1/hrms/assessment/question-banks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send(await repo.listBanks(ctx.tenantId));
  });

  app.post("/v1/hrms/assessment/question-banks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createBankBody.parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "assessment_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "active" });
  });

  app.get("/v1/hrms/assessment/question-banks/:id/questions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await repo.listQuestions(ctx.tenantId, id));
  });

  // Adding a question to a bank is a question-bank change → maker-checker:
  // the actor must NOT be the bank's creator.
  app.post("/v1/hrms/assessment/question-banks/:id/questions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createQuestionBody.parse(req.body);
    const bank = await repo.getBank(ctx.tenantId, id);
    if (!bank) throw new HttpError(404, "NOT_FOUND", "question bank not found");
    if (bank.createdBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER", "question-bank change requires a checker different from the bank creator");
    }
    const qid = randomUUID();
    await publishF3Write(ctx, "assessment_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: qid });
  });

  // ── Assessments lifecycle ───────────────────────────────────────
  app.get("/v1/hrms/assessments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send(await repo.listAssessments(ctx.tenantId));
  });

  app.post("/v1/hrms/assessments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createAssessmentBody.parse(req.body);
    const bank = await repo.getBank(ctx.tenantId, body.bankId);
    if (!bank) throw new HttpError(404, "NOT_FOUND", "question bank not found");
    const id = randomUUID();
    await publishF3Write(ctx, "assessment_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "draft" });
  });

  app.get("/v1/hrms/assessments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getAssessment(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    return reply.send(row);
  });

  // Passing-score change → maker-checker: actor must differ from the creator.
  app.patch("/v1/hrms/assessments/:id/passing-score", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updatePassingScoreBody.parse(req.body);
    const a = await repo.getAssessment(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    if (a.createdBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER", "passing-score change requires a checker different from the assessment creator");
    }
    const row = await publishF3Write(ctx, "assessment_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "passing score can only be changed while draft");
    return reply.send({ id, passingScore: row.passingScore });
  });

  app.post("/v1/hrms/assessments/:id/submit-for-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await repo.getAssessment(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    const row = await publishF3Write(ctx, "assessment_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only a draft can be submitted for approval");
    return reply.send({ id, status: row.status });
  });

  // Publish → maker-checker: the approver (checker) must NOT be the creator.
  app.post("/v1/hrms/assessments/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await repo.getAssessment(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    if (a.createdBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER", "publish requires an approver different from the creator");
    }
    const row = await publishF3Write(ctx, "assessment_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only an assessment pending approval can be published");
    return reply.send({ id, status: row.status, approvedBy: row.approvedBy });
  });

  app.post("/v1/hrms/assessments/:id/retire", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await publishF3Write(ctx, "assessment_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only a published assessment can be retired");
    return reply.send({ id, status: row.status });
  });

  // ── Attempts ────────────────────────────────────────────────────
  app.post("/v1/hrms/assessments/:id/attempts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = startAttemptBody.parse(req.body);
    const a = await repo.getAssessment(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    if (a.status !== "published") throw new HttpError(409, "NOT_PUBLISHED", "assessment is not published");
    const priorCount = await repo.countAttempts(ctx.tenantId, id, body.employeeId);
    if (!canAttempt(priorCount, a.maxAttempts)) {
      throw new HttpError(409, "ATTEMPT_LIMIT", "maximum attempts exhausted");
    }
    const attemptId = randomUUID();
    const attempt = await publishF3Write(ctx, "assessment_routes__7", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: attempt.id, attemptNo: attempt.attemptNo, status: attempt.status });
  });

  app.post("/v1/hrms/attempts/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitAttemptBody.parse(req.body);
    const attempt = await repo.getAttempt(ctx.tenantId, id);
    if (!attempt) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    if (attempt.status !== "in_progress") throw new HttpError(409, "INVALID_STATE", "attempt is not in progress");
    const a = await repo.getAssessment(ctx.tenantId, attempt.assessmentId);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    const bank = await repo.getBank(ctx.tenantId, a.bankId);
    const qrows = await repo.listQuestions(ctx.tenantId, a.bankId);

    const gradable: GradableQuestion[] = qrows.map((q) => ({
      id: q.id, qtype: q.qtype as Qtype, correct: q.correct, marks: Number(q.marks),
    }));
    const graded = gradeAttempt(gradable, body.answers);
    const passed = decidePass(graded.score, Number(a.passingScore));

    const result = await publishF3Write(ctx, "assessment_routes__8", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!result) throw new HttpError(409, "INVALID_STATE", "attempt already submitted");
    return reply.send({ id, status: "graded", score: result.score, passed: result.passed, certificate: result.certificate });
  });

  app.get("/v1/hrms/attempts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const attempt = await repo.getAttempt(ctx.tenantId, id);
    if (!attempt) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    const cert = await repo.getCertificateByAttempt(ctx.tenantId, id);
    return reply.send({ ...attempt, certificate: cert ?? null });
  });

  // ── Certificate verification ────────────────────────────────────
  app.get("/v1/hrms/assessment/certificates/verify/:token", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { token } = z.object({ token: z.string().min(8).max(64) }).parse(req.params);
    const cert = await repo.getCertificateByToken(token);
    if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
    const status = evaluateCertificateStatus(
      { status: cert.status, validUntil: cert.validUntil },
      new Date(),
    );
    return reply.send({
      certificateNo: cert.certificateNo, employeeId: cert.employeeId,
      assessmentId: cert.assessmentId, issuedAt: cert.issuedAt, validUntil: cert.validUntil,
      status,
    });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
