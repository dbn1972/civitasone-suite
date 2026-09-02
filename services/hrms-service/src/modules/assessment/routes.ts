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
    await publishF3Write(ctx, "assessment_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "active" }) as any;
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
    await publishF3Write(ctx, "assessment_routes__1", qid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: qid }) as any;
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
    await publishF3Write(ctx, "assessment_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "draft" }) as any;
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
    // Synchronous pre-check, matching repo.updatePassingScore's own
    // `status = 'draft'` WHERE clause: publishF3Write is fire-and-forget, so
    // `row` below is always the { id, status, correlationId } placeholder,
    // never falsy and never carrying `passingScore` — the old
    // `if (!row) throw 409` could never fire, and `row.passingScore` was
    // always `undefined`.
    if (a.status !== "draft") {
      throw new HttpError(409, "INVALID_STATE", "passing score can only be changed while draft");
    }
    await publishF3Write(ctx, "assessment_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // `body.passingScore` is exactly what the consumer will persist.
    return reply.send({ id, passingScore: body.passingScore });
  });

  app.post("/v1/hrms/assessments/:id/submit-for-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await repo.getAssessment(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    // Synchronous pre-check, matching repo.submitForApproval's own
    // `status = 'draft'` WHERE clause — see the passing-score handler above
    // for why the old `if (!row) throw 409` was always dead code.
    if (a.status !== "draft") {
      throw new HttpError(409, "INVALID_STATE", "only a draft can be submitted for approval");
    }
    await publishF3Write(ctx, "assessment_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // draft → pending_approval is the only transition submitForApproval
    // performs, and the pre-check above guarantees it applies.
    return reply.send({ id, status: "pending_approval" });
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
    // Synchronous pre-check, matching repo.publishAssessment's own
    // `status = 'pending_approval'` WHERE clause — see the passing-score
    // handler above for why the old `if (!row) throw 409` was always dead
    // code, and why `row.status` / `row.approvedBy` were always `undefined`.
    if (a.status !== "pending_approval") {
      throw new HttpError(409, "INVALID_STATE", "only an assessment pending approval can be published");
    }
    await publishF3Write(ctx, "assessment_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // pending_approval → published is the only transition publishAssessment
    // performs, and `approvedBy` is always set to the caller (msg.actorId ===
    // ctx.actorId) — both deterministic given the pre-check above.
    return reply.send({ id, status: "published", approvedBy: ctx.actorId });
  });

  app.post("/v1/hrms/assessments/:id/retire", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    // This handler had no existence check at all — `row` (the publishF3Write
    // placeholder) was always truthy, so the `if (!row) throw 409` guard
    // below never fired for either a missing OR a non-published assessment,
    // and `row.status` was always `undefined`. Add the same existence +
    // status pre-check the other lifecycle transitions above use, matching
    // repo.retireAssessment's own `status = 'published'` WHERE clause.
    const a = await repo.getAssessment(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "assessment not found");
    if (a.status !== "published") {
      throw new HttpError(409, "INVALID_STATE", "only a published assessment can be retired");
    }
    await publishF3Write(ctx, "assessment_routes__6", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // published → retired is the only transition retireAssessment performs.
    return reply.send({ id, status: "retired" });
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
    // Reuse `attemptId` as the id passed to publishF3Write: the consumer
    // (f3-consumer.ts __7) inserts the new attempt row using the message's
    // `id` (i.e. whatever id is passed here), not the URL's :id — the same
    // id-mismatch class of bug called out in manpower-planning/routes.ts
    // __0. Minting a second, different randomUUID() here (as the code
    // previously did) meant this variable was dead and the id this handler
    // returned only happened to line up with the inserted row by coincidence
    // of both reading off the placeholder's `id` field.
    await publishF3Write(ctx, "assessment_routes__7", attemptId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // publishF3Write only ever resolves the { id, status, correlationId }
    // placeholder (see shared/f3-publish.ts) — it never carries `attemptNo`,
    // so `attempt.attemptNo` was always `undefined`, and `attempt.status`
    // was always the placeholder's "accepted", never the row's real
    // "in_progress". `priorCount` was already read synchronously just above
    // (for the attempt-limit check), so `priorCount + 1` is the same
    // attemptNo the consumer computes; "in_progress" is the only status
    // insertAttempt ever writes for a fresh attempt.
    //
    // KNOWN FOLLOW-UP (TOCTOU, not fixed here): `priorCount` is a snapshot
    // read at request time, and the consumer independently re-reads the same
    // count later, at actual write time (f3-consumer.ts __7). Two concurrent
    // start-attempt calls for the same (assessment, employeeId) can both read
    // the same `priorCount` and both report the same `attemptNo` here, while
    // the consumer's later, serialized re-read assigns them different
    // attemptNo values once both writes land — the number reported to the
    // caller can therefore be wrong under concurrency. This doesn't corrupt
    // DB state (each write still gets its own correct row), only the
    // synchronously-reported number can drift from it. Deliberately not
    // fixed in this pass — reserving the attempt slot synchronously needs its
    // own design thought, matching how interview-recording-routes.ts's
    // version-conflict race is disclosed rather than rushed.
    return reply.code(201).send({ id: attemptId, attemptNo: priorCount + 1, status: "in_progress" }) as any;
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

    // publishF3Write only ever resolves the { id, status, correlationId }
    // placeholder (see shared/f3-publish.ts), never the consumer's `{ score,
    // passed, certificate }` — `result.score` / `result.passed` /
    // `result.certificate` were always `undefined`, and the `if (!result)`
    // guard was always dead (the placeholder is always truthy).
    //
    // `graded`/`passed` above are pure recomputations over the same question
    // rows + submitted answers the consumer (f3-consumer.ts __8) uses, so —
    // per that file's own comment — they reproduce exactly the score it will
    // persist; safe to report synchronously. `certificate`, by contrast,
    // genuinely cannot be known here: it is only issued if `passed`, and even
    // then its certificateNo/verifyToken are minted inside the consumer and
    // its insert can lose a uniqueness race. Drop it from the response —
    // callers can read it back via GET /v1/hrms/attempts/:id once the write
    // has landed, which already returns `certificate` from
    // repo.getCertificateByAttempt.
    await publishF3Write(ctx, "assessment_routes__8", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "graded", score: graded.score, passed });
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
