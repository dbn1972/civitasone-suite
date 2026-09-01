import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  gradeAttempt, decidePass, canAttempt, issueCertificate, evaluateCertificateStatus,
  type GradableQuestion, type Qtype, type SubmittedAnswer,
} from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-assessment" });
export function registerF3_assessment_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "assessment_routes__0",
      "assessment_routes__1",
      "assessment_routes__2",
      "assessment_routes__3",
      "assessment_routes__4",
      "assessment_routes__5",
      "assessment_routes__6",
      "assessment_routes__7",
      "assessment_routes__8",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    // Every route calls `publishF3Write(ctx, op, randomUUID(), …)`, so `p.id`
    // (and therefore `id` above) is a FRESH uuid minted at publish time — it is
    // NEVER the `:id` from the URL. `id` is only safe as the primary key of a
    // brand-new row; anything that addresses an EXISTING row must use the path
    // param. `pathId` below is that value.
    const pathId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "assessment_routes__0": {
            await repo.insertBank(tx, {
                  id, tenantId: p.tenantId, title: body.title,
                  competencyRef: body.competencyRef ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "assessment_routes__1": {
            // `qid` (the new question's id) was referenced but never defined —
            // the generator dropped the route's `const qid = randomUUID()`.
            // The message-scoped `id` serves the same purpose and, unlike a
            // fresh randomUUID here, keeps the insert idempotent on redelivery.
            const qid = id;
            await repo.insertQuestion(tx, {
                  id: qid, tenantId: p.tenantId, bankId: pathId, qtype: body.qtype,
                  stem: body.stem, options: body.options, correct: body.correct, marks: String(body.marks),
                });
            break;
          }
          case "assessment_routes__2": {
            await repo.insertAssessment(tx, {
                  id, tenantId: p.tenantId, title: body.title, courseRef: body.courseRef ?? null,
                  bankId: body.bankId, passingScore: String(body.passingScore), durationMins: body.durationMins,
                  maxAttempts: body.maxAttempts, validityMonths: body.validityMonths ?? null,
                  status: "draft", createdBy: msg.actorId,
                });
            break;
          }
          case "assessment_routes__3": {
            await repo.updatePassingScore(tx, p.tenantId, pathId, String(body.passingScore));
            break;
          }
          case "assessment_routes__4": {
            await repo.submitForApproval(tx, p.tenantId, pathId);
            break;
          }
          case "assessment_routes__5": {
            await repo.publishAssessment(tx, p.tenantId, pathId, msg.actorId);
            break;
          }
          case "assessment_routes__6": {
            await repo.retireAssessment(tx, p.tenantId, pathId);
            break;
          }
          case "assessment_routes__7": {
            // `attemptId` and `priorCount` were referenced but never defined.
            // `priorCount` decides the attempt NUMBER written to the row, so
            // without it every "start attempt" call crashed here while the
            // route had already answered 201.
            const attemptId = id;
            const priorCount = await repo.countAttempts(p.tenantId, pathId, body.employeeId);
            await repo.insertAttempt(tx, {
                  id: attemptId, tenantId: p.tenantId, assessmentId: pathId, employeeId: body.employeeId,
                  attemptNo: priorCount + 1, status: "in_progress",
                });
            break;
          }
          case "assessment_routes__8": {
            // F3 codegen repair (same bug class as leave/f3-consumer.ts
            // `leave_policy_admin_routes__0`): the generator kept the grading
            // WRITES but dropped the whole grading COMPUTATION that
            // assessment/routes.ts ran before it was stubbed down to
            // publishF3Write(...). `attempt`, `a`, `bank`, `graded` and `passed`
            // were referenced but never defined, so submitting an assessment
            // attempt threw a ReferenceError on every call — after the route had
            // already answered 200 with a score. No answers were stored, no
            // attempt was graded, and no certificate was ever issued.
            //
            // gradeAttempt/decidePass are pure functions over the question rows
            // and the submitted answers, so recomputing here reproduces exactly
            // the score the caller was shown.
            const attemptId = pathId;
            const attempt = await repo.getAttempt(p.tenantId, attemptId);
            // The route already 404'd on a missing attempt and 409'd unless it
            // was still in_progress; if it changed underneath us, drop the write.
            if (!attempt) return null;
            const a = await repo.getAssessment(p.tenantId, attempt.assessmentId);
            if (!a) return null;
            const bank = await repo.getBank(p.tenantId, a.bankId);
            const qrows = await repo.listQuestions(p.tenantId, a.bankId);
            const gradable: GradableQuestion[] = qrows.map((q) => ({
              id: q.id, qtype: q.qtype as Qtype, correct: q.correct, marks: Number(q.marks),
            }));
            const graded = gradeAttempt(gradable, body.answers);
            const passed = decidePass(graded.score, Number(a.passingScore));

            const row = await repo.gradeAttemptRow(tx, p.tenantId, attemptId, { score: String(graded.score), passed });
                  if (!row) return null; // lost the race — already graded
                  const awardById = new Map(graded.perQuestion.map((pq) => [pq.questionId, pq.awarded]));
                  await repo.insertAnswers(tx, body.answers.map((ans: SubmittedAnswer) => ({
                    tenantId: p.tenantId, attemptId, questionId: ans.questionId,
                    response: ans.response, awardedMarks: String(awardById.get(ans.questionId) ?? 0),
                  })));

                  let certificate = null as null | { certificateNo: string; verifyToken: string };
                  if (passed) {
                    const cert = issueCertificate(
                      { validityMonths: a.validityMonths },
                      row,
                      {
                        certificateNo: `CERT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
                        verifyToken: randomUUID().replace(/-/g, ""),
                        issuedAt: new Date(),
                        validityMonths: a.validityMonths,
                      },
                    );
                    const inserted = await repo.insertCertificate(tx, {
                      tenantId: p.tenantId, assessmentId: a.id, attemptId, employeeId: attempt.employeeId,
                      certificateNo: cert.certificateNo, verifyToken: cert.verifyToken, validUntil: cert.validUntil,
                    });
                    // inserted === null ⇒ a certificate for this attempt already exists
                    // (UNIQUE attempt_id): idempotent no-op, do NOT re-emit the event.
                    if (inserted) {
                      certificate = { certificateNo: inserted.certificateNo, verifyToken: inserted.verifyToken };
                      await enqueue(tx, {
                        topic: EVENTS.certificateIssued,
                        eventType: EVENTS.certificateIssued,
                        tenantId: p.tenantId,
                        actorId: msg.actorId,
                        correlationId: msg.correlationId,
                        payload: {
                          tenant_id: p.tenantId,
                          employee_id: attempt.employeeId,
                          assessment_id: a.id,
                          certificate_no: inserted.certificateNo,
                          competency_ref: bank?.competencyRef ?? null,
                        },
                      });
                    }
                  }
                  return { score: graded.score, passed, certificate };
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
