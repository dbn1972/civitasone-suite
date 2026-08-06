/**
 * G7 checklist consumers.
 *
 * Every handler follows the service's write contract in this exact order:
 *   markProcessed(messageId) FIRST → business write → outbox event + audit → cache
 *   invalidate (after the transaction commits).
 *
 * Every mutation is guarded on `version` and on the status the route saw. The route
 * already refuses an illegal transition, but its read is a snapshot: between the 202 and
 * the write, a template can be published or an instance completed by someone else. A
 * guarded UPDATE that matches nothing leaves an audit record explaining WHY rather than
 * silently discarding the command — "the write was dropped" and "the write was dropped
 * because the template is no longer a draft" are very different lines to find in an audit
 * trail six months later.
 *
 * Answer VALUES are never put on an event. `checklist.item.answered` carries the answered
 * question ids and the resulting progress; the values stay in the row.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import type { ChecklistResponses, ChecklistSection } from "@civitasone/checklist";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { applyResponses, completesInstance, completionOf, statusAfterSubmission } from "./domain.js";
import { invalidateInstance, invalidateTemplate, INSTANCE_RESOURCE, TEMPLATE_RESOURCE } from "./queries.js";
import type { InstanceStatus } from "./schema.js";

const log = pino({ name: "crm-checklists-consumer" });

type Tx = Parameters<typeof emitWithAudit>[0];
type CtxLike = Parameters<typeof emitWithAudit>[1];

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): CtxLike {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as CtxLike;
}

/** `tx.execute` typed for the raw-SQL reads these handlers need. */
function exec<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (tx as unknown as { execute: (q: unknown) => Promise<T[]> }).execute(query);
}

function sectionsOf(value: unknown): ChecklistSection[] {
  return Array.isArray(value) ? (value as ChecklistSection[]) : [];
}

function responsesOf(value: unknown): ChecklistResponses {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ChecklistResponses)
    : {};
}

function countQuestions(sections: readonly ChecklistSection[]): number {
  return sections.reduce((total, section) => total + section.questions.length, 0);
}

interface CreateTemplatePayload {
  id: string;
  tenantId: string;
  templateKey: string;
  name: string;
  description: string | null;
  sections: ChecklistSection[];
  versionNumber: number;
}

interface UpdateTemplatePayload {
  id: string;
  tenantId: string;
  name: string | null;
  description: string | null;
  sections: ChecklistSection[] | null;
  version: number;
}

interface PublishTemplatePayload {
  id: string;
  tenantId: string;
  templateKey: string;
  versionNumber: number;
  version: number;
}

interface DeprecateTemplatePayload {
  id: string;
  tenantId: string;
  version: number;
}

interface CreateInstancePayload {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  templateId: string;
  templateKey: string;
  templateVersionNumber: number;
  structure: ChecklistSection[];
}

interface SubmitResponsesPayload {
  id: string;
  tenantId: string;
  responses: ChecklistResponses;
  version: number;
}

/** Audit-only record of a command that was accepted but could not be applied. */
async function auditRejection(
  tx: Tx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emitWithAudit(tx, ctxOf(msg), {
    eventType,
    action,
    resourceType,
    resourceId,
    payload: { ...payload, rejected: true },
    outcome,
  });
}

export function registerChecklistConsumers(queue: Queue): void {
  // ── template: create a new DRAFT version ──────────────────────────────────────
  queue.subscribe(COMMANDS.createChecklistTemplate, async (msg) => {
    const p = msg.payload as CreateTemplatePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // ON CONFLICT against the (tenant_id, template_key, version_number) unique index:
        // two admins racing on the same key resolve the same next version number at their
        // routes, and the loser must not become a duplicate row.
        const rows = await exec<{ id: string }>(tx, sql`
          INSERT INTO crm.checklist_templates
            (id, tenant_id, template_key, name, description, sections, version_number,
             status, created_by, updated_by)
          VALUES
            (${p.id}, ${p.tenantId}, ${p.templateKey}, ${p.name}, ${p.description},
             ${JSON.stringify(p.sections)}::jsonb, ${p.versionNumber}, 'draft',
             ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, template_key, version_number) DO NOTHING
          RETURNING id
        `);
        if (rows.length === 0) {
          await auditRejection(
            tx, msg, EVENTS.checklistTemplateCreated, "create", TEMPLATE_RESOURCE, p.id,
            "rejected_duplicate_version",
            { templateId: p.id, templateKey: p.templateKey, versionNumber: p.versionNumber },
          );
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.checklistTemplateCreated,
          action: "create",
          resourceType: TEMPLATE_RESOURCE,
          resourceId: p.id,
          payload: {
            templateId: p.id,
            templateKey: p.templateKey,
            versionNumber: p.versionNumber,
            sectionCount: p.sections.length,
            questionCount: countQuestions(p.sections),
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createChecklistTemplate failed");
      throw err;
    }
    await invalidateTemplate(msg.tenantId, p.id);
  });

  // ── template: amend a DRAFT ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.updateChecklistTemplate, async (msg) => {
    const p = msg.payload as UpdateTemplatePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // `status = 'draft'` in the WHERE is the immutability guard: a template that was
        // published between the 202 and this write must not be edited.
        const rows = await exec<{ id: string }>(tx, sql`
          UPDATE crm.checklist_templates
          SET name = COALESCE(${p.name}, name),
              description = COALESCE(${p.description}, description),
              sections = COALESCE(${p.sections === null ? null : JSON.stringify(p.sections)}::jsonb, sections),
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id}
            AND tenant_id = ${p.tenantId}
            AND version = ${p.version}
            AND status = 'draft'
          RETURNING id
        `);
        const changed = [
          ...(p.name !== null ? ["name"] : []),
          ...(p.description !== null ? ["description"] : []),
          ...(p.sections !== null ? ["sections"] : []),
        ];
        if (rows.length === 0) {
          await auditRejection(
            tx, msg, EVENTS.checklistTemplateUpdated, "update", TEMPLATE_RESOURCE, p.id,
            await templateRejectionOutcome(tx, p.id, p.tenantId, p.version, ["draft"]),
            { templateId: p.id, changed },
          );
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.checklistTemplateUpdated,
          action: "update",
          resourceType: TEMPLATE_RESOURCE,
          resourceId: p.id,
          payload: { templateId: p.id, changed },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateChecklistTemplate failed");
      throw err;
    }
    await invalidateTemplate(msg.tenantId, p.id);
  });

  // ── template: publish, superseding the previous published version ─────────────
  queue.subscribe(COMMANDS.publishChecklistTemplate, async (msg) => {
    const p = msg.payload as PublishTemplatePayload;
    let supersededId: string | null = null;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Eligibility is checked with a row lock BEFORE anything is written. The
        // "one published version per key" unique index is not deferrable, so publishing
        // the new row before demoting the old one would fail the moment the statement
        // ran — the order below is forced, and that makes an ineligible target something
        // to detect up front rather than roll back from.
        const target = (await exec<{ status: string; version: number }>(tx, sql`
          SELECT status, version FROM crm.checklist_templates
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          FOR UPDATE
        `))[0];

        if (!target || target.version !== p.version || target.status !== "draft") {
          await auditRejection(
            tx, msg, EVENTS.checklistTemplatePublished, "publish", TEMPLATE_RESOURCE, p.id,
            !target ? "rejected_not_found" : "rejected_stale_state",
            { templateId: p.id, templateKey: p.templateKey, versionNumber: p.versionNumber },
          );
          return;
        }

        const superseded = await exec<{ id: string }>(tx, sql`
          UPDATE crm.checklist_templates
          SET status = 'deprecated', updated_at = now(), updated_by = ${msg.actorId},
              version = version + 1
          WHERE tenant_id = ${p.tenantId}
            AND template_key = ${p.templateKey}
            AND status = 'published'
            AND id <> ${p.id}
          RETURNING id
        `);
        supersededId = superseded[0]?.id ?? null;

        await exec<{ id: string }>(tx, sql`
          UPDATE crm.checklist_templates
          SET status = 'published', published_at = now(), updated_at = now(),
              updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.checklistTemplatePublished,
          action: "publish",
          resourceType: TEMPLATE_RESOURCE,
          resourceId: p.id,
          payload: {
            templateId: p.id,
            templateKey: p.templateKey,
            versionNumber: p.versionNumber,
            supersededTemplateId: supersededId,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "publishChecklistTemplate failed");
      throw err;
    }
    await invalidateTemplate(msg.tenantId, p.id);
    if (supersededId) await invalidateTemplate(msg.tenantId, supersededId);
  });

  // ── template: deprecate ───────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.deprecateChecklistTemplate, async (msg) => {
    const p = msg.payload as DeprecateTemplatePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await exec<{ templateKey: string; versionNumber: number }>(tx, sql`
          UPDATE crm.checklist_templates
          SET status = 'deprecated', updated_at = now(), updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id}
            AND tenant_id = ${p.tenantId}
            AND version = ${p.version}
            AND status IN ('draft', 'published')
          RETURNING template_key AS "templateKey", version_number AS "versionNumber"
        `);
        const row = rows[0];
        if (!row) {
          await auditRejection(
            tx, msg, EVENTS.checklistTemplateDeprecated, "deprecate", TEMPLATE_RESOURCE, p.id,
            await templateRejectionOutcome(tx, p.id, p.tenantId, p.version, ["draft", "published"]),
            { templateId: p.id },
          );
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.checklistTemplateDeprecated,
          action: "deprecate",
          resourceType: TEMPLATE_RESOURCE,
          resourceId: p.id,
          payload: {
            templateId: p.id,
            templateKey: row.templateKey,
            versionNumber: Number(row.versionNumber),
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deprecateChecklistTemplate failed");
      throw err;
    }
    await invalidateTemplate(msg.tenantId, p.id);
  });

  // ── instance: raise against a subject ─────────────────────────────────────────
  queue.subscribe(COMMANDS.createChecklistInstance, async (msg) => {
    const p = msg.payload as CreateInstancePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const structure = sectionsOf(p.structure);
        // Initial completion: a checklist whose only questions are optional is complete
        // on arrival, and its score is 100 — computed here, not assumed to be zero.
        const initial = completionOf(structure, {});
        const rows = await exec<{ id: string }>(tx, sql`
          INSERT INTO crm.checklist_instances
            (id, tenant_id, subject_type, subject_id, template_id, template_key,
             template_version_number, structure, responses, status, score, created_by, updated_by)
          VALUES
            (${p.id}, ${p.tenantId}, ${p.subjectType}, ${p.subjectId}, ${p.templateId},
             ${p.templateKey}, ${p.templateVersionNumber},
             ${JSON.stringify(structure)}::jsonb, '{}'::jsonb, 'in_progress',
             ${initial.score}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, subject_type, subject_id, template_key)
            WHERE status = 'in_progress'
          DO NOTHING
          RETURNING id
        `);
        if (rows.length === 0) {
          await auditRejection(
            tx, msg, EVENTS.checklistInstanceCreated, "create", INSTANCE_RESOURCE, p.id,
            "rejected_open_instance_exists",
            {
              instanceId: p.id,
              subjectType: p.subjectType,
              subjectId: p.subjectId,
              templateKey: p.templateKey,
            },
          );
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.checklistInstanceCreated,
          action: "create",
          resourceType: INSTANCE_RESOURCE,
          resourceId: p.id,
          payload: {
            instanceId: p.id,
            subjectType: p.subjectType,
            subjectId: p.subjectId,
            templateId: p.templateId,
            templateKey: p.templateKey,
            templateVersionNumber: p.templateVersionNumber,
            requiredTotal: initial.requiredTotal,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createChecklistInstance failed");
      throw err;
    }
    await invalidateInstance(msg.tenantId, p.id);
  });

  // ── instance: record a partial set of answers ─────────────────────────────────
  queue.subscribe(COMMANDS.submitChecklistResponses, async (msg) => {
    const p = msg.payload as SubmitResponsesPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // FOR UPDATE, then compute, then write: the merge and the score are derived from
        // the row as it is at write time, not as the route saw it, so two concurrent
        // partial saves cannot lose each other's answers.
        const current = (await exec<{
          subjectType: string;
          subjectId: string;
          templateKey: string;
          structure: unknown;
          responses: unknown;
          status: string;
          version: number;
        }>(tx, sql`
          SELECT subject_type AS "subjectType", subject_id AS "subjectId",
                 template_key AS "templateKey", structure, responses, status, version
          FROM crm.checklist_instances
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          FOR UPDATE
        `))[0];

        if (!current || current.version !== p.version || current.status !== "in_progress") {
          await auditRejection(
            tx, msg, EVENTS.checklistItemAnswered, "answer", INSTANCE_RESOURCE, p.id,
            !current
              ? "rejected_not_found"
              : current.status !== "in_progress"
                ? "rejected_instance_not_open"
                : "rejected_stale_state",
            { instanceId: p.id, questionIds: Object.keys(p.responses) },
          );
          return;
        }

        const structure = sectionsOf(current.structure);
        const merged = applyResponses(responsesOf(current.responses), p.responses);
        const completion = completionOf(structure, merged);
        const nextStatus = statusAfterSubmission(current.status as InstanceStatus, completion);
        const nowCompleted = completesInstance(current.status as InstanceStatus, completion);

        await exec<{ id: string }>(tx, sql`
          UPDATE crm.checklist_instances
          SET responses = ${JSON.stringify(merged)}::jsonb,
              score = ${completion.score},
              status = ${nextStatus},
              completed_at = CASE WHEN ${nextStatus}::text = 'completed' THEN now() ELSE completed_at END,
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
        `);

        // Answered question IDS only. The submitted values can be personal data and an
        // event fans out to every subscriber and their logs.
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.checklistItemAnswered,
          action: "answer",
          resourceType: INSTANCE_RESOURCE,
          resourceId: p.id,
          payload: {
            instanceId: p.id,
            subjectType: current.subjectType,
            subjectId: current.subjectId,
            questionIds: Object.keys(p.responses),
            answeredCount: Object.keys(p.responses).length,
            requiredAnswered: completion.requiredAnswered,
            requiredTotal: completion.requiredTotal,
            progressPercent: completion.progressPercent,
            score: completion.score,
          },
        });

        if (nowCompleted) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.checklistInstanceCompleted,
            action: "complete",
            resourceType: INSTANCE_RESOURCE,
            resourceId: p.id,
            payload: {
              instanceId: p.id,
              subjectType: current.subjectType,
              subjectId: current.subjectId,
              templateKey: current.templateKey,
              score: completion.score,
            },
          });
        }
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "submitChecklistResponses failed");
      throw err;
    }
    await invalidateInstance(msg.tenantId, p.id);
  });
}

/**
 * Why a guarded template UPDATE matched nothing. Worth the extra read: an operator
 * reading the audit trail needs to know whether the row vanished, whether someone else
 * had already moved it on, or whether it was published in the meantime.
 */
async function templateRejectionOutcome(
  tx: Tx,
  id: string,
  tenantId: string,
  expectedVersion: number,
  allowedStatuses: readonly string[],
): Promise<string> {
  const row = (await exec<{ status: string; version: number }>(tx, sql`
    SELECT status, version FROM crm.checklist_templates
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `))[0];
  if (!row) return "rejected_not_found";
  if (!allowedStatuses.includes(row.status)) return `rejected_status_${row.status}`;
  if (row.version !== expectedVersion) return "rejected_stale_version";
  return "rejected_stale_state";
}
