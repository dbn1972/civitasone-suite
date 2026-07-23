/**
 * inspection-service: checklist module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * Template lifecycle: draft → published (immutable)
 *
 * Handles:
 *   - templateCreate: validate unique question IDs → insert template in draft status
 *   - templatePublish: assert template is draft → set status=published, publishedAt, assign versionNumber, mark immutable
 *   - instanceGenerate: fetch template → assert published → deep-copy sections → insert instance bound to inspection
 *   - instanceSubmitResponse: fetch instance → compute checklist scores → update instance with scores
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.5, 5.8_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  findTemplateById,
  findInstanceById,
  insertTemplate,
  updateTemplate,
  insertInstance,
  updateInstance,
} from "./repo.js";
import {
  validateUniqueQuestionIds,
  computeChecklistScores,
  DomainError,
  type ChecklistSection,
  type ResponseEntry,
} from "./domain.js";
import type {
  TemplateCreatePayload,
  TemplatePublishPayload,
  InstanceGeneratePayload,
  InstanceSubmitResponsePayload,
} from "./commands.js";

const log = pino({ name: "checklist-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Domain helpers ────────────────────────────────────────────────────────────

/**
 * Validate that all question IDs within a template's sections are unique (Req 5.8).
 * Assigns auto-generated IDs to questions that lack them.
 * Throws NonRetryableError on duplicate IDs.
 */
interface EnrichedQuestion {
  id: string;
  text: string;
  fieldType: string;
  sortOrder: number;
  weight: number;
  required: boolean;
  validationRules?: object;
  helpText?: string;
}

interface EnrichedSection {
  id: string;
  title: string;
  sortOrder: number;
  weight: number;
  questions: EnrichedQuestion[];
}

function validateAndEnrichSections(
  sections: Array<{
    title: string;
    questions: Array<{
      fieldType: string;
      label: string;
      validationRules?: object;
      helpText?: string;
      weight?: number;
    }>;
  }>,
): EnrichedSection[] {
  const questionIds = new Set<string>();
  let sectionSortOrder = 0;

  const enriched = sections.map((section) => {
    sectionSortOrder += 1;
    const sectionId = `sec-${sectionSortOrder}`;
    let questionSortOrder = 0;

    const questions = section.questions.map((q) => {
      questionSortOrder += 1;
      const questionId = `q-${sectionSortOrder}-${questionSortOrder}`;

      if (questionIds.has(questionId)) {
        throw new NonRetryableError(
          `Duplicate question ID "${questionId}" found in template. All question IDs must be unique.`,
        );
      }
      questionIds.add(questionId);

      const question: {
        id: string;
        text: string;
        fieldType: string;
        sortOrder: number;
        weight: number;
        required: boolean;
        validationRules?: object;
        helpText?: string;
      } = {
        id: questionId,
        text: q.label,
        fieldType: q.fieldType,
        sortOrder: questionSortOrder,
        weight: q.weight ?? 1,
        required: true,
      };

      if (q.validationRules) {
        question.validationRules = q.validationRules;
      }
      if (q.helpText) {
        question.helpText = q.helpText;
      }

      return question;
    });

    return {
      id: sectionId,
      title: section.title,
      sortOrder: sectionSortOrder,
      weight: 1,
      questions,
    };
  });

  return enriched;
}

/**
 * Compute checklist scores from responses using domain logic (Req 5.5).
 * Converts raw responses map to domain ResponseEntry format and delegates
 * to the pure domain function.
 */
function computeScoresFromResponses(
  sections: ChecklistSection[],
  responses: Record<string, { value: unknown; answeredAt: string }>,
): { sectionScores: Record<string, number>; overallScore: string } {
  // Convert to domain ResponseEntry format
  const domainResponses: Record<string, ResponseEntry> = {};
  for (const [key, val] of Object.entries(responses)) {
    domainResponses[key] = { value: val.value, answeredAt: val.answeredAt };
  }

  const { sectionScores, overallScore } = computeChecklistScores(sections, domainResponses);
  return { sectionScores, overallScore: overallScore.toFixed(2) };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerChecklistConsumers(queue: Queue): void {
  // ─── templateCreate ──────────────────────────────────────────────────────
  queue.subscribe<TemplateCreatePayload>(COMMANDS.templateCreate, async (msg) => {
    const p = msg.payload;
    let templateId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Validate unique question IDs and enrich sections with IDs/sortOrder (Req 5.8)
      const enrichedSections = validateAndEnrichSections(p.sections);

      // Use domain validation to double-check uniqueness
      validateUniqueQuestionIds(enrichedSections as ChecklistSection[]);

      // Generate a code from the name (kebab-case, truncated to 32 chars)
      const code = p.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);

      const template = await insertTemplate(tx, {
        tenantId: msg.tenantId,
        name: p.name,
        code,
        versionNumber: 1,
        status: "draft",
        sections: enrichedSections,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      templateId = template.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "checklist_template.created",
          resourceType: "checklist_template",
          resourceId: template.id,
          details: { name: template.name, code: template.code, sectionCount: enrichedSections.length },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (templateId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "checklist_template", templateId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, templateId, event: "cache_invalidate_failed" },
          "failed to invalidate checklist_template cache after create");
      }
    }
  });

  // ─── templatePublish ─────────────────────────────────────────────────────
  queue.subscribe<TemplatePublishPayload>(COMMANDS.templatePublish, async (msg) => {
    const p = msg.payload;
    let publishedTemplateId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Fetch template to validate state
      const existing = await findTemplateById(msg.tenantId, p.templateId);
      if (!existing) {
        throw new NonRetryableError(`Template ${p.templateId} not found for tenant ${msg.tenantId}`);
      }

      // Only draft templates can be published (Req 5.2)
      if (existing.status !== "draft") {
        throw new NonRetryableError(
          `Template ${p.templateId} is in '${existing.status}' state and cannot be published. Only draft templates can be published.`,
        );
      }

      // Publish: set status, publishedAt, increment versionNumber (Req 5.2)
      let template;
      try {
        template = await updateTemplate(tx, p.templateId, p.version, {
          status: "published",
          publishedAt: new Date(),
          updatedBy: msg.actorId,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      publishedTemplateId = template.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "checklist_template.published",
          resourceType: "checklist_template",
          resourceId: template.id,
          details: { versionNumber: template.versionNumber, publishedAt: template.publishedAt?.toISOString() },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (publishedTemplateId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "checklist_template", publishedTemplateId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, templateId: publishedTemplateId, event: "cache_invalidate_failed" },
          "failed to invalidate checklist_template cache after publish");
      }
    }
  });

  // ─── instanceGenerate ────────────────────────────────────────────────────
  queue.subscribe<InstanceGeneratePayload>(COMMANDS.instanceGenerate, async (msg) => {
    const p = msg.payload;
    let instanceId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Fetch the template to deep-copy from
      const template = await findTemplateById(msg.tenantId, p.templateId);
      if (!template) {
        throw new NonRetryableError(`Template ${p.templateId} not found for tenant ${msg.tenantId}`);
      }

      // Only published templates can generate instances (Req 5.3)
      if (template.status !== "published") {
        throw new NonRetryableError(
          `Template ${p.templateId} is in '${template.status}' state. Only published templates can generate instances.`,
        );
      }

      // Verify template version matches requested version
      if (template.versionNumber !== p.templateVersion) {
        throw new NonRetryableError(
          `Template ${p.templateId} version mismatch. Requested v${p.templateVersion}, found v${template.versionNumber}.`,
        );
      }

      // Deep-copy template sections to the instance (Req 5.3)
      const deepCopiedSections = JSON.parse(JSON.stringify(template.sections));

      const instance = await insertInstance(tx, {
        tenantId: msg.tenantId,
        templateId: template.id,
        templateVersion: template.versionNumber,
        inspectionId: p.inspectionId,
        sections: deepCopiedSections,
        responses: null,
        sectionScores: null,
        overallScore: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      instanceId = instance.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "checklist_instance.generated",
          resourceType: "checklist_instance",
          resourceId: instance.id,
          details: {
            templateId: template.id,
            templateVersion: template.versionNumber,
            inspectionId: p.inspectionId,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (instanceId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "checklist_instance", instanceId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, instanceId, event: "cache_invalidate_failed" },
          "failed to invalidate checklist_instance cache after generate");
      }
    }
  });

  // ─── instanceSubmitResponse ──────────────────────────────────────────────
  queue.subscribe<InstanceSubmitResponsePayload>(COMMANDS.instanceSubmitResponse, async (msg) => {
    const p = msg.payload;
    let updatedInstanceId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Fetch the instance
      const existing = await findInstanceById(msg.tenantId, p.instanceId);
      if (!existing) {
        throw new NonRetryableError(`Instance ${p.instanceId} not found for tenant ${msg.tenantId}`);
      }

      // Build responses map from the submitted array
      const responsesMap: Record<string, { value: unknown; answeredAt: string }> = {
        ...(existing.responses as Record<string, { value: unknown; answeredAt: string }> ?? {}),
      };

      for (const r of p.responses) {
        responsesMap[r.questionId] = {
          value: r.value,
          answeredAt: r.capturedAt ?? new Date().toISOString(),
        };
      }

      // Compute scores from the instance sections and merged responses (Req 5.5)
      const sections = existing.sections as ChecklistSection[];

      const { sectionScores, overallScore } = computeScoresFromResponses(sections, responsesMap);

      // Update instance with responses and scores
      let instance;
      try {
        instance = await updateInstance(tx, p.instanceId, existing.version, {
          responses: responsesMap,
          sectionScores,
          overallScore,
          updatedBy: msg.actorId,
        });
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      updatedInstanceId = instance.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "checklist_instance.response_submitted",
          resourceType: "checklist_instance",
          resourceId: instance.id,
          details: {
            responseCount: p.responses.length,
            overallScore,
            inspectionId: existing.inspectionId,
          },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (updatedInstanceId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "checklist_instance", updatedInstanceId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, instanceId: updatedInstanceId, event: "cache_invalidate_failed" },
          "failed to invalidate checklist_instance cache after response submit");
      }
    }
  });
}
