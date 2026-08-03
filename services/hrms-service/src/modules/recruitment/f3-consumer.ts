import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  randomizeQuestionOrder, attemptDeadline, scoreObjective, computeAttemptResult,
  type PaperEntry, type ObjectiveScore,
} from "./attempt-domain.js";
import * as bp from "./blueprint-repo.js";
import * as repo from "./attempt-repo.js";
import {
  RESERVATION_CATEGORIES, validateRoster, validateLocationRosters, unmappedCategories,
  allocateShortlist, allocateByLocation, type Roster, type Candidate,
} from "./reservation-domain.js";
import * as repo from "./reservation-repo.js";
import { validateResumeUpload, resumeKeyPrefix, RESUME_MIME_TYPES } from "./resume-domain.js";
import * as candidateRepo from "./candidate-repo.js";
import * as repo from "./resume-repo.js";
import * as repo from "./publication-repo.js";
import * as repo from "./screening-override-repo.js";
import * as screeningRepo from "./screening-repo.js";
import * as repo from "./repo.js";
import * as repo from "./screening-repo.js";
import * as repo from "./application-fee-repo.js";
import { scoreObjective, computeAttemptResult, type PaperEntry, type ObjectiveScore } from "./attempt-domain.js";
import {
  aggregateEvaluations, consolidatedScores, validateModeration, applyModeration, resultAfterModeration,
  MODERATION_METHODS, type Moderation,
} from "./result-domain.js";
import * as attemptRepo from "./attempt-repo.js";
import * as repo from "./result-repo.js";
import * as repo from "./otp-verify-repo.js";
import {
  PANEL_ROLES, COI_TYPES, REJECTION_REASONS, OUTCOME_STATUSES,
  panelReadiness, validateOutcome, type Panelist,
} from "./panel-domain.js";
import * as repo from "./panel-repo.js";
import * as repo from "./interview-recording-repo.js";
import * as ivRepo from "./interview-comms-repo.js";
import { ENTRY_CATEGORIES, validateEntries, validateApproval, isWithinValidity, type Entry } from "./selection-domain.js";
import * as repo from "./selection-repo.js";
import * as repo from "./candidate-repo.js";
import { offerFunnel, acceptanceRatePct, pendingAgeing, declineBreakdown, type OfferStat } from "./offer-analytics-domain.js";
import * as offerRepo from "./offer-repo.js";
import * as analyticsRepo from "./offer-analytics-repo.js";
import * as repo from "./eligibility-repo.js";
import {
  DISABILITY_TYPES, validateReservationAttributes, validateReferences, validateRelationshipDeclaration,
  type Reference, type RelationshipDeclaration,
} from "./reference-domain.js";
import * as repo from "./reference-repo.js";
import {
  DEFAULT_OFFER_CHAIN, DECLINE_REASON_CODES, currentStageRole, isFinalStage,
  computeCompensation, canRelease, isTerminal, isOfferEditable, type ApprovalStage,
} from "./offer-domain.js";
import * as repo from "./offer-repo.js";
import * as repo from "./interview-comms-repo.js";
import {
  DEFAULT_GOVT_CHAIN, currentStageRole, isFinalStage, canPublish, isEditable, cloneFields, toVacancyType,
  type ApprovalStage,
} from "./requisition-domain.js";
import * as repo from "./requisition-repo.js";
import {
  PROFICIENCY_LEVELS, LANGUAGE_PROFICIENCY, CREDENTIAL_KINDS,
  validateSkills, validateCertifications, validateLanguages, validateCredentials,
  type Skill, type Certification, type Language, type Credential,
} from "./skills-domain.js";
import * as repo from "./skills-repo.js";
import * as repo from "./interview-response-repo.js";
import { randomizeQuestionOrder, type PaperEntry } from "./attempt-domain.js";
import {
  attendanceStats, cutoffStats, scoreDistribution, itemAnalysis,
  type AttemptStat, type QuestionResponse,
} from "./report-domain.js";
import * as resultRepo from "./result-repo.js";
import * as reportRepo from "./report-repo.js";
import * as repo from "./rejection-notice-repo.js";
import * as repo from "./interview-scoring-repo.js";
import { validateExperience, type Employment, type ExperienceRequirement } from "./experience-domain.js";
import { validateEducation, EDUCATION_LEVELS, type Qualification, type EducationRequirement } from "./education-domain.js";
import * as repo from "./qualification-repo.js";
import {
  QTYPES, DIFFICULTIES, TIE_BREAK_RULES,
  validateBlueprintDraft, questionReadyToValidate, totalMarks,
} from "./blueprint-domain.js";
import * as repo from "./blueprint-repo.js";
const log = pino({ name: "hrms-f3-recruitment" });
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
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "recruitment_application_fee_routes__0": {
            await repo.insertFee(tx, {
                    id: fid, tenantId: p.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
                    amountMinor: assessment.amountMinor, currency: "INR", status: assessment.status,
                    exemptionReason: assessment.exemptionReason, provider: "none",
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_application_fee_routes__1": {
            await repo.updateFee(tx, p.tenantId, fee.id, {
                      status: "paid", provider: "manual", paymentRef, paidAt: new Date(), updatedBy: msg.actorId,
                    }, fee.version);
                    await emitAudit(tx, ctx, "application_fee_paid", "application_fee", fee.id, {
                      applicationId: id, amountMinor: fee.amountMinor.toString(), provider: "manual", paymentRef,
                    });
            break;
          }
          case "recruitment_attempt_routes__0": {
            await repo.insertSchedule(tx, {
                  id, tenantId: p.tenantId, blueprintId: body.blueprintId, title: body.title, mode: body.mode,
                  windowStart: new Date(body.windowStart), windowEnd: new Date(body.windowEnd),
                  slots: body.slots as never, paper: paper as never, totalMarks, status: "scheduled",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "recruitment_attempt_routes__1": {
            await repo.updateSchedule(tx, p.tenantId, id, { status: to, updatedBy: msg.actorId }, s.version);
            break;
          }
          case "recruitment_attempt_routes__2": {
            await repo.insertAttempt(tx, {
                    id: attemptId, tenantId: p.tenantId, scheduleId: id, blueprintId: s.blueprintId,
                    candidateId: body.candidateId, applicationId: body.applicationId ?? null, slotLabel: body.slotLabel ?? null,
                    status: "assigned", accommodation: (body.accommodation ?? {}) as never, questionOrder: order as never,
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_attempt_routes__3": {
            await repo.updateAttempt(tx, p.tenantId, id, { accommodation: { extraTimePct: body.extraTimePct, notes: body.notes ?? null } as never, updatedBy: msg.actorId }, a.version);
            break;
          }
          case "recruitment_attempt_routes__4": {
            await repo.updateAttempt(tx, p.tenantId, id, {
                  identityVerified: true, identityMethod: body.method, identityMeta: (body.meta ?? {}) as never, identityVerifiedAt: new Date(), updatedBy: msg.actorId,
                }, a.version);
            break;
          }
          case "recruitment_attempt_routes__5": {
            await repo.updateAttempt(tx, p.tenantId, id, { status: "in_progress", startedAt: new Date(now), deadlineAt: deadline, updatedBy: msg.actorId }, a.version);
            break;
          }
          case "recruitment_attempt_routes__6": {
            for (const r of body.responses) {
                    await repo.saveResponse(tx, { tenantId: p.tenantId, attemptId: id, questionId: r.questionId, response: r.response as never });
                  }
                  await repo.updateAttempt(tx, p.tenantId, id, { lastSavedAt: new Date(), updatedBy: msg.actorId }, a.version);
            break;
          }
          case "recruitment_attempt_routes__7": {
            for (const entry of paper) {
                    const sc = scored.get(entry.questionId)!;
                    if (sc.auto && respByQ.has(entry.questionId)) {
                      await repo.updateResponseScore(tx, p.tenantId, id, entry.questionId, sc.score, sc.isCorrect);
                    }
                  }
                  await repo.updateAttempt(tx, p.tenantId, id, {
                    status: "evaluated", submittedAt: new Date(), evaluatedAt: new Date(),
                    totalScore: String(result.totalScore), maxScore: String(result.maxScore),
                    sectionScores: result.sectionScores as never, needsManualEval: result.needsManualEval, result: result.result,
                    updatedBy: msg.actorId,
                  }, a.version);
            break;
          }
          case "recruitment_blueprint_routes__0": {
            await repo.insertBlueprint(tx, {
                      id, tenantId: p.tenantId, code: body.code, title: body.title,
                      roleTitle: body.roleTitle ?? null, designationId: body.designationId ?? null,
                      competencies: body.competencies as never, allowedTypes: body.allowedTypes as never,
                      durationMinutes: body.durationMinutes, scoringConfig: body.scoringConfig as never,
                      status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "create", detail: { code: body.code }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__1": {
            await repo.updateBlueprint(tx, p.tenantId, id, patch as never, bp.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "update", detail: { changedFields }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__2": {
            await repo.updateBlueprint(tx, p.tenantId, id, {
                    status: "active", effectiveFrom, activatedBy: msg.actorId, activatedAt: new Date(), updatedBy: msg.actorId,
                  } as never, bp.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "activate", detail: { effectiveFrom: effectiveFrom.toISOString(), totalMarks: totalMarks(bp.scoringConfig as never) }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__3": {
            await repo.updateBlueprint(tx, p.tenantId, id, { status: "inactive", updatedBy: msg.actorId } as never, bp.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "blueprint", entityId: id, action: "deactivate", detail: { reason: body.reason ?? null }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__4": {
            await repo.insertQuestion(tx, {
                    id, tenantId: p.tenantId, topic: body.topic, qtype: body.qtype, stem: body.stem,
                    options: (body.options ?? []) as never, answerKey: (body.answerKey ?? {}) as never,
                    difficulty: body.difficulty, marks: body.marks, status: "draft",
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "create", detail: { topic: body.topic, qtype: body.qtype }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__5": {
            await repo.updateQuestion(tx, p.tenantId, id, patch as never, q.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "update", detail: { changedFields }, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__6": {
            await repo.updateQuestion(tx, p.tenantId, id, { status: "validated", validatedBy: msg.actorId, validatedAt: new Date(), updatedBy: msg.actorId } as never, q.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "validate", detail: {}, actorId: msg.actorId });
            break;
          }
          case "recruitment_blueprint_routes__7": {
            await repo.updateQuestion(tx, p.tenantId, id, { status: "retired", updatedBy: msg.actorId } as never, q.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, entityType: "question", entityId: id, action: "retire", detail: { reason: body.reason ?? null }, actorId: msg.actorId });
            break;
          }
          case "recruitment_candidate_routes__0": {
            await repo.insertCandidate(tx, {
                    id, tenantId: p.tenantId, email: body.email, normalizedEmail: nEmail,
                    ...(body.mobile ? { mobile: body.mobile, normalizedMobile: nMobile ?? null } : {}),
                    emailVerified: body.emailVerified ?? false, mobileVerified: body.mobileVerified ?? false,
                    ...pick(body),
                    status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_candidate_routes__1": {
            await repo.updateCandidate(tx, p.tenantId, id, patch, c.version);
            break;
          }
          case "recruitment_candidate_routes__2": {
            await repo.insertEducation(tx, {
                  id: eid, tenantId: p.tenantId, candidateId: id, qualification: body.qualification,
                  ...(body.subject ? { subject: body.subject } : {}),
                  ...(body.institution ? { institution: body.institution } : {}),
                  ...(body.boardUniversity ? { boardUniversity: body.boardUniversity } : {}),
                  ...(body.yearOfPassing != null ? { yearOfPassing: body.yearOfPassing } : {}),
                  ...(body.marksPercent != null ? { marksPercent: String(body.marksPercent) } : {}),
                  ...(body.grade ? { grade: body.grade } : {}),
                  createdBy: msg.actorId,
                });
            break;
          }
          case "recruitment_candidate_routes__3": {
            await repo.insertEmployment(tx, {
                  id: eid, tenantId: p.tenantId, candidateId: id, employer: body.employer,
                  ...(body.roleTitle ? { roleTitle: body.roleTitle } : {}),
                  ...(body.fromDate ? { fromDate: body.fromDate } : {}),
                  ...(body.toDate ? { toDate: body.toDate } : {}),
                  ...(body.noticePeriodDays != null ? { noticePeriodDays: body.noticePeriodDays } : {}),
                  ...(body.ctcMinor != null ? { ctcMinor: BigInt(body.ctcMinor) } : {}),
                  ...(body.reasonForLeaving ? { reasonForLeaving: body.reasonForLeaving } : {}),
                  createdBy: msg.actorId,
                });
            break;
          }
          case "recruitment_candidate_routes__4": {
            await repo.updateCandidate(tx, p.tenantId, id, {
                  status: "submitted", submittedAt: new Date(),
                  consentVersion: body.consentVersion ?? null, consentAcceptedAt: new Date(), updatedBy: msg.actorId,
                }, c.version);
            break;
          }
          case "recruitment_candidate_routes__5": {
            await repo.updateCandidate(tx, p.tenantId, id, { status: "withdrawn", withdrawnAt: new Date(), updatedBy: msg.actorId }, c.version);
            break;
          }
          case "recruitment_candidate_routes__6": {
            await repo.updateCandidate(tx, p.tenantId, id, { dataRequestAt: new Date(), updatedBy: msg.actorId }, c.version);
            break;
          }
          case "recruitment_eligibility_routes__0": {
            await repo.setVacancyEligibility(tx, p.tenantId, id, body, v.version);
            break;
          }
          case "recruitment_eligibility_routes__1": {
            await repo.insertApplication(tx, {
                    id: appId, tenantId: p.tenantId, jobOpeningId: id,
                    applicantName: body.applicantName, email: body.email,
                    mobile: body.mobile ?? null, resumeRef: body.resumeRef ?? null,
                    skills: body.skills ?? null,
                    qualification: body.qualification ?? null,
                    experienceYears: body.experienceYears ?? null,
                    applicationNo, dateOfBirth: body.dateOfBirth ?? null,
                    category: body.category ?? null,
                    eligibilityResult: result as never,
                    dedupKey,
                    source: "eligibility_apply", stage: "applied", status: "active",
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_eligibility_routes__2": {
            await repo.withdrawApplication(tx, p.tenantId, id, body.reason, a.version);
            break;
          }
          case "recruitment_interview_comms_routes__0": {
            if (body.type === "reschedule") {
                      const ok = await repo.rescheduleInterview(tx, p.tenantId, id, body.newDate!, body.newTime!, msg.actorId, iv.version);
                      if (!ok) throw new Error("VERSION_CONFLICT");
                    } else if (body.type === "cancel") {
                      const ok = await repo.cancelInterview(tx, p.tenantId, id, iv.version);
                      if (!ok) throw new Error("VERSION_CONFLICT");
                    }
                    await repo.insertComm(tx, {
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
            await repo.insertRecording(tx, {
                  id: rid, tenantId: p.tenantId, interviewId: id, applicationId: iv.applicationId,
                  kind: body.kind, storageKey: body.storageKey,
                  consentGiven: true, consentReference: body.consentReference ?? null,
                  consentBy: msg.actorId, consentAt: new Date(),
                  retentionUntil, status: "active", createdBy: msg.actorId,
                });
            break;
          }
          case "recruitment_interview_recording_routes__1": {
            await repo.softDelete(tx, p.tenantId, id, msg.actorId, rec.version);
            break;
          }
          case "recruitment_interview_response_routes__0": {
            await repo.insertResponse(tx, {
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
            const ok = await ivRepo.rescheduleInterview(tx, p.tenantId, r.interviewId, preferredDate, r.preferredTime!, msg.actorId, iv.version);
                    if (!ok) throw new Error("VERSION_CONFLICT");
                    await repo.setResponseStatus(tx, p.tenantId, reqId, {
                      status: "approved", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                    }, r.version);
            break;
          }
          case "recruitment_interview_response_routes__2": {
            await repo.setResponseStatus(tx, p.tenantId, reqId, {
                    status: "declined", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                  }, r.version);
            break;
          }
          case "recruitment_interview_routes__0": {
            await repo.insertInterview(tx, {
                    id,
                    tenantId: p.tenantId,
                    applicationId: body.applicationId,
                    jobOpeningId: body.jobOpeningId,
                    roundNumber: body.roundNumber,
                    roundType: body.roundType,
                    scheduledDate,
                    scheduledTime,
                    durationMinutes: body.durationMinutes,
                    mode: MODE_DB[body.mode] ?? "video",
                    panelMembers: body.interviewerIds,
                    status: "scheduled",
                    feedback: body.notes ?? null,
                    createdBy: msg.actorId,
                  });
            break;
          }
          case "recruitment_interview_routes__1": {
            await repo.updateInterviewScorecard(tx, id, p.tenantId, scorecard, RECO_DB[body.recommendation] ?? null);
            break;
          }
          case "recruitment_interview_scoring_routes__0": {
            await repo.updateInterview(tx, p.tenantId, id, {
                  scorecardTemplate: body.competencies as never,
                  ...(body.cutoffScore != null ? { cutoffScore: body.cutoffScore } : {}),
                }, iv.version);
            break;
          }
          case "recruitment_interview_scoring_routes__1": {
            await repo.insertScore(tx, {
                    tenantId: p.tenantId, interviewId: id, interviewerId: msg.actorId,
                    scores: body.scores, overallScore: Math.round(overall), comments: body.comments ?? null,
                  });
            break;
          }
          case "recruitment_interview_scoring_routes__2": {
            await repo.updateInterview(tx, p.tenantId, id, {
                  panelScore: Math.round(result.weightedScore), recommendation: result.recommendation,
                  status: "completed", consolidatedAt: new Date(),
                }, iv.version);
            break;
          }
          case "recruitment_offer_extra_routes__0": {
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
            await offerRepo.updateOffer(tx, p.tenantId, offerId, {
                  joiningExtensionStatus: "rejected",
                  joiningExtensionBy: msg.actorId,
                  joiningExtensionAt: new Date(),
                  updatedBy: msg.actorId,
                } as never, offer.version);
            break;
          }
          case "recruitment_offer_routes__0": {
            await repo.insertOffer(tx, {
                  id: offerId, tenantId: p.tenantId, applicationId: id,
                  offerNo: `OFR-${offerId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion,
                  basicMinor: c.basicMinor, joiningBonusMinor: c.joiningBonusMinor,
                  relocationMinor: c.relocationMinor, variablePayMinor: c.variablePayMinor,
                  grossCtcMinor: c.grossCtcMinor, ctcMinor: c.grossCtcMinor, // keep legacy ctc_minor in sync
                  ...(body.grade ? { grade: body.grade } : {}),
                  ...(body.templateRef ? { templateRef: body.templateRef } : {}),
                  ...(body.joiningDate ? { joiningDate: body.joiningDate } : {}),
                  approvalChain: chain, currentStage: -1, status: "draft",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "recruitment_offer_routes__1": {
            await repo.updateOffer(tx, p.tenantId, offerId, { status: "pending_approval", currentStage: 0 }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "submit", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__2": {
            await repo.updateOffer(tx, p.tenantId, offerId,
                    final ? { status: "approved", approvedAt: new Date() } : { currentStage: o.currentStage + 1 }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "approve", remarks: body.comments ?? null, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__3": {
            await repo.updateOffer(tx, p.tenantId, offerId, { status: "returned", currentStage: -1 }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "return", remarks: body.comments, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__4": {
            await repo.updateOffer(tx, p.tenantId, offerId, { status: "released", releasedAt: new Date(), ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}) }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "release", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__5": {
            await repo.updateOffer(tx, p.tenantId, offerId, {
                    status: "accepted", acceptedAt: new Date(), acceptedVersion: o.offerVersion, acceptanceMeta: meta as never,
                  }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "accept", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__6": {
            await repo.updateOffer(tx, p.tenantId, offerId, { status: "declined", declinedAt: new Date(), declineReasonCode: body.reasonCode, declineRemarks: body.remarks ?? null }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "decline", reasonCode: body.reasonCode, remarks: body.remarks ?? null, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__7": {
            await repo.updateOffer(tx, p.tenantId, offerId, { status: "withdrawn", withdrawReason: body.reason }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "withdraw", remarks: body.reason, actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__8": {
            await repo.updateOffer(tx, p.tenantId, offerId, { status: "expired" }, o.version);
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId, applicationId: o.applicationId, action: "expire", actorId: msg.actorId });
            break;
          }
          case "recruitment_offer_routes__9": {
            // supersede the previous
                  await repo.updateOffer(tx, p.tenantId, offerId, { status: "revised" }, prev.version);
                  await repo.insertOffer(tx, {
                    id: newId, tenantId: p.tenantId, applicationId: prev.applicationId,
                    offerNo: `OFR-${newId.slice(0, 8).toUpperCase()}`, offerVersion: nextVersion,
                    basicMinor: c.basicMinor, joiningBonusMinor: c.joiningBonusMinor,
                    relocationMinor: c.relocationMinor, variablePayMinor: c.variablePayMinor,
                    grossCtcMinor: c.grossCtcMinor, ctcMinor: c.grossCtcMinor,
                    grade: (body.grade ?? prev.grade) as string | null,
                    approvalChain: prev.approvalChain as never, currentStage: -1, status: "draft",
                    supersedesOfferId: offerId,
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  await repo.insertEvent(tx, { tenantId: p.tenantId, offerId: newId, applicationId: prev.applicationId, action: "revise", remarks: `supersedes ${prev.offerNo ?? offerId}`, actorId: msg.actorId });
            break;
          }
          case "recruitment_otp_verify_routes__0": {
            await repo.insertChallenge(tx, {
                  id: cid, tenantId: p.tenantId, candidateId: id, channel: body.channel,
                  code, expiresAt,
                });
            break;
          }
          case "recruitment_otp_verify_routes__1": {
            await repo.incrementAttempts(tx, p.tenantId, challenge.id);
            break;
          }
          case "recruitment_otp_verify_routes__2": {
            await repo.markVerified(tx, p.tenantId, challenge.id, id, body.channel);
            break;
          }
          case "recruitment_panel_routes__0": {
            await repo.setPanelists(tx, p.tenantId, id, body.members.map((m) => ({
                  tenantId: p.tenantId, interviewId: id, memberId: m.memberId, memberName: m.memberName, panelRole: m.panelRole,
                  availability: (m.availability ?? {}) as never, coiDeclared: m.coiDeclared, coiType: m.coiType, coiNote: m.coiNote ?? null,
                })));
            break;
          }
          case "recruitment_panel_routes__1": {
            await repo.recusePanelist(tx, p.tenantId, id, memberId);
            break;
          }
          case "recruitment_panel_routes__2": {
            await repo.updateInterview(tx, p.tenantId, id, {
                  outcomeStatus: body.status,
                  rejectionReason: body.status === "rejected" ? (body.rejectionReason ?? null) : null,
                  rejectionNote: body.status === "rejected" ? (body.rejectionNote ?? null) : null,
                  waitlistRank: body.status === "waitlisted" ? (body.waitlistRank ?? null) : null,
                  recommendationValidUntil: body.status === "rejected" ? null : validUntil,
                  outcomeBy: msg.actorId, outcomeAt: new Date(),
                } as never, interview.version);
            break;
          }
          case "recruitment_publication_routes__0": {
            await repo.updateVacancy(tx, p.tenantId, id, patch, v.version);
            break;
          }
          case "recruitment_publication_routes__1": {
            await repo.insertCorrigendum(tx, { tenantId: p.tenantId, jobOpeningId: id, seq, action: "corrigendum", changes: body.changes, actorId: msg.actorId });
                  await repo.updateVacancy(tx, p.tenantId, id, { corrigendumCount: seq, updatedBy: msg.actorId }, v.version);
            break;
          }
          case "recruitment_publication_routes__2": {
            await repo.insertCorrigendum(tx, {
                    tenantId: p.tenantId, jobOpeningId: id, seq, action: "extension",
                    changes: body.reason ?? `deadline extended to ${body.newDeadline}`, oldDeadline, newDeadline, actorId: msg.actorId,
                  });
                  // Extending REOPENS a closed vacancy so applications can resume (R-RA-0069).
                  await repo.updateVacancy(tx, p.tenantId, id, { applicationDeadline: newDeadline, status: "open", corrigendumCount: seq, updatedBy: msg.actorId }, v.version);
            break;
          }
          case "recruitment_publication_routes__3": {
            await repo.insertCorrigendum(tx, { tenantId: p.tenantId, jobOpeningId: id, seq, action: "cancellation", changes: body.reason, actorId: msg.actorId });
                  // Cancel preserves the advert (row untouched except status) — R-RA-0068.
                  await repo.updateVacancy(tx, p.tenantId, id, { status: "cancelled", corrigendumCount: seq, updatedBy: msg.actorId }, v.version);
            break;
          }
          case "recruitment_qualification_routes__0": {
            if (existing) await repo.updateRequirement(tx, p.tenantId, jobOpeningId, patch, existing.version);
                    else await repo.insertRequirement(tx, { id: randomUUID(), tenantId: p.tenantId, jobOpeningId, ...patch, createdBy: msg.actorId });
            break;
          }
          case "recruitment_reference_routes__0": {
            await repo.updateCandidateFields(tx, p.tenantId, id, {
                  category, subCategory: body.subCategory ?? null, disability: body.disability,
                  disabilityType: body.disability ? (body.disabilityType ?? null) : null,
                  disabilityPercentage: body.disability ? (body.disabilityPercentage ?? null) : null,
                  exServiceman: body.exServiceman, freedomFighterDependent: body.freedomFighterDependent,
                  reservationDocs: (body.reservationDocs ?? []) as never, updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_reference_routes__1": {
            await repo.setReferences(tx, p.tenantId, id, body.references.map((r) => ({
                  tenantId: p.tenantId, candidateId: id, refName: r.name, relationship: r.relationship,
                  organisation: r.organisation ?? null, designation: r.designation ?? null,
                  email: r.email ?? null, phone: r.phone ?? null, yearsKnown: r.yearsKnown ?? null,
                })));
            break;
          }
          case "recruitment_reference_routes__2": {
            await repo.updateCandidateFields(tx, p.tenantId, id, {
                  // Drop any relations when the flag is false so the stored record can't be an
                  // inconsistent "false + populated relations" (which a COI consumer would miss).
                  relationshipDeclaration: { hasPriorRelationship: body.hasPriorRelationship, relations: body.hasPriorRelationship ? (body.relations ?? []) : [] } as never,
                  updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_rejection_notice_routes__0": {
            await repo.setDisclosurePolicy(tx, p.tenantId, id, body.discloseReason, msg.actorId);
            break;
          }
          case "recruitment_report_routes__0": {
            // Malpractice is also a post-publish REVOCATION: clear frozen/published so a
                  // voided result can never continue to surface as an authoritative published one.
                  await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    status: "void", disposition: "malpractice", dispositionReason: body.reason, dispositionBy: msg.actorId, dispositionAt: new Date(),
                    result: "not_qualified", frozen: false, published: false, updatedBy: msg.actorId,
                  }, a.version);
                  await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "malpractice", detail: { reason: body.reason, ...(body.evidence ? { evidence: body.evidence } : {}) }, actorId: msg.actorId });
            break;
          }
          case "recruitment_report_routes__1": {
            // Void the original first so the partial unique frees the candidate's slot.
                    await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                      status: "void", disposition: body.type, dispositionReason: body.reason, dispositionBy: msg.actorId, dispositionAt: new Date(),
                      supersededBy: newId, updatedBy: msg.actorId,
                    }, a.version);
                    await attemptRepo.insertAttempt(tx, {
                      id: newId, tenantId: p.tenantId, scheduleId: targetScheduleId, blueprintId: target.blueprintId,
                      candidateId: a.candidateId, applicationId: a.applicationId ?? null, status: "assigned",
                      accommodation: a.accommodation as never, questionOrder: order as never, createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    await resultRepo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "reschedule", detail: { type: body.type, reason: body.reason, newAttemptId: newId, targetScheduleId }, actorId: msg.actorId });
            break;
          }
          case "recruitment_requisition_routes__0": {
            await repo.insertRequisition(tx, {
                  id, tenantId: p.tenantId, requisitionNo: reqNo(id),
                  title: b.title,
                  ...(b.positionId ? { positionId: b.positionId } : {}),
                  ...(b.sourceManpowerReqId ? { sourceManpowerReqId: b.sourceManpowerReqId } : {}),
                  ...(b.reason ? { reason: b.reason } : {}),
                  employmentType: b.employmentType, recruitmentMode: b.recruitmentMode, campaignType: b.campaignType,
                  ...(b.departmentId ? { departmentId: b.departmentId } : {}),
                  ...(b.designationId ? { designationId: b.designationId } : {}),
                  ...(b.grade ? { grade: b.grade } : {}),
                  ...(b.location ? { location: b.location } : {}),
                  vacancies: b.vacancies, experienceMinYears: b.experienceMinYears,
                  ...(b.qualification ? { qualification: b.qualification } : {}),
                  ...(b.skills ? { skills: b.skills } : {}),
                  reservation: b.reservation,
                  ...(b.budgetMinor != null ? { budgetMinor: BigInt(b.budgetMinor) } : {}),
                  confidential: b.confidential,
                  ...(b.agencyId ? { agencyId: b.agencyId } : {}),
                  ...(b.targetHireDate ? { targetHireDate: b.targetHireDate } : {}),
                  ...(b.slaDays != null ? { slaDays: b.slaDays } : {}),
                  approvalChain: chain, currentStage: -1, status: "draft",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "recruitment_requisition_routes__1": {
            await repo.updateRequisition(tx, p.tenantId, id, patch, r.version);
            break;
          }
          case "recruitment_requisition_routes__2": {
            await repo.updateRequisition(tx, p.tenantId, id, {
                  status: "pending_approval", currentStage: 0, submittedAt: new Date(), updatedBy: msg.actorId,
                }, r.version);
            break;
          }
          case "recruitment_requisition_routes__3": {
            await repo.insertApproval(tx, {
                    tenantId: p.tenantId, requisitionId: id, stage: r.currentStage, stageRole: role,
                    action: "approve", comments: body.comments ?? null, actorId: msg.actorId,
                  });
                  await repo.updateRequisition(tx, p.tenantId, id,
                    final
                      ? { status: "approved", approvedAt: new Date(), updatedBy: msg.actorId }
                      : { currentStage: r.currentStage + 1, updatedBy: msg.actorId },
                    r.version);
            break;
          }
          case "recruitment_requisition_routes__4": {
            await repo.insertApproval(tx, {
                    tenantId: p.tenantId, requisitionId: id, stage: r.currentStage, stageRole: role,
                    action: "return", comments: body.comments, actorId: msg.actorId,
                  });
                  await repo.updateRequisition(tx, p.tenantId, id, {
                    status: "returned", currentStage: -1, updatedBy: msg.actorId,
                  }, r.version);
            break;
          }
          case "recruitment_requisition_routes__5": {
            await repo.updateRequisition(tx, p.tenantId, id, {
                  status: "on_hold", holdReason: body.reason, updatedBy: msg.actorId,
                }, r.version);
            break;
          }
          case "recruitment_requisition_routes__6": {
            await repo.updateRequisition(tx, p.tenantId, id, {
                  status: restored, holdReason: null, updatedBy: msg.actorId,
                }, r.version);
            break;
          }
          case "recruitment_requisition_routes__7": {
            await repo.updateRequisition(tx, p.tenantId, id, {
                  status: "cancelled", closeReason: body.reason, updatedBy: msg.actorId,
                }, r.version);
            break;
          }
          case "recruitment_requisition_routes__8": {
            await repo.updateRequisition(tx, p.tenantId, id, {
                  status: "closed", closeReason: body.reason, updatedBy: msg.actorId,
                }, r.version);
            break;
          }
          case "recruitment_requisition_routes__9": {
            await repo.insertRequisition(tx, {
                  ...(carried as object),
                  id: newId, tenantId: p.tenantId, requisitionNo: `REQ-${newId.slice(0, 8).toUpperCase()}`,
                  currentStage: -1, status: "draft",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                } as never);
            break;
          }
          case "recruitment_requisition_routes__10": {
            await repo.insertJobOpening(tx, {
                    id: openingId, tenantId: p.tenantId,
                    refNo: r.requisitionNo, title: r.title,
                    departmentId: r.departmentId!, designationId: r.designationId ?? null,
                    vacancies: r.vacancies, description: r.reason ?? null,
                    vacancyType: toVacancyType(r.recruitmentMode, r.campaignType), location: r.location ?? null,
                    qualification: r.qualification ?? null,
                    isPublished: "true", status: "open",
                    postedAt: new Date().toISOString().slice(0, 10),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  await repo.updateRequisition(tx, p.tenantId, id, {
                    status: "published", publishedOpeningId: openingId, publishedAt: new Date(), updatedBy: msg.actorId,
                  }, r.version);
            break;
          }
          case "recruitment_reservation_routes__0": {
            if (existing) {
                      await repo.updateRoster(tx, p.tenantId, jobOpeningId, {
                        totalVacancies: body.totalVacancies, categoryVacancies: body.categoryVacancies as never,
                        locationRosters: (body.locationRosters ?? {}) as never, updatedBy: msg.actorId,
                      }, existing.version);
                    } else {
                      await repo.insertRoster(tx, {
                        id: randomUUID(), tenantId: p.tenantId, jobOpeningId, totalVacancies: body.totalVacancies,
                        categoryVacancies: body.categoryVacancies as never, locationRosters: (body.locationRosters ?? {}) as never,
                        status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                      });
                    }
            break;
          }
          case "recruitment_reservation_routes__1": {
            await repo.updateRoster(tx, p.tenantId, jobOpeningId, {
                  status: "approved", approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId,
                }, roster.version);
            break;
          }
          case "recruitment_result_routes__0": {
            await repo.saveEvaluation(tx, { tenantId: p.tenantId, attemptId: id, questionId: body.questionId, evaluatorId: msg.actorId, score: String(body.score), maxMarks: entry.marks, remarks: body.remarks ?? null });
                  await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "evaluate", detail: { questionId: body.questionId, score: body.score }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__1": {
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    totalScore: String(result.totalScore), rawTotalScore: String(result.totalScore), maxScore: String(result.maxScore),
                    sectionScores: result.sectionScores as never, needsManualEval: false, result: result.result, evaluatedAt: new Date(),
                    moderation: {} as never, moderatedBy: null, moderatedAt: null, updatedBy: msg.actorId,
                  }, a.version);
                  await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "consolidate", detail: { totalScore: result.totalScore, result: result.result }, actorId: msg.actorId });
                  if (hadModeration) await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "moderation_reset", detail: { reason: "re-consolidation invalidated the prior moderation" }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__2": {
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    // rawSnapshot binds the checker's approval to the exact raw score under
                    // review, so an approval cannot be applied against a different raw total.
                    moderation: { method: body.method, factor: body.factor ?? null, notes: body.notes ?? null, proposedBy: msg.actorId, proposedAt: new Date().toISOString(), rawSnapshot: String(a.rawTotalScore) } as never,
                    moderatedBy: null, moderatedAt: null, updatedBy: msg.actorId,
                  }, a.version);
                  await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "moderate_propose", detail: { method: body.method, factor: body.factor ?? null }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__3": {
            await attemptRepo.updateAttempt(tx, p.tenantId, id, {
                    totalScore: String(moderatedTotal), result, moderatedBy: msg.actorId, moderatedAt: new Date(),
                    moderation: { ...mod, approvedBy: msg.actorId, approvedAt: new Date().toISOString() } as never, updatedBy: msg.actorId,
                  }, a.version);
                  await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "moderate_approve", detail: { rawTotal: raw, moderatedTotal, result }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__4": {
            await attemptRepo.updateAttempt(tx, p.tenantId, id, { frozen: true, frozenBy: msg.actorId, frozenAt: new Date(), updatedBy: msg.actorId }, a.version);
                  await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "freeze", detail: { result: a.result, totalScore: a.totalScore }, actorId: msg.actorId });
            break;
          }
          case "recruitment_result_routes__5": {
            await attemptRepo.updateAttempt(tx, p.tenantId, id, { published: true, publishedAt: new Date(), updatedBy: msg.actorId }, a.version);
                  await repo.insertResultEvent(tx, { tenantId: p.tenantId, attemptId: id, action: "publish", detail: { result: a.result }, actorId: msg.actorId });
            break;
          }
          case "recruitment_resume_routes__0": {
            const r = await repo.createResumeVersion(tx, {
                    id: rid, tenantId: p.tenantId, candidateId: id,
                    fileKey: body.fileKey, fileName: body.fileName, mimeType: body.mimeType,
                    fileSizeBytes: BigInt(body.fileSizeBytes),
                    fingerprint: body.fingerprint ?? null, label: body.label ?? null,
                    actorId: msg.actorId,
                  }, body.makeActive ?? false);
                  await emitAudit(tx, ctx, "resume_uploaded", "candidate_resume", rid, { candidateId: id, versionNo: r.versionNo });
                  return r;
            break;
          }
          case "recruitment_resume_routes__1": {
            await repo.activateResume(tx, p.tenantId, id, resumeId, resume.fileKey, msg.actorId);
            break;
          }
          case "recruitment_screening_override_routes__0": {
            await repo.createRequest(tx, {
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
                    await repo.setRequestStatus(tx, p.tenantId, reqId, {
                      status: "approved", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                    }, r.version);
                    await emitAudit(tx, ctx, "screening_override_approved", "screening_override", reqId, {
                      applicationId: r.applicationId, fromDecision: r.fromDecision, toDecision: r.toDecision, requestedBy: r.requestedBy,
                    });
            break;
          }
          case "recruitment_screening_override_routes__2": {
            await repo.setRequestStatus(tx, p.tenantId, reqId, {
                    status: "rejected", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                  }, r.version);
            break;
          }
          case "recruitment_screening_override_routes__3": {
            await repo.setRequestStatus(tx, p.tenantId, reqId, {
                    status: "cancelled", decidedBy: msg.actorId, decidedAt: new Date(), decisionNote: body.note ?? null,
                  }, r.version);
            break;
          }
          case "recruitment_screening_routes__0": {
            for (const a of applications) {
                    if (a.screeningDecision !== "pending") { skipped++; continue; }
                    const decision = autoScreenDecision(a.eligibilityResult as { eligible?: boolean } | null);
                    if (decision === "pending") { skipped++; continue; } // never evaluated for eligibility
                    await repo.setScreeningById(tx, p.tenantId, a.id, {
                      screeningDecision: decision,
                      screeningReasonCode: decision === "ineligible" ? "eligibility" : null,
                      screenedBy: msg.actorId, screenedAt: new Date(),
                    });
                    await repo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: a.id, jobOpeningId: id, action: "auto_screen",
                      decision, reasonCode: decision === "ineligible" ? "eligibility" : null, actorId: msg.actorId,
                    });
                    screened++;
                  }
            break;
          }
          case "recruitment_screening_routes__1": {
            await repo.setScreening(tx, p.tenantId, id, {
                      screeningDecision: body.decision,
                      screeningReasonCode: body.reasonCode ?? null,
                      screeningRemarks: body.remarks ?? null,
                      screenedBy: msg.actorId, screenedAt: new Date(),
                    }, a.version);
                    await repo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
                      action: "decision", decision: body.decision,
                      reasonCode: body.reasonCode ?? null, remarks: body.remarks ?? null,
                      isOverride: false, actorId: msg.actorId,
                    });
            break;
          }
          case "recruitment_screening_routes__2": {
            for (const a of apps) {
                    if (a.shortlistFrozen) { skipped++; continue; }
                    // Bulk shortlist advances the NORMAL forward path (pending / eligible ->
                    // shortlisted; idempotent on shortlisted). It must NOT silently overturn a
                    // deliberate non-shortlist decision — a rejection (ineligible), a
                    // waitlist, or a manual-review hold. Overturning one of those is an
                    // override that must go through the screening-decision endpoint (admin +
                    // reason, audited as an override).
                    if (BULK_SHORTLIST_BLOCKED.has(a.screeningDecision)) { skipped++; continue; }
                    await repo.setScreeningById(tx, p.tenantId, a.id, {
                      screeningDecision: "shortlisted", screenedBy: msg.actorId, screenedAt: new Date(),
                    });
                    await repo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: a.id, jobOpeningId: id, action: "shortlist",
                      decision: "shortlisted", actorId: msg.actorId,
                    });
                    shortlisted++;
                  }
            break;
          }
          case "recruitment_screening_routes__3": {
            for (const a of shortlisted) {
                    await repo.setScreeningById(tx, p.tenantId, a.id, { shortlistFrozen: true });
                    await repo.insertEvent(tx, {
                      tenantId: p.tenantId, applicationId: a.id, jobOpeningId: id, action: "freeze",
                      decision: "shortlisted", actorId: msg.actorId,
                    });
                  }
            break;
          }
          case "recruitment_selection_routes__0": {
            await repo.insertList(tx, {
                  id: listId, tenantId: p.tenantId, jobOpeningId, title: body.title, vacancies: body.vacancies,
                  status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "recruitment_selection_routes__1": {
            await repo.setEntries(tx, p.tenantId, id, body.entries.map((e) => ({
                      tenantId: p.tenantId, listId: id, applicationId: e.applicationId, candidateName: e.candidateName,
                      category: e.category, rank: e.rank, score: e.score != null ? String(e.score) : null, remarks: e.remarks ?? null,
                    })));
                    // Record who authored the ranking (for SoD against the approver) and bump
                    // the version so a concurrent approve binds to this exact roster.
                    await repo.updateList(tx, p.tenantId, id, { entriesSetBy: msg.actorId, entriesSetAt: new Date(), updatedBy: msg.actorId }, list.version);
            break;
          }
          case "recruitment_selection_routes__2": {
            await repo.updateList(tx, p.tenantId, id, {
                  status: "approved", validityUntil: validUntil, approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId,
                }, list.version);
            break;
          }
          case "recruitment_selection_routes__3": {
            await repo.updateList(tx, p.tenantId, id, { status: "published", publishedAt: new Date(), updatedBy: msg.actorId }, list.version);
            break;
          }
          case "recruitment_selection_routes__4": {
            await repo.updateList(tx, p.tenantId, id, { status: "expired", updatedBy: msg.actorId }, list.version);
            break;
          }
          case "recruitment_skills_routes__0": {
            await repo.setSkills(tx, p.tenantId, id, body.skills.map((s) => ({
                  // Round to the column's 1-decimal scale so we don't silently store a
                  // rounded value that differs from what was submitted.
                  tenantId: p.tenantId, candidateId: id, skill: s.skill, proficiency: s.proficiency, yearsExperience: s.yearsExperience != null ? String(Math.round(s.yearsExperience * 10) / 10) : null,
                })));
            break;
          }
          case "recruitment_skills_routes__1": {
            await repo.setCertifications(tx, p.tenantId, id, body.certifications.map((c) => ({
                  tenantId: p.tenantId, candidateId: id, certName: c.name, issuer: c.issuer,
                  issueDate: c.issueDate ?? null, expiryDate: c.expiryDate ?? null, credentialId: c.credentialId ?? null, credentialUrl: c.credentialUrl ?? null,
                })));
            break;
          }
          case "recruitment_skills_routes__2": {
            await repo.setLanguages(tx, p.tenantId, id, body.languages.map((l) => ({
                  tenantId: p.tenantId, candidateId: id, language: l.language, canRead: l.canRead, canWrite: l.canWrite, canSpeak: l.canSpeak, proficiency: l.proficiency ?? null,
                })));
            break;
          }
          case "recruitment_skills_routes__3": {
            await repo.setCredentials(tx, p.tenantId, id, body.credentials.map((c) => ({
                  tenantId: p.tenantId, candidateId: id, kind: c.kind, title: c.title, detail: c.detail ?? null, credYear: c.year ?? null, referenceUrl: c.referenceUrl ?? null,
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
