// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  gradeAttempt, decidePass, canAttempt, issueCertificate, evaluateCertificateStatus,
  type GradableQuestion, type Qtype,
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
            await repo.insertQuestion(tx, {
                  id: qid, tenantId: p.tenantId, bankId: id, qtype: body.qtype,
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
            await repo.updatePassingScore(tx, p.tenantId, id, String(body.passingScore));
            break;
          }
          case "assessment_routes__4": {
            await repo.submitForApproval(tx, p.tenantId, id);
            break;
          }
          case "assessment_routes__5": {
            await repo.publishAssessment(tx, p.tenantId, id, msg.actorId);
            break;
          }
          case "assessment_routes__6": {
            await repo.retireAssessment(tx, p.tenantId, id);
            break;
          }
          case "assessment_routes__7": {
            await repo.insertAttempt(tx, {
                  id: attemptId, tenantId: p.tenantId, assessmentId: id, employeeId: body.employeeId,
                  attemptNo: priorCount + 1, status: "in_progress",
                });
            break;
          }
          case "assessment_routes__8": {
            const row = await repo.gradeAttemptRow(tx, p.tenantId, id, { score: String(graded.score), passed });
                  if (!row) return null; // lost the race — already graded
                  const awardById = new Map(graded.perQuestion.map((p) => [p.questionId, p.awarded]));
                  await repo.insertAnswers(tx, body.answers.map((ans) => ({
                    tenantId: p.tenantId, attemptId: id, questionId: ans.questionId,
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
                      tenantId: p.tenantId, assessmentId: a.id, attemptId: id, employeeId: attempt.employeeId,
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
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
