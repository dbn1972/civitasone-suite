import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { emitAudit } from "./audit-emit.js";

// ---- domain helpers ---------------------------------------------------------
// NOTE (import aliasing, see the header comment on the consumer below): every
// namespace import gets a UNIQUE alias. The generated file declared `import * as
// repo` ~25 times against different modules, which is invalid ESM; tsc's emit
// silently kept only the FIRST (attempt-repo) and dropped the rest, so every
// `repo.X()` in this file resolved against attempt-repo regardless of which
// module the case meant.
import {
  randomizeQuestionOrder, attemptDeadline, scoreObjective, computeAttemptResult,
  type PaperEntry, type ObjectiveScore,
} from "./attempt-domain.js";
import {
  aggregateEvaluations, consolidatedScores, applyModeration, resultAfterModeration,
  type Moderation,
} from "./result-domain.js";
// currentStageRole / isFinalStage / ApprovalStage live in requisition-domain;
// offer-domain merely re-exports them, so they are imported once from the source.
import {
  DEFAULT_GOVT_CHAIN, currentStageRole, isFinalStage, cloneFields, toVacancyType,
  type ApprovalStage,
} from "./requisition-domain.js";
import { DEFAULT_OFFER_CHAIN, computeCompensation } from "./offer-domain.js";
import { normalizeEmail, mobileDedupKey } from "./candidate.js";
import { autoScreenDecision } from "./screening.js";
import { assessFee } from "./application-fee.js";
import { commsEnabled, resolveDispatch, buildCommMessage, type InterviewCommType } from "./interview-comms.js";
import { computeRetentionUntil, DEFAULT_RETENTION_DAYS } from "./interview-recording.js";
import { initialStatus, type ResponseType } from "./interview-response.js";
import { computePanelScore, type Competency, type InterviewerScore } from "./interview-scoring.js";
import { evaluateEligibility, type EligibilityCriteria, type Applicant } from "./eligibility.js";
import { totalMarks as blueprintTotalMarks } from "./blueprint-domain.js";

// ---- repositories (one unique alias per module) ------------------------------
import * as feeRepo from "./application-fee-repo.js";
import * as attemptRepo from "./attempt-repo.js";
import * as blueprintRepo from "./blueprint-repo.js";
import * as candidateRepo from "./candidate-repo.js";
import * as coreRepo from "./repo.js";
import * as eligibilityRepo from "./eligibility-repo.js";
import * as ivRepo from "./interview-comms-repo.js";
import * as recordingRepo from "./interview-recording-repo.js";
import * as responseRepo from "./interview-response-repo.js";
import * as scoringRepo from "./interview-scoring-repo.js";
import * as offerRepo from "./offer-repo.js";
import * as otpRepo from "./otp-verify-repo.js";
import { OTP_TTL_SECONDS } from "./otp-verify.js";
import * as panelRepo from "./panel-repo.js";
import * as publicationRepo from "./publication-repo.js";
import * as qualificationRepo from "./qualification-repo.js";
import * as referenceRepo from "./reference-repo.js";
import * as noticeRepo from "./rejection-notice-repo.js";
import * as requisitionRepo from "./requisition-repo.js";
import * as reservationRepo from "./reservation-repo.js";
import * as resultRepo from "./result-repo.js";
import * as resumeRepo from "./resume-repo.js";
import * as overrideRepo from "./screening-override-repo.js";
import * as screeningRepo from "./screening-repo.js";
import * as selectionRepo from "./selection-repo.js";
import * as skillsRepo from "./skills-repo.js";

const log = pino({ name: "hrms-f3-recruitment" });

/** Deliberate non-shortlist decisions bulk shortlist must not overturn (mirrors screening-routes). */
const BULK_SHORTLIST_BLOCKED = new Set(["ineligible", "waitlisted", "manual_review"]);
/** Route interview mode -> DB CHECK domain (mirrors interview-routes). */
const MODE_DB: Record<string, string> = { in_person: "in_person", video: "video", phone: "telephonic" };
/** Scorecard recommendation -> DB recommendation CHECK domain (mirrors interview-routes). */
const RECO_DB: Record<string, string | null> = {
  strong_hire: "strong_hire", hire: "hire", no_hire: "no_hire", strong_no_hire: "no_hire",
};

/** Candidate profile fields carried straight through to a DB patch (mirrors candidate-routes). */
function pickProfile(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["fullName", "dateOfBirth", "gender", "maritalStatus", "nationality", "guardianName",
    "correspondenceAddress", "permanentAddress", "category", "subCategory", "disability", "exServiceman",
    "activeResumeRef", "resumeFingerprint"]) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

/** `body` is the RAW pre-Zod request body, so numeric coercion is applied explicitly. */
const numOr = (v: unknown, fallback: number): number => (v == null || v === "" ? fallback : Number(v));
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
/** Coerce a `Record<string, number-ish>` (reservation / roster / relaxation maps). */
function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, n] of Object.entries(v as Record<string, unknown>)) out[k] = Number(n);
  return out;
}

/** Rebuild the vacancy eligibility criteria the route's Zod schema produced. */
function toCriteria(body: Record<string, any>): EligibilityCriteria {
  return {
    ...(body.ageMin != null ? { ageMin: Number(body.ageMin) } : {}),
    ...(body.ageMax != null ? { ageMax: Number(body.ageMax) } : {}),
    ...(body.cutoffDate ? { cutoffDate: String(body.cutoffDate) } : {}),
    ...(body.experienceMinYears != null ? { experienceMinYears: Number(body.experienceMinYears) } : {}),
    ...(Array.isArray(body.allowedQualifications) ? { allowedQualifications: body.allowedQualifications as string[] } : {}),
    ...(body.categoryAgeRelaxation != null ? { categoryAgeRelaxation: numRecord(body.categoryAgeRelaxation) } : {}),
    ...(body.allowMultiple != null ? { allowMultiple: Boolean(body.allowMultiple) } : {}),
  } as EligibilityCriteria;
}

/**
 * F3 leftover write consumer for the recruitment module.
 *
 * TWO defects were fixed here (both introduced by the F3 code-gen that moved each
 * route's WRITE off the request path onto this queue):
 *
 * 1. DUPLICATE `repo` IMPORTS. The generated file declared `import * as repo`
 *    ~25 times, each against a different module (attempt / requisition /
 *    screening / offer / candidate / panel / ...). That is invalid ESM — Node
 *    refuses it with `SyntaxError: Identifier 'repo' has already been declared`
 *    — but `tsc`'s emit (under the file's `@ts-nocheck`) silently kept only the
 *    FIRST declaration (`./attempt-repo.js`) and dropped the other 24. In the
 *    compiled production build every `repo.X(...)` in this file therefore called
 *    ATTEMPT-repo, whatever module the case actually meant: mostly a
 *    `TypeError: repo.X is not a function`, and — where a name happened to
 *    coincide — a silent write against the WRONG TABLE. The same collision
 *    existed on the named imports (`currentStageRole` / `isFinalStage` /
 *    `ApprovalStage` / `PaperEntry` / `scoreObjective` / ... each imported
 *    twice). Every namespace import now has a unique alias and every case calls
 *    the repository its route belongs to.
 *
 * 2. DROPPED PREAMBLES. The code-gen lifted only the write statements, dropping
 *    each handler's "fetch the record + compute the derived values" setup, so
 *    most cases referenced locals (`r`, `a`, `o`, `iv`, `chain`, `role`,
 *    `final`, `patch`, `paper`, `result`, ...) that are declared nowhere in this
 *    file. Each threw a ReferenceError on first use — after the HTTP route had
 *    already replied 200/201, so every one of those writes was a FAKE SUCCESS.
 *    The preambles are restored below, mirroring the corresponding `*-routes.ts`
 *    handler.
 *
 * Conventions used throughout:
 *  - `body` is the RAW pre-Zod body forwarded through the queue, so every Zod
 *    `.default(...)` / `z.coerce` is applied explicitly here.
 *  - `id` is the entity the route addressed (`params.id`). `genId` is the id the
 *    route GENERATED for a newly created row and returned to the client — the
 *    routes now publish it as the envelope payload's `id` (they previously
 *    published a throwaway `randomUUID()`, which would have persisted every new
 *    row under an id the caller could never fetch).
 *  - Validation/authorisation that the route already performed before publishing
 *    is NOT repeated; only the lookups and derivations the write itself needs
 *    are restored, plus a not-found guard so a vanished parent row surfaces as a
 *    failed message rather than a bad write.
 */
export function registerF3_recruitment_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "recruitment_application_fee_routes__0",
      "recruitment_application_fee_routes__1",
      "recruitment_attempt_routes__0",
      "recruitment_attempt_routes__1",
      "recruitment_attempt_routes__2",
      "recruitment_attempt_routes__3",
      "recruitment_attempt_routes__4",
      "recruitment_attempt_routes__5",
      "recruitment_attempt_routes__6",
      "recruitment_attempt_routes__7",
      "recruitment_blueprint_routes__0",
      "recruitment_blueprint_routes__1",
      "recruitment_blueprint_routes__2",
      "recruitment_blueprint_routes__3",
      "recruitment_blueprint_routes__4",
      "recruitment_blueprint_routes__5",
      "recruitment_blueprint_routes__6",
      "recruitment_blueprint_routes__7",
      "recruitment_candidate_routes__0",
      "recruitment_candidate_routes__1",
      "recruitment_candidate_routes__2",
      "recruitment_candidate_routes__3",
      "recruitment_candidate_routes__4",
      "recruitment_candidate_routes__5",
      "recruitment_candidate_routes__6",
      "recruitment_eligibility_routes__0",
      "recruitment_eligibility_routes__1",
      "recruitment_eligibility_routes__2",
      "recruitment_interview_comms_routes__0",
      "recruitment_interview_recording_routes__0",
      "recruitment_interview_recording_routes__1",
      "recruitment_interview_response_routes__0",
      "recruitment_interview_response_routes__1",
      "recruitment_interview_response_routes__2",
      "recruitment_interview_routes__0",
      "recruitment_interview_routes__1",
      "recruitment_interview_scoring_routes__0",
      "recruitment_interview_scoring_routes__1",
      "recruitment_interview_scoring_routes__2",
      "recruitment_offer_extra_routes__0",
      "recruitment_offer_extra_routes__1",
      "recruitment_offer_extra_routes__2",
      "recruitment_offer_routes__0",
      "recruitment_offer_routes__1",
      "recruitment_offer_routes__2",
      "recruitment_offer_routes__3",
      "recruitment_offer_routes__4",
      "recruitment_offer_routes__5",
      "recruitment_offer_routes__6",
      "recruitment_offer_routes__7",
      "recruitment_offer_routes__8",
      "recruitment_offer_routes__9",
      "recruitment_otp_verify_routes__0",
      "recruitment_otp_verify_routes__1",
      "recruitment_otp_verify_routes__2",
      "recruitment_panel_routes__0",
      "recruitment_panel_routes__1",
      "recruitment_panel_routes__2",
      "recruitment_publication_routes__0",
      "recruitment_publication_routes__1",
      "recruitment_publication_routes__2",
      "recruitment_publication_routes__3",
      "recruitment_qualification_routes__0",
      "recruitment_reference_routes__0",
      "recruitment_reference_routes__1",
      "recruitment_reference_routes__2",
      "recruitment_rejection_notice_routes__0",
      "recruitment_report_routes__0",
      "recruitment_report_routes__1",
      "recruitment_requisition_routes__0",
      "recruitment_requisition_routes__1",
      "recruitment_requisition_routes__2",
      "recruitment_requisition_routes__3",
      "recruitment_requisition_routes__4",
      "recruitment_requisition_routes__5",
      "recruitment_requisition_routes__6",
      "recruitment_requisition_routes__7",
      "recruitment_requisition_routes__8",
      "recruitment_requisition_routes__9",
      "recruitment_requisition_routes__10",
      "recruitment_reservation_routes__0",
      "recruitment_reservation_routes__1",
      "recruitment_result_routes__0",
      "recruitment_result_routes__1",
      "recruitment_result_routes__2",
      "recruitment_result_routes__3",
      "recruitment_result_routes__4",
      "recruitment_result_routes__5",
      "recruitment_resume_routes__0",
      "recruitment_resume_routes__1",
      "recruitment_screening_override_routes__0",
      "recruitment_screening_override_routes__1",
      "recruitment_screening_override_routes__2",
      "recruitment_screening_override_routes__3",
      "recruitment_screening_routes__0",
      "recruitment_screening_routes__1",
      "recruitment_screening_routes__2",
      "recruitment_screening_routes__3",
      "recruitment_selection_routes__0",
      "recruitment_selection_routes__1",
      "recruitment_selection_routes__2",
      "recruitment_selection_routes__3",
      "recruitment_selection_routes__4",
      "recruitment_skills_routes__0",
      "recruitment_skills_routes__1",
      "recruitment_skills_routes__2",
      "recruitment_skills_routes__3",
    ]);
    if (!ops.has(op)) return;
    const body = (p.body ?? {}) as Record<string, any>;
    const params = (p.params ?? {}) as Record<string, any>;
    /** The entity the route path addressed (`:id`). */
    const id = (params.id as string) || (p.id as string);
    /** The id the route generated for a NEW row and returned to the caller. */
    const genId = (p.id as string) || randomUUID();
    const offerId = params.offerId as string;
    const reqId = params.reqId as string;
    const auditCtx = { tenantId: String(p.tenantId), actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "recruitment_application_fee_routes__0": {
            // Restored: the application (for job opening + category), the vacancy
            // fee, the assessment, and the new fee row's id.
            const a = await screeningRepo.findApplication(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
            // The route's own pre-check can race; the fee row is unique per
            // application, so re-check inside the write transaction.
            if (await feeRepo.findFee(p.tenantId, id)) return;
            const vacancyFee = await feeRepo.getVacancyFee(p.tenantId, a.jobOpeningId);
            const assessment = assessFee(vacancyFee, { category: a.category, categoryVerified: Boolean(body.categoryVerified ?? false) });
            const fid = genId;
            await feeRepo.insertFee(tx, {
                    id: fid, tenantId: p.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
                    amountMinor: assessment.amountMinor, currency: "INR", status: assessment.status,
                    exemptionReason: assessment.exemptionReason, provider: "none",
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_application_fee_routes__1": {
            // Restored: the assessed fee row and the trimmed manual payment ref.
            const fee = await feeRepo.findFee(p.tenantId, id);
            if (!fee) throw new HttpError(404, "NOT_FOUND", "no fee has been assessed for this application");
            const paymentRef = String(body.paymentRef ?? "").trim();
            await feeRepo.updateFee(tx, p.tenantId, fee.id, {
                      status: "paid", provider: "manual", paymentRef, paidAt: new Date(), updatedBy: msg.actorId,
                    }, fee.version);
                    await emitAudit(tx, auditCtx, "application_fee_paid", "application_fee", fee.id, {
                      applicationId: id, amountMinor: fee.amountMinor.toString(), provider: "manual", paymentRef,
                    });
            break;
          }
          case "recruitment_attempt_routes__0": {
            // Restored: the assembled IMMUTABLE paper (a snapshot of each
            // validated question) and its total marks. The route already
            // validated section counts / duplicates / blueprint status.
            const scheduleId = genId;
            const blueprint = await blueprintRepo.findBlueprint(p.tenantId, body.blueprintId);
            if (!blueprint) throw new HttpError(404, "NOT_FOUND", "blueprint not found");
            const paper: Array<PaperEntry & { stem: string; options: unknown }> = [];
            let totalMarks = 0;
            for (const q of (body.questions ?? []) as Array<{ questionId: string; section: string }>) {
              const question = await blueprintRepo.findQuestion(p.tenantId, q.questionId);
              if (!question) throw new HttpError(404, "QUESTION_NOT_FOUND", `question ${q.questionId} not found`);
              paper.push({
                questionId: question.id, section: q.section, marks: question.marks, qtype: question.qtype,
                stem: question.stem, options: question.options, answerKey: question.answerKey as never,
              });
              totalMarks += question.marks;
            }
            await attemptRepo.insertSchedule(tx, {
                  id: scheduleId, tenantId: p.tenantId, blueprintId: body.blueprintId, title: body.title, mode: body.mode ?? "online",
                  windowStart: new Date(body.windowStart), windowEnd: new Date(body.windowEnd),
                  slots: (body.slots ?? []) as never, paper: paper as never, totalMarks, status: "scheduled",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "recruitment_attempt_routes__1": {
            // Restored: the schedule and the target status. open/close/cancel all
            // publish this one op, so the transition cannot be derived from the
            // current status (`scheduled` is a legal source for all three) — the
            // route now carries it on the payload as `nextStatus`.
            const s = await attemptRepo.findSchedule(p.tenantId, id);
            if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
            const to = String(p.nextStatus ?? "");
            if (!to) throw new HttpError(422, "MISSING_TRANSITION", "the schedule transition target is missing from the payload");
            await attemptRepo.updateSchedule(tx, p.tenantId, id, { status: to, updatedBy: msg.actorId }, s.version);
            break;
          }
          case "recruitment_attempt_routes__2": {
            // Restored: the schedule (for blueprint id + paper) and the
            // per-candidate deterministic question order, seeded on the NEW
            // attempt id so it reproduces exactly what the route returned.
            const attemptId = genId;
            const s = await attemptRepo.findSchedule(p.tenantId, id);
            if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
            const order = randomizeQuestionOrder((s.paper as PaperEntry[]).map((q) => q.questionId), attemptId);
            await attemptRepo.insertAttempt(tx, {
                    id: attemptId, tenantId: p.tenantId, scheduleId: id, blueprintId: s.blueprintId,
                    candidateId: body.candidateId, applicationId: body.applicationId ?? null, slotLabel: body.slotLabel ?? null,
                    status: "assigned", accommodation: (body.accommodation ?? {}) as never, questionOrder: order as never,
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_attempt_routes__3": {
            // Restored: the attempt (for the optimistic-version guard).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            await attemptRepo.updateAttempt(tx, p.tenantId, id, { accommodation: { extraTimePct: numOr(body.extraTimePct, 0), notes: body.notes ?? null } as never, updatedBy: msg.actorId }, a.version);
            break;
          }
          case "recruitment_attempt_routes__4": {
            // Restored: the attempt (for the optimistic-version guard).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                  identityVerified: true, identityMethod: body.method, identityMeta: (body.meta ?? {}) as never, identityVerifiedAt: new Date(), updatedBy: msg.actorId,
                }, a.version);
            break;
          }
          case "recruitment_attempt_routes__5": {
            // Restored: the attempt, its schedule (window end caps the deadline),
            // the blueprint duration and the accommodation extra time.
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            const s = await attemptRepo.findSchedule(p.tenantId, a.scheduleId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
            const now = Date.now();
            const blueprint = await blueprintRepo.findBlueprint(p.tenantId, a.blueprintId);
            const durationMinutes = blueprint?.durationMinutes ?? 60;
            const extraPct = Number((a.accommodation as { extraTimePct?: number })?.extraTimePct ?? 0);
            const deadline = new Date(attemptDeadline(now, durationMinutes, extraPct, s.windowEnd.getTime()));
            await attemptRepo.updateAttempt(tx, p.tenantId, id, { status: "in_progress", startedAt: new Date(now), deadlineAt: deadline, updatedBy: msg.actorId }, a.version);
            break;
          }
          case "recruitment_attempt_routes__6": {
            // Restored: the attempt (for the optimistic-version guard).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            for (const r of (body.responses ?? []) as Array<{ questionId: string; response: Record<string, unknown> }>) {
                    await attemptRepo.saveResponse(tx, { tenantId: p.tenantId, attemptId: id, questionId: r.questionId, response: r.response as never });
                  }
                  await attemptRepo.updateAttempt(tx, p.tenantId, id, { lastSavedAt: new Date(), updatedBy: msg.actorId }, a.version);
            break;
          }
          case "recruitment_attempt_routes__7": {
            // Restored: the attempt, its schedule's paper, the blueprint scoring
            // config, the saved responses and the deterministic auto-evaluation.
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            const s = await attemptRepo.findSchedule(p.tenantId, a.scheduleId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
            const blueprint = await blueprintRepo.findBlueprint(p.tenantId, a.blueprintId);
            const scoring = (blueprint?.scoringConfig ?? {}) as { negativeMarking?: { enabled: boolean; fraction?: number }; totalCutoffPct?: number; sections?: Array<{ key: string; sectionCutoffPct?: number }> };
            const paper = s.paper as PaperEntry[];
            const responses = await attemptRepo.listResponses(p.tenantId, id);
            const respByQ = new Map(responses.map((r) => [r.questionId, r.response as Record<string, unknown>]));
            const scored = new Map<string, ObjectiveScore>();
            for (const entry of paper) {
              scored.set(entry.questionId, scoreObjective(entry, respByQ.get(entry.questionId), scoring.negativeMarking));
            }
            const result = computeAttemptResult(paper, scored, { ...(scoring.totalCutoffPct != null ? { totalCutoffPct: scoring.totalCutoffPct } : {}), sections: scoring.sections ?? [] });
            for (const entry of paper) {
                    const sc = scored.get(entry.questionId)!;
                    if (sc.auto && respByQ.has(entry.questionId)) {
                      await attemptRepo.updateResponseScore(tx, p.tenantId, id, entry.questionId, sc.score, sc.isCorrect);
                    }
                  }
                  await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    status: "evaluated", submittedAt: new Date(), evaluatedAt: new Date(),
                    totalScore: String(result.totalScore), maxScore: String(result.maxScore),
                    sectionScores: result.sectionScores as never, needsManualEval: result.needsManualEval, result: result.result,
                    updatedBy: msg.actorId,
                  }, a.version);
            break;
          }
          case "recruitment_blueprint_routes__0": {
            // Restored: the new blueprint's id.
            const blueprintId = genId;
            await blueprintRepo.insertBlueprint(tx, {
                      id: blueprintId, tenantId: p.tenantId, code: body.code, title: body.title,
                      roleTitle: body.roleTitle ?? null, designationId: body.designationId ?? null,
                      competencies: (body.competencies ?? []) as never, allowedTypes: body.allowedTypes as never,
                      durationMinutes: numOr(body.durationMinutes, 60), scoringConfig: (body.scoringConfig ?? {}) as never,
                      status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: blueprintId, action: "create", detail: { code: body.code }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__1": {
            // Restored: the blueprint and the field-by-field patch + change list.
            const bp = await blueprintRepo.findBlueprint(p.tenantId, id);
            if (!bp) throw new HttpError(404, "NOT_FOUND", "blueprint not found");
            const patch: Record<string, unknown> = { updatedBy: msg.actorId };
            for (const k of ["title", "roleTitle", "designationId"] as const) {
              if (body[k] !== undefined) patch[k] = body[k];
            }
            if (body.durationMinutes !== undefined) patch.durationMinutes = Number(body.durationMinutes);
            if (body.competencies !== undefined) patch.competencies = body.competencies;
            if (body.allowedTypes !== undefined) patch.allowedTypes = body.allowedTypes;
            if (body.scoringConfig !== undefined) patch.scoringConfig = body.scoringConfig;
            const changedFields = Object.keys(patch).filter((k) => k !== "updatedBy");
            await blueprintRepo.updateBlueprint(tx, p.tenantId, id, patch as never, bp.version);
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "update", detail: { changedFields }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__2": {
            // Restored: the blueprint and the effective-from instant.
            const bp = await blueprintRepo.findBlueprint(p.tenantId, id);
            if (!bp) throw new HttpError(404, "NOT_FOUND", "blueprint not found");
            const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
            await blueprintRepo.updateBlueprint(tx, p.tenantId, id, {
                    status: "active", effectiveFrom, activatedBy: msg.actorId, activatedAt: new Date(), updatedBy: msg.actorId,
                  } as never, bp.version);
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "activate", detail: { effectiveFrom: effectiveFrom.toISOString(), totalMarks: blueprintTotalMarks(bp.scoringConfig as never) }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__3": {
            // Restored: the blueprint (for the optimistic-version guard).
            const bp = await blueprintRepo.findBlueprint(p.tenantId, id);
            if (!bp) throw new HttpError(404, "NOT_FOUND", "blueprint not found");
            await blueprintRepo.updateBlueprint(tx, p.tenantId, id, { status: "inactive", updatedBy: msg.actorId } as never, bp.version);
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "deactivate", detail: { reason: body.reason ?? null }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__4": {
            // Restored: the new question's id.
            const questionId = genId;
            await blueprintRepo.insertQuestion(tx, {
                    id: questionId, tenantId: p.tenantId, topic: body.topic, qtype: body.qtype, stem: body.stem,
                    options: (body.options ?? []) as never, answerKey: (body.answerKey ?? {}) as never,
                    difficulty: body.difficulty, marks: Number(body.marks), status: "draft",
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: questionId, action: "create", detail: { topic: body.topic, qtype: body.qtype }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__5": {
            // Restored: the question and the field-by-field patch + change list.
            const q = await blueprintRepo.findQuestion(p.tenantId, id);
            if (!q) throw new HttpError(404, "NOT_FOUND", "question not found");
            const patch: Record<string, unknown> = { updatedBy: msg.actorId };
            for (const k of ["topic", "qtype", "stem", "difficulty"] as const) {
              if (body[k] !== undefined) patch[k] = body[k];
            }
            if (body.marks !== undefined) patch.marks = Number(body.marks);
            if (body.options !== undefined) patch.options = body.options;
            if (body.answerKey !== undefined) patch.answerKey = body.answerKey;
            const changedFields = Object.keys(patch).filter((k) => k !== "updatedBy");
            await blueprintRepo.updateQuestion(tx, p.tenantId, id, patch as never, q.version);
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "update", detail: { changedFields }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__6": {
            // Restored: the question (for the optimistic-version guard).
            const q = await blueprintRepo.findQuestion(p.tenantId, id);
            if (!q) throw new HttpError(404, "NOT_FOUND", "question not found");
            await blueprintRepo.updateQuestion(tx, p.tenantId, id, { status: "validated", validatedBy: msg.actorId, validatedAt: new Date(), updatedBy: msg.actorId } as never, q.version);
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "validate", detail: {}, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__7": {
            // Restored: the question (for the optimistic-version guard).
            const q = await blueprintRepo.findQuestion(p.tenantId, id);
            if (!q) throw new HttpError(404, "NOT_FOUND", "question not found");
            await blueprintRepo.updateQuestion(tx, p.tenantId, id, { status: "retired", updatedBy: msg.actorId } as never, q.version);
                  await blueprintRepo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "retire", detail: { reason: body.reason ?? null }, actorId: msg.actorId });
            break;
          }
          case "recruitment_candidate_routes__0": {
            // Restored: the new candidate's id and the normalised dedup keys.
            const candidateId = genId;
            const nEmail = normalizeEmail(body.email);
            const nMobile = mobileDedupKey(body.mobile);
            await candidateRepo.insertCandidate(tx, {
                    id: candidateId, tenantId: p.tenantId, email: body.email, normalizedEmail: nEmail,
                    ...(body.mobile ? { mobile: body.mobile, normalizedMobile: nMobile ?? null } : {}),
                    emailVerified: body.emailVerified ?? false, mobileVerified: body.mobileVerified ?? false,
                    ...pickProfile(body),
                    status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                  } as never);
            break;
          }
          case "recruitment_candidate_routes__1": {
            // Restored: the candidate and the profile patch.
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            const patch: Record<string, unknown> = { updatedBy: msg.actorId, ...pickProfile(body) };
            await candidateRepo.updateCandidate(tx, p.tenantId, id, patch as never, c.version);
            break;
          }
          case "recruitment_candidate_routes__2": {
            // Restored: the candidate (existence) and the new education row's id.
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            const eid = genId;
            await candidateRepo.insertEducation(tx, {
                  id: eid, tenantId: p.tenantId, candidateId: id, qualification: body.qualification,
                  ...(body.subject ? { subject: body.subject } : {}),
                  ...(body.institution ? { institution: body.institution } : {}),
                  ...(body.boardUniversity ? { boardUniversity: body.boardUniversity } : {}),
                  ...(body.yearOfPassing != null ? { yearOfPassing: Number(body.yearOfPassing) } : {}),
                  ...(body.marksPercent != null ? { marksPercent: String(body.marksPercent) } : {}),
                  ...(body.grade ? { grade: body.grade } : {}),
                  createdBy: msg.actorId,
                });
            break;
          }
          case "recruitment_candidate_routes__3": {
            // Restored: the candidate (existence) and the new employment row's id.
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            const eid = genId;
            await candidateRepo.insertEmployment(tx, {
                  id: eid, tenantId: p.tenantId, candidateId: id, employer: body.employer,
                  ...(body.roleTitle ? { roleTitle: body.roleTitle } : {}),
                  ...(body.fromDate ? { fromDate: body.fromDate } : {}),
                  ...(body.toDate ? { toDate: body.toDate } : {}),
                  ...(body.noticePeriodDays != null ? { noticePeriodDays: Number(body.noticePeriodDays) } : {}),
                  ...(body.ctcMinor != null ? { ctcMinor: BigInt(body.ctcMinor) } : {}),
                  ...(body.reasonForLeaving ? { reasonForLeaving: body.reasonForLeaving } : {}),
                  createdBy: msg.actorId,
                });
            break;
          }
          case "recruitment_candidate_routes__4": {
            // Restored: the candidate (for the optimistic-version guard).
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            await candidateRepo.updateCandidate(tx, p.tenantId, id, {
                  status: "submitted", submittedAt: new Date(),
                  consentVersion: body.consentVersion ?? null, consentAcceptedAt: new Date(), updatedBy: msg.actorId,
                } as never, c.version);
            break;
          }
          case "recruitment_candidate_routes__5": {
            // Restored: the candidate (for the optimistic-version guard).
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            await candidateRepo.updateCandidate(tx, p.tenantId, id, { status: "withdrawn", withdrawnAt: new Date(), updatedBy: msg.actorId } as never, c.version);
            break;
          }
          case "recruitment_candidate_routes__6": {
            // Restored: the candidate (for the optimistic-version guard).
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            await candidateRepo.updateCandidate(tx, p.tenantId, id, { dataRequestAt: new Date(), updatedBy: msg.actorId } as never, c.version);
            break;
          }
          case "recruitment_eligibility_routes__0": {
            // Restored: the vacancy (for the optimistic-version guard) and the
            // coerced criteria object the route's Zod schema produced.
            const v = await eligibilityRepo.findVacancy(p.tenantId, id);
            if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
            await eligibilityRepo.setVacancyEligibility(tx, p.tenantId, id, toCriteria(body) as never, v.version);
            break;
          }
          case "recruitment_eligibility_routes__1": {
            // Restored: the vacancy + its advertised criteria, the eligibility
            // result stored on the application, the new application's id, its
            // application number and the dedup key.
            const v = await eligibilityRepo.findVacancy(p.tenantId, id);
            if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
            const criteria = (v.eligibility ?? {}) as EligibilityCriteria;
            const experienceYears = numOrNull(body.experienceYears);
            const applicant = {
              ...(body.dateOfBirth ? { dateOfBirth: String(body.dateOfBirth) } : {}),
              ...(body.category ? { category: String(body.category) } : {}),
              ...(experienceYears != null ? { experienceYears } : {}),
              ...(body.qualification ? { qualification: String(body.qualification) } : {}),
            } as Applicant;
            const result = evaluateEligibility(criteria, applicant);
            const appId = genId;
            const applicationNo = `APP-${appId.slice(0, 8).toUpperCase()}`;
            const dedupKey = criteria.allowMultiple ? null : String(body.email).toLowerCase();
            await eligibilityRepo.insertApplication(tx, {
                    id: appId, tenantId: p.tenantId, jobOpeningId: id,
                    applicantName: body.applicantName, email: body.email,
                    mobile: body.mobile ?? null, resumeRef: body.resumeRef ?? null,
                    skills: body.skills ?? null,
                    qualification: body.qualification ?? null,
                    experienceYears,
                    applicationNo, dateOfBirth: body.dateOfBirth ?? null,
                    category: body.category ?? null,
                    eligibilityResult: result as never,
                    dedupKey,
                    source: "eligibility_apply", stage: "applied", status: "active",
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  } as never);
            break;
          }
          case "recruitment_eligibility_routes__2": {
            // Restored: the application (for the optimistic-version guard).
            const a = await eligibilityRepo.findApplication(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
            await eligibilityRepo.withdrawApplication(tx, p.tenantId, id, body.reason, a.version);
            break;
          }
          case "recruitment_interview_comms_routes__0": {
            // Restored: the interview, the resolved dispatch channel/status, the
            // rendered message, the new comm row's id, and the idempotency key.
            // The key arrives on the X-Idempotency-Key HEADER, which the envelope
            // did not carry — the route now forwards it on the payload, otherwise
            // the replay guard (unique index on idempotency_key) is defeated and
            // a retried dispatch double-sends.
            const iv = await ivRepo.findInterview(p.tenantId, id);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const commId = genId;
            const idempotencyKey = (p.idempotencyKey as string | undefined) ?? null;
            const { channel, status } = resolveDispatch(commsEnabled(process.env), body.channel);
            const scheduledDate = body.type === "reschedule" ? String(body.newDate) : (iv.scheduledDate as unknown as string);
            const message = buildCommMessage(body.type as InterviewCommType, {
              roundType: iv.roundType, scheduledDate,
              scheduledTime: body.type === "reschedule" ? String(body.newTime) : iv.scheduledTime,
            });
            if (body.type === "reschedule") {
                      const ok = await ivRepo.rescheduleInterview(tx, p.tenantId, id, body.newDate!, body.newTime!, msg.actorId, iv.version);
                      if (!ok) throw new Error("VERSION_CONFLICT");
                    } else if (body.type === "cancel") {
                      const ok = await ivRepo.cancelInterview(tx, p.tenantId, id, iv.version);
                      if (!ok) throw new Error("VERSION_CONFLICT");
                    }
                    await ivRepo.insertComm(tx, {
                      id: commId, tenantId: p.tenantId, interviewId: id, applicationId: iv.applicationId,
                      commType: body.type, channel, status, message,
                      scheduledFor: body.type === "reschedule" ? new Date(`${body.newDate!}T${body.newTime!}:00Z`) : null,
                      idempotencyKey: idempotencyKey ?? null,
                      createdBy: msg.actorId,
                    });
                    // Real dispatch only when the flag is on — queued to the outbox relay.
                    if (status === "queued") {
                      await enqueue(tx, {
                        topic: EVENTS.interviewCommDispatch, eventType: EVENTS.interviewCommDispatch,
                        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                        payload: { commId, interviewId: id, applicationId: iv.applicationId, type: body.type, channel },
                      });
                    }
            break;
          }
          case "recruitment_interview_recording_routes__0": {
            // Restored: the interview, the new artefact's id and the retention
            // deadline. The route already enforced consent + key namespacing.
            const iv = await ivRepo.findInterview(p.tenantId, id);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const rid = genId;
            const retentionUntil = computeRetentionUntil(Date.now(), body.retentionDays != null ? Number(body.retentionDays) : DEFAULT_RETENTION_DAYS);
            await recordingRepo.insertRecording(tx, {
                  id: rid, tenantId: p.tenantId, interviewId: id, applicationId: iv.applicationId,
                  kind: body.kind, storageKey: body.storageKey,
                  consentGiven: true, consentReference: body.consentReference ?? null,
                  consentBy: msg.actorId, consentAt: new Date(),
                  retentionUntil, status: "active", createdBy: msg.actorId,
                });
            break;
          }
          case "recruitment_interview_recording_routes__1": {
            // Restored: the recording (for the optimistic-version guard).
            const rec = await recordingRepo.findRecording(p.tenantId, id);
            if (!rec) throw new HttpError(404, "NOT_FOUND", "active recording not found");
            await recordingRepo.softDelete(tx, p.tenantId, id, msg.actorId, rec.version);
            break;
          }
          case "recruitment_interview_response_routes__0": {
            // Restored: the interview (application id + the FROM slot recorded on
            // the response) and the new response row's id.
            const iv = await ivRepo.findInterview(p.tenantId, id);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const rid = genId;
            await responseRepo.insertResponse(tx, {
                    id: rid, tenantId: p.tenantId, interviewId: id, applicationId: iv.applicationId,
                    responseType: body.type, status: initialStatus(body.type as ResponseType),
                    preferredDate: body.type === "reschedule_request" ? body.preferredDate! : null,
                    preferredTime: body.type === "reschedule_request" ? body.preferredTime! : null,
                    reason: body.reason ?? null,
                    fromDate: iv.scheduledDate as unknown as string, fromTime: iv.scheduledTime,
                    createdBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_interview_response_routes__1": {
            // Restored: the reschedule request, its preferred slot and the
            // interview it moves (both under their own version guards).
            const r = await responseRepo.findResponse(p.tenantId, reqId);
            if (!r) throw new HttpError(404, "NOT_FOUND", "reschedule request not found");
            const preferredDate = r.preferredDate as unknown as string | null;
            if (!preferredDate || !r.preferredTime) throw new HttpError(422, "INVALID_RESPONSE", "the reschedule request has no valid preferred slot");
            const iv = await ivRepo.findInterview(p.tenantId, r.interviewId);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const ok = await ivRepo.rescheduleInterview(tx, p.tenantId, r.interviewId, preferredDate, r.preferredTime!, msg.actorId, iv.version);
                    if (!ok) throw new Error("VERSION_CONFLICT");
                    await responseRepo.setResponseStatus(tx, p.tenantId, reqId, {
                      status: "approved", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                    }, r.version);
            break;
          }
          case "recruitment_interview_response_routes__2": {
            // Restored: the reschedule request (for the optimistic-version guard).
            const r = await responseRepo.findResponse(p.tenantId, reqId);
            if (!r) throw new HttpError(404, "NOT_FOUND", "reschedule request not found");
            await responseRepo.setResponseStatus(tx, p.tenantId, reqId, {
                    status: "declined", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                  }, r.version);
            break;
          }
          case "recruitment_interview_routes__0": {
            // Restored: the new interview's id and the split date/time.
            const interviewId = genId;
            const when = new Date(body.scheduledAt);
            const scheduledDate = when.toISOString().slice(0, 10);
            const scheduledTime = when.toISOString().slice(11, 16);
            await coreRepo.insertInterview(tx, {
                    id: interviewId,
                    tenantId: p.tenantId,
                    applicationId: body.applicationId,
                    jobOpeningId: body.jobOpeningId,
                    roundNumber: numOr(body.roundNumber, 1),
                    roundType: body.roundType ?? "technical",
                    scheduledDate,
                    scheduledTime,
                    durationMinutes: numOr(body.durationMinutes, 60),
                    mode: MODE_DB[body.mode ?? "video"] ?? "video",
                    panelMembers: body.interviewerIds,
                    status: "scheduled",
                    feedback: body.notes ?? null,
                    createdBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_interview_routes__1": {
            // Restored: the interview (existence) and the scorecard envelope.
            const interview = await coreRepo.findInterviewById(id, p.tenantId);
            if (!interview) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const scorecard: Record<string, unknown> = {
              ...body, submittedBy: msg.actorId, submittedAt: new Date().toISOString(),
            };
            await coreRepo.updateInterviewScorecard(tx, id, p.tenantId, scorecard, RECO_DB[body.recommendation] ?? null);
            break;
          }
          case "recruitment_interview_scoring_routes__0": {
            // Restored: the interview (for the optimistic-version guard).
            const iv = await scoringRepo.findInterview(p.tenantId, id);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            await scoringRepo.updateInterview(tx, p.tenantId, id, {
                  scorecardTemplate: body.competencies as never,
                  ...(body.cutoffScore != null ? { cutoffScore: Number(body.cutoffScore) } : {}),
                }, iv.version);
            break;
          }
          case "recruitment_interview_scoring_routes__1": {
            // Restored: the interview's scorecard template and this
            // interviewer's normalised overall (0-100).
            const iv = await scoringRepo.findInterview(p.tenantId, id);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const template = (iv.scorecardTemplate ?? []) as Competency[];
            const scores = body.scores as Record<string, number>;
            const overall = computePanelScore(template, [{ interviewerId: msg.actorId, scores }]).weightedScore;
            await scoringRepo.insertScore(tx, {
                    tenantId: p.tenantId, interviewId: id, interviewerId: msg.actorId,
                    scores, overallScore: Math.round(overall), comments: body.comments ?? null,
                  });
            break;
          }
          case "recruitment_interview_scoring_routes__2": {
            // Restored: the interview, its template, the submitted scores and the
            // competency-weighted consolidation.
            const iv = await scoringRepo.findInterview(p.tenantId, id);
            if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const template = (iv.scorecardTemplate ?? []) as Competency[];
            const rows = await scoringRepo.listScores(p.tenantId, id);
            const submitted: InterviewerScore[] = rows.filter((s) => s.submitted).map((s) => ({ interviewerId: s.interviewerId, scores: s.scores as Record<string, number>, submitted: true }));
            const result = computePanelScore(template, submitted, iv.cutoffScore ?? null);
            await scoringRepo.updateInterview(tx, p.tenantId, id, {
                  panelScore: Math.round(result.weightedScore), recommendation: result.recommendation,
                  status: "completed", consolidatedAt: new Date(),
                }, iv.version);
            break;
          }
          case "recruitment_offer_extra_routes__0": {
            // Restored: the offer and its current joining date (preserved as the
            // ORIGINAL when the first extension is requested).
            const offer = await offerRepo.findOffer(p.tenantId, offerId);
            if (!offer) throw new HttpError(404, "NOT_FOUND", "offer not found");
            const current = offer.joiningDate;
            await offerRepo.updateOffer(tx, p.tenantId, offerId, {
                  joiningExtensionStatus: "requested",
                  requestedJoiningDate: body.requestedJoiningDate,
                  originalJoiningDate: offer.originalJoiningDate ?? current,
                  joiningExtensionReason: body.reason,
                  requestedBy: msg.actorId, requestedAt: new Date(),   // maker recorded, survives approval
                  updatedBy: msg.actorId,
                } as never, offer.version);
            break;
          }
          case "recruitment_offer_extra_routes__1": {
            // Restored: the offer (the requested date becomes the joining date).
            const offer = await offerRepo.findOffer(p.tenantId, offerId);
            if (!offer) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, {
                  joiningDate: offer.requestedJoiningDate,     // apply the new date
                  joiningExtensionStatus: "approved",
                  joiningExtensionBy: msg.actorId,
                  joiningExtensionAt: new Date(),
                  updatedBy: msg.actorId,
                } as never, offer.version);
            break;
          }
          case "recruitment_offer_extra_routes__2": {
            // Restored: the offer (for the optimistic-version guard).
            const offer = await offerRepo.findOffer(p.tenantId, offerId);
            if (!offer) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, {
                  joiningExtensionStatus: "rejected",
                  joiningExtensionBy: msg.actorId,
                  joiningExtensionAt: new Date(),
                  updatedBy: msg.actorId,
                } as never, offer.version);
            break;
          }
          case "recruitment_offer_routes__0": {
            // Restored: the new offer's id, the next offer version for the
            // application, the approval chain and the derived compensation.
            // NOTE: `id` is the APPLICATION here (`/applications/:id/offers`).
            const newOfferId = genId;
            const nextVersion = (await offerRepo.maxOfferVersion(p.tenantId, id)) + 1;
            const chain = (body.approvalChain ?? DEFAULT_OFFER_CHAIN) as ApprovalStage[];
            const c = computeCompensation({
              basicMinor: BigInt(body.basicMinor ?? 0), joiningBonusMinor: BigInt(body.joiningBonusMinor ?? 0),
              relocationMinor: BigInt(body.relocationMinor ?? 0), variablePayMinor: BigInt(body.variablePayMinor ?? 0),
            });
            await offerRepo.insertOffer(tx, {
                  id: newOfferId, tenantId: p.tenantId, applicationId: id,
                  offerNo: `OFR-${newOfferId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion,
                  basicMinor: c.basicMinor, joiningBonusMinor: c.joiningBonusMinor,
                  relocationMinor: c.relocationMinor, variablePayMinor: c.variablePayMinor,
                  grossCtcMinor: c.grossCtcMinor, ctcMinor: c.grossCtcMinor, // keep legacy ctc_minor in sync
                  ...(body.grade ? { grade: body.grade } : {}),
                  ...(body.templateRef ? { templateRef: body.templateRef } : {}),
                  ...(body.joiningDate ? { joiningDate: body.joiningDate } : {}),
                  approvalChain: chain as never, currentStage: -1, status: "draft",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_offer_routes__1": {
            // Restored: the offer (version guard + the application it belongs to).
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "pending_approval", currentStage: 0 }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "submit", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__2": {
            // Restored: the offer and whether this is the FINAL approval stage.
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            const final = isFinalStage(o.approvalChain as ApprovalStage[], o.currentStage);
            await offerRepo.updateOffer(tx, p.tenantId, offerId,
                    final ? { status: "approved", approvedAt: new Date() } : { currentStage: o.currentStage + 1 }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "approve", remarks: body.comments ?? null, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__3": {
            // Restored: the offer (for the optimistic-version guard).
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "returned", currentStage: -1 }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "return", remarks: body.comments, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__4": {
            // Restored: the offer (for the optimistic-version guard).
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "released", releasedAt: new Date(), ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}) }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "release", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__5": {
            // Restored: the offer and the R-RA-0162 acceptance evidence. The
            // IP / user-agent live on the HTTP request, not the body, so the
            // route now forwards them on the payload as `meta`; fabricating them
            // here would put false evidence on the acceptance record.
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            const meta = (p.meta ?? {}) as Record<string, unknown>;
            await offerRepo.updateOffer(tx, p.tenantId, offerId, {
                    status: "accepted", acceptedAt: new Date(), acceptedVersion: o.offerVersion, acceptanceMeta: meta as never,
                  } as never, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "accept", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__6": {
            // Restored: the offer (for the optimistic-version guard).
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "declined", declinedAt: new Date(), declineReasonCode: body.reasonCode, declineRemarks: body.remarks ?? null }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "decline", reasonCode: body.reasonCode, remarks: body.remarks ?? null, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__7": {
            // Restored: the offer (for the optimistic-version guard).
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "withdrawn", withdrawReason: body.reason }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "withdraw", remarks: body.reason, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__8": {
            // Restored: the offer (for the optimistic-version guard).
            const o = await offerRepo.findOffer(p.tenantId, offerId);
            if (!o) throw new HttpError(404, "NOT_FOUND", "offer not found");
            await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "expired" }, o.version);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "expire", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__9": {
            // Restored: the superseded offer, the new version's id and number,
            // and the compensation merged over the previous offer's figures.
            const prev = await offerRepo.findOffer(p.tenantId, offerId);
            if (!prev) throw new HttpError(404, "NOT_FOUND", "offer not found");
            const newId = genId;
            const nextVersion = (await offerRepo.maxOfferVersion(p.tenantId, prev.applicationId)) + 1;
            const c = computeCompensation({
              basicMinor: BigInt(body.basicMinor ?? prev.basicMinor),
              joiningBonusMinor: BigInt(body.joiningBonusMinor ?? prev.joiningBonusMinor),
              relocationMinor: BigInt(body.relocationMinor ?? prev.relocationMinor),
              variablePayMinor: BigInt(body.variablePayMinor ?? prev.variablePayMinor),
            });
            // supersede the previous
                  await offerRepo.updateOffer(tx, p.tenantId, offerId, { status: "revised" }, prev.version);
                  await offerRepo.insertOffer(tx, {
                    id: newId, tenantId: p.tenantId, applicationId: prev.applicationId,
                    offerNo: `OFR-${newId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion,
                    basicMinor: c.basicMinor, joiningBonusMinor: c.joiningBonusMinor,
                    relocationMinor: c.relocationMinor, variablePayMinor: c.variablePayMinor,
                    grossCtcMinor: c.grossCtcMinor, ctcMinor: c.grossCtcMinor,
                    grade: (body.grade ?? prev.grade) as string | null,
                    approvalChain: prev.approvalChain as never, currentStage: -1, status: "draft",
                    supersedesOfferId: offerId,
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  } as never);
                  await offerRepo.insertEvent(tx, { tenantId: p.tenantId, offerId: newId, applicationId: prev.applicationId, action: "revise", remarks: `supersedes ${prev.offerNo ?? offerId}`, actorId: msg.actorId });
            break;
          }
          case "recruitment_otp_verify_routes__0": {
            // Restored: the challenge row's id, the OTP code and its expiry. The
            // code is generated in the ROUTE (and echoed / dispatched from
            // there), so it must be forwarded on the payload — re-generating it
            // here would store a code that can never match the one delivered.
            const cid = genId;
            const code = p.code as string | undefined;
            if (!code) throw new HttpError(422, "MISSING_OTP", "the generated OTP code is missing from the payload");
            const expiresAt = p.expiresAt ? new Date(p.expiresAt as string) : new Date(Date.now() + OTP_TTL_SECONDS * 1000);
            await otpRepo.insertChallenge(tx, {
                  id: cid, tenantId: p.tenantId, candidateId: id, channel: body.channel ?? "email",
                  code, expiresAt,
                });
            break;
          }
          case "recruitment_otp_verify_routes__1": {
            // Restored: the latest challenge for this candidate + channel.
            const challenge = await otpRepo.findLatestChallenge(p.tenantId, id, body.channel ?? "email");
            if (!challenge) return; // nothing to count against; the route already 4xx'd
            await otpRepo.incrementAttempts(tx, p.tenantId, challenge.id);
            break;
          }
          case "recruitment_otp_verify_routes__2": {
            // Restored: the latest challenge for this candidate + channel.
            const challenge = await otpRepo.findLatestChallenge(p.tenantId, id, body.channel ?? "email");
            if (!challenge) throw new HttpError(404, "NO_CHALLENGE", "no OTP challenge found");
            await otpRepo.markVerified(tx, p.tenantId, challenge.id, id, body.channel ?? "email");
            break;
          }
          case "recruitment_panel_routes__0": {
            // The route validated COI consistency + uniqueness; only the Zod
            // defaults have to be re-applied to the raw body here.
            const members = (body.members ?? []) as Array<Record<string, any>>;
            await panelRepo.setPanelists(tx, p.tenantId, id, members.map((m) => ({
                  tenantId: p.tenantId, interviewId: id, memberId: m.memberId, memberName: m.memberName, panelRole: m.panelRole ?? "member",
                  availability: (m.availability ?? {}) as never, coiDeclared: m.coiDeclared ?? false, coiType: m.coiType ?? "none", coiNote: m.coiNote ?? null,
                })));
            break;
          }
          case "recruitment_panel_routes__1": {
            // Restored: the panelist id, which is a PATH parameter
            // (`/interviews/:id/panelists/:memberId/recuse`), not part of the body.
            const memberId = params.memberId as string;
            if (!memberId) throw new HttpError(422, "MISSING_MEMBER", "panelist id missing from the payload");
            await panelRepo.recusePanelist(tx, p.tenantId, id, memberId);
            break;
          }
          case "recruitment_panel_routes__2": {
            // Restored: the interview (its version binds this outcome to the
            // exact panel that cleared the COI gate) and the validity date.
            const interview = await panelRepo.findInterview(p.tenantId, id);
            if (!interview) throw new HttpError(404, "NOT_FOUND", "interview not found");
            const validUntil = body.validUntil ? new Date(body.validUntil).toISOString().slice(0, 10) : null;
            await panelRepo.updateInterview(tx, p.tenantId, id, {
                  outcomeStatus: body.status,
                  rejectionReason: body.status === "rejected" ? (body.rejectionReason ?? null) : null,
                  rejectionNote: body.status === "rejected" ? (body.rejectionNote ?? null) : null,
                  waitlistRank: body.status === "waitlisted" ? (numOrNull(body.waitlistRank)) : null,
                  recommendationValidUntil: body.status === "rejected" ? null : validUntil,
                  outcomeBy: msg.actorId, outcomeAt: new Date(),
                } as never, interview.version);
            break;
          }
          case "recruitment_publication_routes__0": {
            // Restored: the vacancy and the advertisement patch.
            const v = await publicationRepo.findVacancy(p.tenantId, id);
            if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
            const patch: Record<string, unknown> = { updatedBy: msg.actorId };
            if (body.feesMinor != null) patch.feesMinor = BigInt(body.feesMinor);
            if (body.minExperienceYears != null) patch.minExperienceYears = Number(body.minExperienceYears);
            for (const k of ["feeExemption", "requiredDocuments", "selectionProcess", "importantDates", "portalScope", "titleAlt", "descriptionAlt"] as const) {
              if (body[k] !== undefined) patch[k] = body[k];
            }
            await publicationRepo.updateVacancy(tx, p.tenantId, id, patch as never, v.version);
            break;
          }
          case "recruitment_publication_routes__1": {
            // Restored: the vacancy and the next corrigendum sequence number.
            const v = await publicationRepo.findVacancy(p.tenantId, id);
            if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
            const seq = await publicationRepo.nextCorrigendumSeq(p.tenantId, id);
            await publicationRepo.insertCorrigendum(tx, { tenantId: p.tenantId, jobOpeningId: id, seq, action: "corrigendum", changes: body.changes, actorId: msg.actorId });
                  await publicationRepo.updateVacancy(tx, p.tenantId, id, { corrigendumCount: seq, updatedBy: msg.actorId }, v.version);
            break;
          }
          case "recruitment_publication_routes__2": {
            // Restored: the vacancy, the old/new deadlines and the sequence.
            const v = await publicationRepo.findVacancy(p.tenantId, id);
            if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
            const oldDeadline = v.applicationDeadline as Date | null;
            const newDeadline = new Date(body.newDeadline);
            const seq = await publicationRepo.nextCorrigendumSeq(p.tenantId, id);
            await publicationRepo.insertCorrigendum(tx, {
                    tenantId: p.tenantId, jobOpeningId: id, seq, action: "extension",
                    changes: body.reason ?? `deadline extended to ${body.newDeadline}`, oldDeadline, newDeadline, actorId: msg.actorId,
                  });
                  // Extending REOPENS a closed vacancy so applications can resume (R-RA-0069).
                  await publicationRepo.updateVacancy(tx, p.tenantId, id, { applicationDeadline: newDeadline, status: "open", corrigendumCount: seq, updatedBy: msg.actorId }, v.version);
            break;
          }
          case "recruitment_publication_routes__3": {
            // Restored: the vacancy and the next corrigendum sequence number.
            const v = await publicationRepo.findVacancy(p.tenantId, id);
            if (!v) throw new HttpError(404, "NOT_FOUND", "vacancy not found");
            const seq = await publicationRepo.nextCorrigendumSeq(p.tenantId, id);
            await publicationRepo.insertCorrigendum(tx, { tenantId: p.tenantId, jobOpeningId: id, seq, action: "cancellation", changes: body.reason, actorId: msg.actorId });
                  // Cancel preserves the advert (row untouched except status) — R-RA-0068.
                  await publicationRepo.updateVacancy(tx, p.tenantId, id, { status: "cancelled", corrigendumCount: seq, updatedBy: msg.actorId }, v.version);
            break;
          }
          case "recruitment_qualification_routes__0": {
            // Restored: the job opening the requirement belongs to (the `:id`
            // path param), the full requirement patch and any existing row.
            const jobOpeningId = id;
            const patch = {
              minTotalYears: body.minTotalYears != null ? String(body.minTotalYears) : null,
              minRelevantYears: body.minRelevantYears != null ? String(body.minRelevantYears) : null,
              maxGapMonths: numOrNull(body.maxGapMonths),
              minEducationLevel: body.minEducationLevel ?? null,
              requiredDisciplines: (body.requiredDisciplines ?? []) as never,
              minPercentage: body.minPercentage != null ? String(body.minPercentage) : null,
              recognisedInstitutionsOnly: body.recognisedInstitutionsOnly ?? false,
              updatedBy: msg.actorId,
            };
            const existing = await qualificationRepo.findByJob(p.tenantId, jobOpeningId);
            if (existing) await qualificationRepo.updateRequirement(tx, p.tenantId, jobOpeningId, patch as never, existing.version);
                    else await qualificationRepo.insertRequirement(tx, { id: randomUUID(), tenantId: p.tenantId, jobOpeningId, ...patch, createdBy: msg.actorId } as never);
            break;
          }
          case "recruitment_reference_routes__0": {
            // Restored: the NORMALISED (uppercase) reservation category, so the
            // reservation-shortlist module never mis-buckets a lowercase "obc".
            const category = body.category ? String(body.category).trim().toUpperCase() : null;
            await referenceRepo.updateCandidateFields(tx, p.tenantId, id, {
                  category, subCategory: body.subCategory ?? null, disability: body.disability ?? false,
                  disabilityType: body.disability ? (body.disabilityType ?? null) : null,
                  disabilityPercentage: body.disability ? (numOrNull(body.disabilityPercentage)) : null,
                  exServiceman: body.exServiceman ?? false, freedomFighterDependent: body.freedomFighterDependent ?? false,
                  reservationDocs: (body.reservationDocs ?? []) as never, updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_reference_routes__1": {
            await referenceRepo.setReferences(tx, p.tenantId, id, ((body.references ?? []) as Array<Record<string, any>>).map((r) => ({
                  tenantId: p.tenantId, candidateId: id, refName: r.name, relationship: r.relationship,
                  organisation: r.organisation ?? null, designation: r.designation ?? null,
                  email: r.email ?? null, phone: r.phone ?? null, yearsKnown: numOrNull(r.yearsKnown),
                })));
            break;
          }
          case "recruitment_reference_routes__2": {
            await referenceRepo.updateCandidateFields(tx, p.tenantId, id, {
                  // Drop any relations when the flag is false so the stored record can't be an
                  // inconsistent "false + populated relations" (which a COI consumer would miss).
                  relationshipDeclaration: { hasPriorRelationship: body.hasPriorRelationship, relations: body.hasPriorRelationship ? (body.relations ?? []) : [] } as never,
                  updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_rejection_notice_routes__0": {
            await noticeRepo.setDisclosurePolicy(tx, p.tenantId, id, Boolean(body.discloseReason), msg.actorId);
            break;
          }
          case "recruitment_report_routes__0": {
            // Restored: the attempt (for the optimistic-version guard).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            // Malpractice is also a post-publish REVOCATION: clear frozen/published so a
                  // voided result can never continue to surface as an authoritative published one.
                  await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    status: "void", disposition: "malpractice", dispositionReason: body.reason, dispositionBy: msg.actorId, dispositionAt: new Date(),
                    result: "not_qualified", frozen: false, published: false, updatedBy: msg.actorId,
                  } as never, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "malpractice", detail: { reason: body.reason, ...(body.evidence ? { evidence: body.evidence } : {}) }, actorId: msg.actorId });
            break;
          }
          case "recruitment_report_routes__1": {
            // Restored: the voided attempt, the target schedule, the replacement
            // attempt's id and its per-candidate question order.
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            const targetScheduleId = (body.targetScheduleId as string) ?? a.scheduleId;
            const target = await attemptRepo.findSchedule(p.tenantId, targetScheduleId);
            if (!target) throw new HttpError(404, "NOT_FOUND", "target schedule not found");
            const newId = genId;
            const order = randomizeQuestionOrder((target.paper as PaperEntry[]).map((q) => q.questionId), newId);
            // Void the original first so the partial unique frees the candidate's slot.
                    await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                      status: "void", disposition: body.type, dispositionReason: body.reason, dispositionBy: msg.actorId, dispositionAt: new Date(),
                      supersededBy: newId, updatedBy: msg.actorId,
                    } as never, a.version);
                    await attemptRepo.insertAttempt(tx, {
                      id: newId, tenantId: p.tenantId, scheduleId: targetScheduleId, blueprintId: target.blueprintId,
                      candidateId: a.candidateId, applicationId: a.applicationId ?? null, status: "assigned",
                      accommodation: a.accommodation as never, questionOrder: order as never, createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "reschedule", detail: { type: body.type, reason: body.reason, newAttemptId: newId, targetScheduleId }, actorId: msg.actorId });
            break;
          }
          case "recruitment_requisition_routes__0": {
            // Restored: the new requisition's id/number and the approval chain
            // (the route already rejected a custom chain from a non-admin).
            const requisitionId = genId;
            const b = body;
            const chain = (b.approvalChain ?? DEFAULT_GOVT_CHAIN) as ApprovalStage[];
            await requisitionRepo.insertRequisition(tx, {
                  id: requisitionId, tenantId: p.tenantId, requisitionNo: `REQ-${requisitionId.slice(0, 8).toUpperCase()}`,
                  title: b.title,
                  ...(b.positionId ? { positionId: b.positionId } : {}),
                  ...(b.sourceManpowerReqId ? { sourceManpowerReqId: b.sourceManpowerReqId } : {}),
                  ...(b.reason ? { reason: b.reason } : {}),
                  employmentType: b.employmentType ?? "permanent", recruitmentMode: b.recruitmentMode ?? "direct", campaignType: b.campaignType ?? "direct",
                  ...(b.departmentId ? { departmentId: b.departmentId } : {}),
                  ...(b.designationId ? { designationId: b.designationId } : {}),
                  ...(b.grade ? { grade: b.grade } : {}),
                  ...(b.location ? { location: b.location } : {}),
                  vacancies: numOr(b.vacancies, 1), experienceMinYears: numOr(b.experienceMinYears, 0),
                  ...(b.qualification ? { qualification: b.qualification } : {}),
                  ...(b.skills ? { skills: b.skills } : {}),
                  reservation: numRecord(b.reservation ?? {}) as never,
                  ...(b.budgetMinor != null ? { budgetMinor: BigInt(b.budgetMinor) } : {}),
                  confidential: b.confidential ?? false,
                  ...(b.agencyId ? { agencyId: b.agencyId } : {}),
                  ...(b.targetHireDate ? { targetHireDate: b.targetHireDate } : {}),
                  ...(b.slaDays != null ? { slaDays: Number(b.slaDays) } : {}),
                  approvalChain: chain as never, currentStage: -1, status: "draft",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_requisition_routes__1": {
            // Restored: the requisition and the field-by-field patch (mirrors the
            // route's allow-list; the chain change was already authorised there).
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            const patch: Record<string, unknown> = { updatedBy: msg.actorId };
            for (const k of ["title", "reason", "employmentType", "recruitmentMode", "campaignType", "grade", "location",
              "qualification", "skills", "confidential", "targetHireDate"] as const) {
              if (body[k] !== undefined) patch[k] = body[k];
            }
            for (const k of ["vacancies", "experienceMinYears", "slaDays"] as const) {
              if (body[k] !== undefined) patch[k] = Number(body[k]);
            }
            if (body.reservation !== undefined) patch.reservation = numRecord(body.reservation);
            if (body.budgetMinor != null) patch.budgetMinor = BigInt(body.budgetMinor);
            if (body.approvalChain !== undefined) patch.approvalChain = body.approvalChain;
            await requisitionRepo.updateRequisition(tx, p.tenantId, id, patch as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__2": {
            // Restored: the requisition (for the optimistic-version guard).
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                  status: "pending_approval", currentStage: 0, submittedAt: new Date(), updatedBy: msg.actorId,
                } as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__3": {
            // Restored: the requisition, the role configured for the CURRENT
            // stage (recorded on the approval row) and whether it is the final one.
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            const chain = r.approvalChain as ApprovalStage[];
            const role = currentStageRole(chain, r.currentStage);
            const final = isFinalStage(chain, r.currentStage);
            await requisitionRepo.insertApproval(tx, {
                    tenantId: p.tenantId, requisitionId: id, stage: r.currentStage, stageRole: role,
                    action: "approve", comments: body.comments ?? null, actorId: msg.actorId,
                  } as never);
                  await requisitionRepo.updateRequisition(tx, p.tenantId, id,
                    (final
                      ? { status: "approved", approvedAt: new Date(), updatedBy: msg.actorId }
                      : { currentStage: r.currentStage + 1, updatedBy: msg.actorId }) as never,
                    r.version);
            break;
          }
          case "recruitment_requisition_routes__4": {
            // Restored: the requisition and the current stage's role.
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            const role = currentStageRole(r.approvalChain as ApprovalStage[], r.currentStage);
            await requisitionRepo.insertApproval(tx, {
                    tenantId: p.tenantId, requisitionId: id, stage: r.currentStage, stageRole: role,
                    action: "return", comments: body.comments, actorId: msg.actorId,
                  } as never);
                  await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                    status: "returned", currentStage: -1, updatedBy: msg.actorId,
                  } as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__5": {
            // Restored: the requisition (for the optimistic-version guard).
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                  status: "on_hold", holdReason: body.reason, updatedBy: msg.actorId,
                } as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__6": {
            // Restored: the requisition and the status it is restored TO — a
            // fully-approved run resumes 'approved', otherwise 'pending_approval'.
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            const restored = r.approvedAt ? "approved" : "pending_approval";
            await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                  status: restored, holdReason: null, updatedBy: msg.actorId,
                } as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__7": {
            // Restored: the requisition (for the optimistic-version guard).
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                  status: "cancelled", closeReason: body.reason, updatedBy: msg.actorId,
                } as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__8": {
            // Restored: the requisition (for the optimistic-version guard).
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                  status: "closed", closeReason: body.reason, updatedBy: msg.actorId,
                } as never, r.version);
            break;
          }
          case "recruitment_requisition_routes__9": {
            // Restored: the source requisition, the clone's id and the carried
            // field set (CLONE_CARRY_FIELDS, so status/approval state is dropped).
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            const newId = genId;
            const carried = cloneFields(r as unknown as Record<string, unknown>);
            await requisitionRepo.insertRequisition(tx, {
                  ...(carried as object),
                  id: newId, tenantId: p.tenantId, requisitionNo: `REQ-${newId.slice(0, 8).toUpperCase()}`,
                  currentStage: -1, status: "draft",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_requisition_routes__10": {
            // Restored: the approved requisition (the job opening is projected
            // from it) and the new job opening's id.
            const r = await requisitionRepo.findRequisition(p.tenantId, id);
            if (!r) throw new HttpError(404, "NOT_FOUND", "requisition not found");
            const openingId = genId;
            await requisitionRepo.insertJobOpening(tx, {
                    id: openingId, tenantId: p.tenantId,
                    refNo: r.requisitionNo, title: r.title,
                    departmentId: r.departmentId!, designationId: r.designationId ?? null,
                    vacancies: r.vacancies, description: r.reason ?? null,
                    vacancyType: toVacancyType(r.recruitmentMode, r.campaignType), location: r.location ?? null,
                    qualification: r.qualification ?? null,
                    isPublished: true, status: "open",
                    postedAt: new Date().toISOString().slice(0, 10),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  } as never);
                  await requisitionRepo.updateRequisition(tx, p.tenantId, id, {
                    status: "published", publishedOpeningId: openingId, publishedAt: new Date(), updatedBy: msg.actorId,
                  } as never, r.version);
            break;
          }
          case "recruitment_reservation_routes__0": {
            // Restored: the job opening (the `:id` path param) and any existing
            // roster, plus numeric coercion of the raw vacancy counts.
            const jobOpeningId = id;
            const existing = await reservationRepo.findByJob(p.tenantId, jobOpeningId);
            const totalVacancies = numOr(body.totalVacancies, 0);
            const categoryVacancies = numRecord(body.categoryVacancies ?? {});
            const locationRosters: Record<string, Record<string, number>> = {};
            for (const [loc, roster] of Object.entries((body.locationRosters ?? {}) as Record<string, unknown>)) {
              locationRosters[loc] = numRecord(roster);
            }
            if (existing) {
                      await reservationRepo.updateRoster(tx, p.tenantId, jobOpeningId, {
                        totalVacancies, categoryVacancies: categoryVacancies as never,
                        locationRosters: locationRosters as never, updatedBy: msg.actorId,
                      }, existing.version);
                    } else {
                      await reservationRepo.insertRoster(tx, {
                        id: randomUUID(), tenantId: p.tenantId, jobOpeningId, totalVacancies,
                        categoryVacancies: categoryVacancies as never, locationRosters: locationRosters as never,
                        status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                      });
                    }
            break;
          }
          case "recruitment_reservation_routes__1": {
            // Restored: the roster (for the optimistic-version guard).
            const jobOpeningId = id;
            const roster = await reservationRepo.findByJob(p.tenantId, jobOpeningId);
            if (!roster) throw new HttpError(404, "NOT_FOUND", "reservation roster not found for this job opening");
            await reservationRepo.updateRoster(tx, p.tenantId, jobOpeningId, {
                  status: "approved", approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId,
                } as never, roster.version);
            break;
          }
          case "recruitment_result_routes__0": {
            // Restored: the attempt, its schedule and the paper entry being
            // scored (its marks cap the evaluation).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            const s = await attemptRepo.findSchedule(p.tenantId, a.scheduleId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
            const entry = (s.paper as PaperEntry[]).find((q) => q.questionId === body.questionId);
            if (!entry) throw new HttpError(422, "UNKNOWN_QUESTION", "question is not part of this attempt");
            await resultRepo.saveEvaluation(tx, { tenantId: p.tenantId, attemptId: id, questionId: body.questionId, evaluatorId: msg.actorId, score: String(body.score), maxMarks: entry.marks, remarks: body.remarks ?? null });
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "evaluate", detail: { questionId: body.questionId, score: Number(body.score) }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__1": {
            // Restored: the attempt, its paper + responses, the manual
            // evaluations, the consolidated score and whether a prior moderation
            // is being invalidated by this re-consolidation.
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            const s = await attemptRepo.findSchedule(p.tenantId, a.scheduleId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "schedule not found");
            const blueprint = await blueprintRepo.findBlueprint(p.tenantId, a.blueprintId);
            const scoring = (blueprint?.scoringConfig ?? {}) as { negativeMarking?: { enabled: boolean; fraction?: number }; totalCutoffPct?: number; sections?: Array<{ key: string; sectionCutoffPct?: number }> };
            const paper = s.paper as PaperEntry[];
            const responses = await attemptRepo.listResponses(p.tenantId, id);
            const respByQ = new Map(responses.map((r) => [r.questionId, r.response as Record<string, unknown>]));
            const evals = await resultRepo.listEvaluations(p.tenantId, id);
            const objectiveByQ = new Map<string, ObjectiveScore>();
            const manualByQ = new Map<string, number>();
            for (const e of paper) {
              const sc = scoreObjective(e, respByQ.get(e.questionId), scoring.negativeMarking);
              if (sc.auto) objectiveByQ.set(e.questionId, sc);
              else {
                const qEvals = evals.filter((v) => v.questionId === e.questionId).map((v) => Number(v.score));
                if (qEvals.length > 0) manualByQ.set(e.questionId, aggregateEvaluations(qEvals));
              }
            }
            const { scored, missing } = consolidatedScores(paper, objectiveByQ, manualByQ);
            if (missing.length > 0) throw new HttpError(422, "PENDING_EVALUATION", `${missing.length} manual question(s) still need evaluation`);
            const result = computeAttemptResult(paper, scored, { ...(scoring.totalCutoffPct != null ? { totalCutoffPct: scoring.totalCutoffPct } : {}), sections: scoring.sections ?? [] });
            const priorMod = (a.moderation ?? {}) as { proposedBy?: string };
            const hadModeration = Boolean(priorMod.proposedBy || a.moderatedBy);
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    totalScore: String(result.totalScore), rawTotalScore: String(result.totalScore), maxScore: String(result.maxScore),
                    sectionScores: result.sectionScores as never, needsManualEval: false, result: result.result, evaluatedAt: new Date(),
                    moderation: {} as never, moderatedBy: null, moderatedAt: null, updatedBy: msg.actorId,
                  } as never, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "consolidate", detail: { totalScore: result.totalScore, result: result.result }, actorId: msg.actorId });
                  if (hadModeration) await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "moderation_reset", detail: { reason: "re-consolidation invalidated the prior moderation" }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__2": {
            // Restored: the attempt (its raw total is snapshotted into the proposal).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    // rawSnapshot binds the checker's approval to the exact raw score under
                    // review, so an approval cannot be applied against a different raw total.
                    moderation: { method: body.method, factor: numOrNull(body.factor), notes: body.notes ?? null, proposedBy: msg.actorId, proposedAt: new Date().toISOString(), rawSnapshot: String(a.rawTotalScore) } as never,
                    moderatedBy: null, moderatedAt: null, updatedBy: msg.actorId,
                  } as never, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "moderate_propose", detail: { method: body.method, factor: numOrNull(body.factor) }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__3": {
            // Restored: the attempt, the pending moderation proposal, and the
            // moderated total + result band derived from the blueprint cut-offs.
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            const mod = (a.moderation ?? {}) as { method?: string; factor?: number; proposedBy?: string; rawSnapshot?: string };
            if (!mod.proposedBy) throw new HttpError(409, "NO_PROPOSAL", "there is no moderation proposal to approve");
            const blueprint = await blueprintRepo.findBlueprint(p.tenantId, a.blueprintId);
            const scoring = (blueprint?.scoringConfig ?? {}) as { totalCutoffPct?: number; sections?: Array<{ key: string; sectionCutoffPct?: number }> };
            const raw = Number(a.rawTotalScore);
            const max = Number(a.maxScore);
            const moderatedTotal = applyModeration(raw, max, mod as Moderation);
            const result = resultAfterModeration(a.sectionScores as never, { ...(scoring.totalCutoffPct != null ? { totalCutoffPct: scoring.totalCutoffPct } : {}), sections: scoring.sections ?? [] }, moderatedTotal, max);
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    totalScore: String(moderatedTotal), result, moderatedBy: msg.actorId, moderatedAt: new Date(),
                    moderation: { ...mod, approvedBy: msg.actorId, approvedAt: new Date().toISOString() } as never, updatedBy: msg.actorId,
                  } as never, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "moderate_approve", detail: { rawTotal: raw, moderatedTotal, result }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__4": {
            // Restored: the attempt (the frozen event records its final scores).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            await attemptRepo.updateAttempt(tx, p.tenantId, id, { frozen: true, frozenBy: msg.actorId, frozenAt: new Date(), updatedBy: msg.actorId } as never, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "freeze", detail: { result: a.result, totalScore: a.totalScore }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__5": {
            // Restored: the attempt (the publish event records the result band).
            const a = await attemptRepo.findAttempt(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "attempt not found");
            await attemptRepo.updateAttempt(tx, p.tenantId, id, { published: true, publishedAt: new Date(), updatedBy: msg.actorId } as never, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "publish", detail: { result: a.result }, actorId: msg.actorId });
            break;
          }
          case "recruitment_resume_routes__0": {
            // Restored: the candidate (existence) and the new resume version's id.
            const c = await candidateRepo.findCandidate(p.tenantId, id);
            if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
            const rid = genId;
            const r = await resumeRepo.createResumeVersion(tx, {
                    id: rid, tenantId: p.tenantId, candidateId: id,
                    fileKey: body.fileKey, fileName: body.fileName, mimeType: body.mimeType,
                    fileSizeBytes: BigInt(body.fileSizeBytes),
                    fingerprint: body.fingerprint ?? null, label: body.label ?? null,
                    actorId: msg.actorId,
                  }, Boolean(body.makeActive ?? false));
                  await emitAudit(tx, auditCtx, "resume_uploaded", "candidate_resume", rid, { candidateId: id, versionNo: r.versionNo });
            break;
          }
          case "recruitment_resume_routes__1": {
            // Restored: the resume version being activated (its file key is
            // denormalised onto the candidate). `resumeId` is a PATH parameter.
            const resumeId = params.resumeId as string;
            const resume = await resumeRepo.findResume(p.tenantId, id, resumeId);
            if (!resume) throw new HttpError(404, "NOT_FOUND", "resume version not found");
            await resumeRepo.activateResume(tx, p.tenantId, id, resumeId, resume.fileKey, msg.actorId);
            break;
          }
          case "recruitment_screening_override_routes__0": {
            // Restored: the application (the FROM decision, its version and the
            // original screener are snapshotted onto the request) and the new
            // request's id.
            const a = await screeningRepo.findApplication(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
            const rid = genId;
            await overrideRepo.createRequest(tx, {
                    id: rid, tenantId: p.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
                    fromDecision: a.screeningDecision, toDecision: body.toDecision,
                    applicationVersion: a.version,
                    reasonCode: body.reasonCode ?? null, reason: body.reason,
                    status: "pending", originalScreenedBy: a.screenedBy ?? null,
                    requestedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_screening_override_routes__1": {
            // Restored: the override request and the application it overturns
            // (both under their own optimistic-version guards).
            const r = await overrideRepo.findRequest(p.tenantId, reqId);
            if (!r) throw new HttpError(404, "NOT_FOUND", "override request not found");
            const a = await screeningRepo.findApplication(p.tenantId, r.applicationId);
            if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
            await screeningRepo.setScreening(tx, p.tenantId, r.applicationId, {
                      screeningDecision: r.toDecision,
                      screeningReasonCode: r.reasonCode ?? null,
                      screeningRemarks: r.reason,
                      screenedBy: msg.actorId, screenedAt: new Date(),
                    }, a.version);
                    await screeningRepo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: r.applicationId, jobOpeningId: r.jobOpeningId,
                      action: "override", decision: r.toDecision, reasonCode: r.reasonCode ?? null,
                      remarks: r.reason, isOverride: true, actorId: msg.actorId,
                    });
                    await overrideRepo.setRequestStatus(tx, p.tenantId, reqId, {
                      status: "approved", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                    }, r.version);
                    await emitAudit(tx, auditCtx, "screening_override_approved", "screening_override", reqId, {
                      applicationId: r.applicationId, fromDecision: r.fromDecision, toDecision: r.toDecision, requestedBy: r.requestedBy,
                    });
            break;
          }
          case "recruitment_screening_override_routes__2": {
            // Restored: the override request (for the optimistic-version guard).
            const r = await overrideRepo.findRequest(p.tenantId, reqId);
            if (!r) throw new HttpError(404, "NOT_FOUND", "override request not found");
            await overrideRepo.setRequestStatus(tx, p.tenantId, reqId, {
                    status: "rejected", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                  }, r.version);
            break;
          }
          case "recruitment_screening_override_routes__3": {
            // Restored: the override request (for the optimistic-version guard).
            const r = await overrideRepo.findRequest(p.tenantId, reqId);
            if (!r) throw new HttpError(404, "NOT_FOUND", "override request not found");
            await overrideRepo.setRequestStatus(tx, p.tenantId, reqId, {
                    status: "cancelled", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                  }, r.version);
            break;
          }
          case "recruitment_screening_routes__0": {
            // Restored: the vacancy's applications and the screened/skipped
            // counters the loop maintains.
            const applications = await screeningRepo.listApplicationsForVacancy(p.tenantId, id);
            let screened = 0, skipped = 0;
            for (const a of applications) {
                    if (a.screeningDecision !== "pending") { skipped++; continue; }
                    const decision = autoScreenDecision(a.eligibilityResult as { eligible?: boolean } | null);
                    if (decision === "pending") { skipped++; continue; } // never evaluated for eligibility
                    await screeningRepo.setScreeningById(tx, p.tenantId, a.id, {
                      screeningDecision: decision,
                      screeningReasonCode: decision === "ineligible" ? "eligibility" : null,
                      screenedBy: msg.actorId, screenedAt: new Date(),
                    });
                    await screeningRepo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: a.id, jobOpeningId: id, action: "auto_screen",
                      decision, reasonCode: decision === "ineligible" ? "eligibility" : null, actorId: msg.actorId,
                    });
                    screened++;
                  }
            log.info({ op, jobOpeningId: id, screened, skipped }, "auto-screen applied");
            break;
          }
          case "recruitment_screening_routes__1": {
            // Restored: the application (its job opening and version).
            const a = await screeningRepo.findApplication(p.tenantId, id);
            if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");
            await screeningRepo.setScreening(tx, p.tenantId, id, {
                      screeningDecision: body.decision,
                      screeningReasonCode: body.reasonCode ?? null,
                      screeningRemarks: body.remarks ?? null,
                      screenedBy: msg.actorId, screenedAt: new Date(),
                    }, a.version);
                    await screeningRepo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
                      action: "decision", decision: body.decision,
                      reasonCode: body.reasonCode ?? null, remarks: body.remarks ?? null,
                      isOverride: false, actorId: msg.actorId,
                    });
            break;
          }
          case "recruitment_screening_routes__2": {
            // Restored: the requested applications (scoped to this vacancy) and
            // the shortlisted/skipped counters.
            const apps = await screeningRepo.findApplicationsByIds(p.tenantId, id, (body.applicationIds ?? []) as string[]);
            let shortlisted = 0, skipped = 0;
            for (const a of apps) {
                    if (a.shortlistFrozen) { skipped++; continue; }
                    // Bulk shortlist advances the NORMAL forward path (pending / eligible ->
                    // shortlisted; idempotent on shortlisted). It must NOT silently overturn a
                    // deliberate non-shortlist decision — a rejection (ineligible), a
                    // waitlist, or a manual-review hold. Overturning one of those is an
                    // override that must go through the screening-decision endpoint (admin +
                    // reason, audited as an override).
                    if (BULK_SHORTLIST_BLOCKED.has(a.screeningDecision)) { skipped++; continue; }
                    await screeningRepo.setScreeningById(tx, p.tenantId, a.id, {
                      screeningDecision: "shortlisted", screenedBy: msg.actorId, screenedAt: new Date(),
                    });
                    await screeningRepo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: a.id, jobOpeningId: id, action: "shortlist",
                      decision: "shortlisted", actorId: msg.actorId,
                    });
                    shortlisted++;
                  }
            log.info({ op, jobOpeningId: id, shortlisted, skipped }, "bulk shortlist applied");
            break;
          }
          case "recruitment_screening_routes__3": {
            // Restored: the not-yet-frozen shortlisted applications for the vacancy.
            const all = await screeningRepo.listApplicationsForVacancy(p.tenantId, id);
            const shortlisted = all.filter((a) => a.screeningDecision === "shortlisted" && !a.shortlistFrozen);
            for (const a of shortlisted) {
                    await screeningRepo.setScreeningById(tx, p.tenantId, a.id, { shortlistFrozen: true });
                    await screeningRepo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: a.id, jobOpeningId: id, action: "freeze",
                      decision: "shortlisted", actorId: msg.actorId,
                    });
                  }
            break;
          }
          case "recruitment_selection_routes__0": {
            // Restored: the job opening (the `:id` path param) and the new list's id.
            const jobOpeningId = id;
            const listId = genId;
            await selectionRepo.insertList(tx, {
                  id: listId, tenantId: p.tenantId, jobOpeningId, title: body.title, vacancies: numOr(body.vacancies, 1),
                  status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "recruitment_selection_routes__1": {
            // Restored: the list (for the optimistic-version guard).
            const list = await selectionRepo.findList(p.tenantId, id);
            if (!list) throw new HttpError(404, "NOT_FOUND", "selection list not found");
            await selectionRepo.setEntries(tx, p.tenantId, id, ((body.entries ?? []) as Array<Record<string, any>>).map((e) => ({
                      tenantId: p.tenantId, listId: id, applicationId: e.applicationId, candidateName: e.candidateName,
                      category: e.category, rank: Number(e.rank), score: e.score != null ? String(e.score) : null, remarks: e.remarks ?? null,
                    })));
                    // Record who authored the ranking (for SoD against the approver) and bump
                    // the version so a concurrent approve binds to this exact roster.
                    await selectionRepo.updateList(tx, p.tenantId, id, { entriesSetBy: msg.actorId, entriesSetAt: new Date(), updatedBy: msg.actorId } as never, list.version);
            break;
          }
          case "recruitment_selection_routes__2": {
            // Restored: the list and the validity date (YYYY-MM-DD).
            const list = await selectionRepo.findList(p.tenantId, id);
            if (!list) throw new HttpError(404, "NOT_FOUND", "selection list not found");
            const validUntil = new Date(body.validUntil).toISOString().slice(0, 10);
            await selectionRepo.updateList(tx, p.tenantId, id, {
                  status: "approved", validityUntil: validUntil, approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId,
                } as never, list.version);
            break;
          }
          case "recruitment_selection_routes__3": {
            // Restored: the list (for the optimistic-version guard).
            const list = await selectionRepo.findList(p.tenantId, id);
            if (!list) throw new HttpError(404, "NOT_FOUND", "selection list not found");
            await selectionRepo.updateList(tx, p.tenantId, id, { status: "published", publishedAt: new Date(), updatedBy: msg.actorId } as never, list.version);
            break;
          }
          case "recruitment_selection_routes__4": {
            // Restored: the list (for the optimistic-version guard).
            const list = await selectionRepo.findList(p.tenantId, id);
            if (!list) throw new HttpError(404, "NOT_FOUND", "selection list not found");
            await selectionRepo.updateList(tx, p.tenantId, id, { status: "expired", updatedBy: msg.actorId } as never, list.version);
            break;
          }
          case "recruitment_skills_routes__0": {
            await skillsRepo.setSkills(tx, p.tenantId, id, ((body.skills ?? []) as Array<Record<string, any>>).map((s) => ({
                  // Round to the column's 1-decimal scale so we don't silently store a
                  // rounded value that differs from what was submitted.
                  tenantId: p.tenantId, candidateId: id, skill: s.skill, proficiency: s.proficiency, yearsExperience: s.yearsExperience != null ? String(Math.round(Number(s.yearsExperience) * 10) / 10) : null,
                })));
            break;
          }
          case "recruitment_skills_routes__1": {
            await skillsRepo.setCertifications(tx, p.tenantId, id, ((body.certifications ?? []) as Array<Record<string, any>>).map((c) => ({
                  tenantId: p.tenantId, candidateId: id, certName: c.name, issuer: c.issuer,
                  issueDate: c.issueDate ?? null, expiryDate: c.expiryDate ?? null, credentialId: c.credentialId ?? null, credentialUrl: c.credentialUrl ?? null,
                })));
            break;
          }
          case "recruitment_skills_routes__2": {
            await skillsRepo.setLanguages(tx, p.tenantId, id, ((body.languages ?? []) as Array<Record<string, any>>).map((l) => ({
                  tenantId: p.tenantId, candidateId: id, language: l.language, canRead: l.canRead ?? false, canWrite: l.canWrite ?? false, canSpeak: l.canSpeak ?? false, proficiency: l.proficiency ?? null,
                })));
            break;
          }
          case "recruitment_skills_routes__3": {
            await skillsRepo.setCredentials(tx, p.tenantId, id, ((body.credentials ?? []) as Array<Record<string, any>>).map((c) => ({
                  tenantId: p.tenantId, candidateId: id, kind: c.kind, title: c.title, detail: c.detail ?? null, credYear: numOrNull(c.year), referenceUrl: c.referenceUrl ?? null,
                })));
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
