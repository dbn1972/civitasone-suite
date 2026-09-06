/**
 * inspection-service: Survey module — command consumers.
 *
 * _Requirements: SVC-104_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache, invalidateSafely } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  assertValidSurveyTransition,
  validateSurveyResponse,
  selectRandomSample,
  selectStratifiedSample,
  selectSystematicSample,
  computeAggregation,
  DomainError,
  type SurveyState,
} from "./domain.js";
import type { QuestionnaireItem } from "./schema.js";
import {
  insertSurveyDefinition,
  updateSurveyDefinition,
  findSurveyById,
  insertSamplingFrame,
  insertSurveyResponse,
  insertSurveyAggregation,
  findResponsesBySurvey,
} from "./repo.js";
import type {
  SurveyCreatePayload,
  SurveyUpdatePayload,
  SurveyActivatePayload,
  SurveyClosePayload,
  SurveyResponseSubmitPayload,
  SurveyAggregatePayload,
} from "./commands.js";

const log = pino({ name: "survey-consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerSurveyConsumers(queue: Queue): void {
  // ─── surveyCreate ─────────────────────────────────────────────────────────
  queue.subscribe<SurveyCreatePayload & { tenantId: string }>(
    COMMANDS.surveyCreate,
    async (msg) => {
      const p = msg.payload;
      let surveyId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const survey = await insertSurveyDefinition(tx, {
          tenantId: msg.tenantId,
          title: p.title,
          description: p.description ?? null,
          targetEntityType: p.targetEntityType,
          questionnaire: p.questionnaire,
          samplingMethod: p.samplingMethod,
          sampleSizePercent: String(p.sampleSizePercent),
          stratificationField: p.stratificationField ?? null,
          status: "draft",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        surveyId = survey.id;

        await enqueue(tx, {
          topic: EVENTS.surveyCreated,
          eventType: EVENTS.surveyCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            surveyId: survey.id,
            title: p.title,
            targetEntityType: p.targetEntityType,
            samplingMethod: p.samplingMethod,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "survey.created",
            resourceType: "survey_definition",
            resourceId: survey.id,
            details: { title: p.title, targetEntityType: p.targetEntityType },
          },
        });
      });

      if (surveyId) {
        await invalidateSafely(cache.makeKey(msg.tenantId, "survey", surveyId), log);
      }
    },
  );

  // ─── surveyUpdate ─────────────────────────────────────────────────────────
  queue.subscribe<SurveyUpdatePayload & { tenantId: string }>(
    COMMANDS.surveyUpdate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const survey = await findSurveyById(msg.tenantId, p.surveyId);
        if (!survey) throw new NonRetryableError(`Survey not found: ${p.surveyId}`);
        if (survey.status !== "draft") {
          throw new NonRetryableError("Can only update surveys in draft status");
        }

        const patch: Record<string, unknown> = { updatedBy: msg.actorId };
        if (p.title !== undefined) patch.title = p.title;
        if (p.description !== undefined) patch.description = p.description;
        if (p.questionnaire !== undefined) patch.questionnaire = p.questionnaire;
        if (p.samplingMethod !== undefined) patch.samplingMethod = p.samplingMethod;
        if (p.sampleSizePercent !== undefined) patch.sampleSizePercent = String(p.sampleSizePercent);
        if (p.stratificationField !== undefined) patch.stratificationField = p.stratificationField;

        await updateSurveyDefinition(tx, p.surveyId, msg.tenantId, patch, p.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "survey.updated",
            resourceType: "survey_definition",
            resourceId: p.surveyId,
            details: { changedFields: Object.keys(patch) },
          },
        });
      });

      await invalidateSafely(cache.makeKey(msg.tenantId, "survey", p.surveyId), log);
    },
  );

  // ─── surveyActivate ───────────────────────────────────────────────────────
  queue.subscribe<SurveyActivatePayload & { tenantId: string }>(
    COMMANDS.surveyActivate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const survey = await findSurveyById(msg.tenantId, p.surveyId);
        if (!survey) throw new NonRetryableError(`Survey not found: ${p.surveyId}`);

        try {
          assertValidSurveyTransition(survey.status as SurveyState, "active");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        // Compute sample
        const samplePercent = Number(survey.sampleSizePercent);
        const totalPopulation = p.entityIds.length;
        const sampleSize = Math.max(1, Math.ceil(totalPopulation * samplePercent / 100));

        let selectedIds: string[];
        if (survey.samplingMethod === "random") {
          selectedIds = selectRandomSample(p.entityIds, sampleSize, p.seed);
        } else if (survey.samplingMethod === "stratified") {
          const entities = (p.entities ?? p.entityIds.map((id) => ({ id }))) as Array<{ id: string; [key: string]: unknown }>;
          selectedIds = selectStratifiedSample(
            entities,
            survey.stratificationField ?? "id",
            samplePercent,
            p.seed,
          );
        } else {
          selectedIds = selectSystematicSample(p.entityIds, sampleSize, p.seed);
        }

        // Persist sampling frame
        await insertSamplingFrame(tx, {
          tenantId: msg.tenantId,
          surveyId: p.surveyId,
          entityIds: selectedIds,
          totalPopulation,
          sampleSize: selectedIds.length,
          selectionCriteria: { method: survey.samplingMethod, seed: p.seed, samplePercent },
          createdBy: msg.actorId,
        });

        // Transition to active
        await updateSurveyDefinition(tx, p.surveyId, msg.tenantId, {
          status: "active",
          updatedBy: msg.actorId,
        }, survey.version);

        await enqueue(tx, {
          topic: EVENTS.surveyActivated,
          eventType: EVENTS.surveyActivated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            surveyId: p.surveyId,
            totalPopulation,
            sampleSize: selectedIds.length,
            samplingMethod: survey.samplingMethod,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "survey.activated",
            resourceType: "survey_definition",
            resourceId: p.surveyId,
            details: { totalPopulation, sampleSize: selectedIds.length },
          },
        });
      });

      await invalidateSafely(cache.makeKey(msg.tenantId, "survey", p.surveyId), log);
    },
  );

  // ─── surveyClose ──────────────────────────────────────────────────────────
  queue.subscribe<SurveyClosePayload & { tenantId: string }>(
    COMMANDS.surveyClose,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const survey = await findSurveyById(msg.tenantId, p.surveyId);
        if (!survey) throw new NonRetryableError(`Survey not found: ${p.surveyId}`);

        try {
          assertValidSurveyTransition(survey.status as SurveyState, "closed");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateSurveyDefinition(tx, p.surveyId, msg.tenantId, {
          status: "closed",
          updatedBy: msg.actorId,
        }, survey.version);

        await enqueue(tx, {
          topic: EVENTS.surveyClosed,
          eventType: EVENTS.surveyClosed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { surveyId: p.surveyId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "survey.closed",
            resourceType: "survey_definition",
            resourceId: p.surveyId,
            details: {},
          },
        });
      });

      await invalidateSafely(cache.makeKey(msg.tenantId, "survey", p.surveyId), log);
    },
  );

  // ─── surveyResponseSubmit ─────────────────────────────────────────────────
  queue.subscribe<SurveyResponseSubmitPayload & { tenantId: string }>(
    COMMANDS.surveyResponseSubmit,
    async (msg) => {
      const p = msg.payload;
      let responseId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const survey = await findSurveyById(msg.tenantId, p.surveyId);
        if (!survey) throw new NonRetryableError(`Survey not found: ${p.surveyId}`);
        if (survey.status !== "active") {
          throw new NonRetryableError("Can only submit responses to active surveys");
        }

        // Validate required answers
        try {
          validateSurveyResponse(
            p.answers,
            survey.questionnaire as QuestionnaireItem[],
          );
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        const response = await insertSurveyResponse(tx, {
          tenantId: msg.tenantId,
          surveyId: p.surveyId,
          entityId: p.entityId,
          inspectorId: p.inspectorId,
          answers: p.answers,
          capturedAt: new Date(p.capturedAt),
          deviceId: p.deviceId ?? null,
          syncUploadId: p.syncUploadId ?? null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        responseId = response.id;

        await enqueue(tx, {
          topic: EVENTS.surveyResponseSubmitted,
          eventType: EVENTS.surveyResponseSubmitted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            responseId: response.id,
            surveyId: p.surveyId,
            entityId: p.entityId,
            inspectorId: p.inspectorId,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "survey.response_submitted",
            resourceType: "survey_response",
            resourceId: response.id,
            details: { surveyId: p.surveyId, entityId: p.entityId },
          },
        });
      });

      if (responseId) {
        await invalidateSafely(cache.makeKey(msg.tenantId, "survey-agg", p.surveyId), log);
      }
    },
  );

  // ─── surveyAggregate ──────────────────────────────────────────────────────
  queue.subscribe<SurveyAggregatePayload & { tenantId: string }>(
    COMMANDS.surveyAggregate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const survey = await findSurveyById(msg.tenantId, p.surveyId);
        if (!survey) throw new NonRetryableError(`Survey not found: ${p.surveyId}`);

        const responses = await findResponsesBySurvey(msg.tenantId, p.surveyId);
        const questionnaire = survey.questionnaire as QuestionnaireItem[];

        const questionSummaries = computeAggregation(
          responses.map((r) => r.answers as Record<string, unknown>),
          questionnaire,
        );

        // Compute response rate: we need total sample size from sampling frame
        // For now use responses.length as count, rate = 0 if no sample
        const responseCount = responses.length;
        const responseRate = responseCount > 0 ? "100.00" : "0.00";

        const aggregation = await insertSurveyAggregation(tx, {
          tenantId: msg.tenantId,
          surveyId: p.surveyId,
          responseCount,
          responseRate,
          questionSummaries,
          computedAt: new Date(),
        });

        await enqueue(tx, {
          topic: EVENTS.surveyAggregated,
          eventType: EVENTS.surveyAggregated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            aggregationId: aggregation.id,
            surveyId: p.surveyId,
            responseCount,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "survey.aggregated",
            resourceType: "survey_aggregation",
            resourceId: aggregation.id,
            details: { surveyId: p.surveyId, responseCount },
          },
        });
      });

      await invalidateSafely(cache.makeKey(msg.tenantId, "survey-agg", p.surveyId), log);
    },
  );
}
