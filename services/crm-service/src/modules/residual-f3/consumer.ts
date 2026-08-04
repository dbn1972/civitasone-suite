// @ts-nocheck — F3 residual consumer; payload shapes closed over from route publishers
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-residual-f3-consumer" });

type CtxLike = { tenantId: string; actorId: string; correlationId: string };
function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): CtxLike {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerResidualF3Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createTender, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; accountId?: string | null; tenderRef: string; title: string;
      submissionDeadline?: string | null; estimatedValueMinor: string; currency: string; competitors: unknown[];
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.tenders
            (id, tenant_id, account_id, tender_ref, title, bid_stage, submission_deadline,
             estimated_value_minor, currency, competitors, created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.accountId ?? null}, ${p.tenderRef},
            ${p.title}, 'identified', ${p.submissionDeadline ?? null}::timestamptz,
            ${p.estimatedValueMinor}::bigint, ${p.currency},
            ${JSON.stringify(p.competitors)}::jsonb, ${msg.actorId}, ${msg.actorId}
          )
        `);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.tenderCreated, action: "create", resourceType: "tender", resourceId: p.id,
          payload: {
            tenderId: p.id, tenderRef: p.tenderRef, bidStage: "identified",
            estimatedValueMinor: p.estimatedValueMinor, currency: p.currency,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createTender failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.updateTender, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; title?: string; submissionDeadline?: string | null;
      estimatedValueMinor?: string; currency?: string; competitors?: unknown[];
      accountId?: string | null; version?: number; changed: string[];
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sets = [
          p.title !== undefined ? sql`title = ${p.title}` : null,
          p.submissionDeadline !== undefined ? sql`submission_deadline = ${p.submissionDeadline}::timestamptz` : null,
          p.estimatedValueMinor !== undefined ? sql`estimated_value_minor = ${p.estimatedValueMinor}::bigint` : null,
          p.currency !== undefined ? sql`currency = ${p.currency}` : null,
          p.competitors !== undefined ? sql`competitors = ${JSON.stringify(p.competitors)}::jsonb` : null,
          p.accountId !== undefined ? sql`account_id = ${p.accountId}` : null,
        ].filter((s): s is NonNullable<typeof s> => s !== null);
        if (sets.length === 0) return;
        const versionGuard = p.version !== undefined ? sql`AND version = ${p.version}` : sql``;
        const rows = await tx.execute(sql`
          UPDATE crm.tenders
          SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} ${versionGuard}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.tenderUpdated, action: "update", resourceType: "tender", resourceId: p.id,
          payload: { tenderId: p.id, changed: p.changed },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateTender failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.changeTenderStage, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; toStage: string; fromStage: string;
      lossReason?: string | null; version: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.tenders
          SET bid_stage = ${p.toStage},
              loss_reason = COALESCE(${p.lossReason ?? null}, loss_reason),
              updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.tenderStageChanged, action: "stage_change", resourceType: "tender", resourceId: p.id,
          payload: { tenderId: p.id, fromStage: p.fromStage, toStage: p.toStage },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "changeTenderStage failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.createNextAction, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; subjectType: string; subjectId: string;
      actionType: string; dueAt: string; notes?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.next_actions
            (id, tenant_id, subject_type, subject_id, action_type, due_at, notes, created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.subjectType}, ${p.subjectId},
            ${p.actionType}, ${p.dueAt}::timestamptz, ${p.notes ?? null},
            ${msg.actorId}, ${msg.actorId}
          )
        `);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.nextActionCreated, action: "create", resourceType: "next_action", resourceId: p.id,
          payload: {
            actionId: p.id, subjectType: p.subjectType, subjectId: p.subjectId,
            actionType: p.actionType, dueAt: p.dueAt,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createNextAction failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.completeNextAction, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.next_actions
          SET completed_at = now(), updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.nextActionCompleted, action: "complete", resourceType: "next_action", resourceId: p.id,
          payload: { actionId: p.id },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "completeNextAction failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.createRecurringTask, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; subjectType: string; subjectId: string;
      cadence: string; nextRunAt: string; escalateAfterHours?: number | null; enabled: boolean;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.recurring_tasks
            (id, tenant_id, name, subject_type, subject_id, cadence, next_run_at,
             escalate_after_hours, enabled, created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.name}, ${p.subjectType}, ${p.subjectId},
            ${p.cadence}, ${p.nextRunAt}::timestamptz,
            ${p.escalateAfterHours ?? null}, ${p.enabled}, ${msg.actorId}, ${msg.actorId}
          )
        `);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.recurringTaskCreated, action: "create", resourceType: "recurring_task", resourceId: p.id,
          payload: { taskId: p.id, cadence: p.cadence, subjectType: p.subjectType, subjectId: p.subjectId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createRecurringTask failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.updateRecurringTask, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name?: string; cadence?: string; nextRunAt?: string;
      escalateAfterHours?: number | null; enabled?: boolean; version?: number; changed: string[];
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sets = [
          p.name !== undefined ? sql`name = ${p.name}` : null,
          p.cadence !== undefined ? sql`cadence = ${p.cadence}` : null,
          p.nextRunAt !== undefined ? sql`next_run_at = ${p.nextRunAt}::timestamptz` : null,
          p.escalateAfterHours !== undefined ? sql`escalate_after_hours = ${p.escalateAfterHours}` : null,
          p.enabled !== undefined ? sql`enabled = ${p.enabled}` : null,
        ].filter((s): s is NonNullable<typeof s> => s !== null);
        if (sets.length === 0) return;
        const versionGuard = p.version !== undefined ? sql`AND version = ${p.version}` : sql``;
        const rows = await tx.execute(sql`
          UPDATE crm.recurring_tasks
          SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} ${versionGuard}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.recurringTaskUpdated, action: "update", resourceType: "recurring_task", resourceId: p.id,
          payload: { taskId: p.id, changed: p.changed },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateRecurringTask failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.runRecurringTask, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; actionId: string; subjectType: string; subjectId: string;
      name: string; dueAt: string; nextRunAt: string; version: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.recurring_tasks
          SET last_run_at = now(), next_run_at = ${p.nextRunAt}::timestamptz,
              updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await tx.execute(sql`
          INSERT INTO crm.next_actions
            (id, tenant_id, subject_type, subject_id, action_type, due_at, notes, created_by, updated_by)
          VALUES (
            ${p.actionId}, ${p.tenantId}, ${p.subjectType}, ${p.subjectId},
            'recurring_followup', ${p.dueAt}::timestamptz, ${p.name},
            ${msg.actorId}, ${msg.actorId}
          )
        `);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.recurringTaskRan, action: "run", resourceType: "recurring_task", resourceId: p.id,
          payload: {
            taskId: p.id, materialisedActionId: p.actionId, dueAt: p.dueAt, nextRunAt: p.nextRunAt,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "runRecurringTask failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.createAccountPlan, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; accountId: string; planYear: number;
      objectives: unknown; whiteSpace: unknown; risks: unknown; ownerId?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.account_plans
            (id, tenant_id, account_id, plan_year, objectives, white_space, risks,
             status, owner_id, created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.accountId}, ${p.planYear},
            ${JSON.stringify(p.objectives)}::jsonb,
            ${JSON.stringify(p.whiteSpace)}::jsonb,
            ${JSON.stringify(p.risks)}::jsonb,
            'draft', ${p.ownerId ?? null}, ${msg.actorId}, ${msg.actorId}
          )
        `);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.accountPlanCreated, action: "create", resourceType: "account_plan", resourceId: p.id,
          payload: { planId: p.id, accountId: p.accountId, planYear: p.planYear },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createAccountPlan failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.updateAccountPlan, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; objectives?: unknown; whiteSpace?: unknown; risks?: unknown;
      status?: string; ownerId?: string | null; version?: number; changed: string[];
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const sets = [
          p.objectives !== undefined ? sql`objectives = ${JSON.stringify(p.objectives)}::jsonb` : null,
          p.whiteSpace !== undefined ? sql`white_space = ${JSON.stringify(p.whiteSpace)}::jsonb` : null,
          p.risks !== undefined ? sql`risks = ${JSON.stringify(p.risks)}::jsonb` : null,
          p.status !== undefined ? sql`status = ${p.status}` : null,
          p.ownerId !== undefined ? sql`owner_id = ${p.ownerId}` : null,
        ].filter((s): s is NonNullable<typeof s> => s !== null);
        if (sets.length === 0) return;
        const versionGuard = p.version !== undefined ? sql`AND version = ${p.version}` : sql``;
        const rows = await tx.execute(sql`
          UPDATE crm.account_plans
          SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} ${versionGuard}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.accountPlanUpdated, action: "update", resourceType: "account_plan", resourceId: p.id,
          payload: { planId: p.id, changed: p.changed },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateAccountPlan failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.activateAccountPlan, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; accountId: string; version: number };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.account_plans
          SET status = 'active', updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.accountPlanActivated, action: "activate", resourceType: "account_plan", resourceId: p.id,
          payload: { planId: p.id, accountId: p.accountId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "activateAccountPlan failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.scheduleQbr, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; accountId: string; quarter: string; scheduledAt: string;
      attendees: unknown; agenda: unknown;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.qbr_schedules
            (id, tenant_id, account_id, quarter, scheduled_at, status, attendees, agenda,
             created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.accountId}, ${p.quarter},
            ${p.scheduledAt}::timestamptz, 'scheduled',
            ${JSON.stringify(p.attendees)}::jsonb,
            ${JSON.stringify(p.agenda)}::jsonb,
            ${msg.actorId}, ${msg.actorId}
          )
        `);
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.qbrScheduled, action: "schedule", resourceType: "qbr", resourceId: p.id,
          payload: { qbrId: p.id, accountId: p.accountId, quarter: p.quarter, scheduledAt: p.scheduledAt },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "scheduleQbr failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.completeQbr, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; status: string; outcomes: unknown[]; version: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.qbr_schedules
          SET status = ${p.status},
              outcomes = ${JSON.stringify(p.outcomes)}::jsonb,
              updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.qbrCompleted, action: "complete", resourceType: "qbr", resourceId: p.id,
          payload: { qbrId: p.id, status: p.status, outcomeCount: p.outcomes.length },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "completeQbr failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.cancelQbr, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string; version: number };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.qbr_schedules
          SET status = 'cancelled', cancel_reason = ${p.reason},
              updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.qbrCancelled, action: "cancel", resourceType: "qbr", resourceId: p.id,
          payload: { qbrId: p.id },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "cancelQbr failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.captureActivity, async (msg) => {
    const p = msg.payload as {
      id?: string; capturedId?: string; tenantId: string; source: string; externalId: string;
      contactId?: string | null; subject?: string | null; occurredAt?: string | null;
      participants?: unknown[]; matchConfidence?: string; matchStatus: string;
      participantCount?: number; rawRef?: string | null;
    };
    const capturedId = p.capturedId ?? p.id;
    if (!capturedId) return;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          INSERT INTO crm.captured_activities
            (id, tenant_id, source, external_id, contact_id, subject, occurred_at,
             participants, match_confidence, match_status, raw_ref, created_by, updated_by)
          VALUES (
            ${capturedId}, ${p.tenantId}, ${p.source}, ${p.externalId},
            ${p.contactId ?? null}, ${p.subject ?? null},
            ${p.occurredAt ?? null}::timestamptz,
            ${JSON.stringify(p.participants ?? [])}::jsonb,
            ${(p.matchConfidence ?? "0.0000")}::numeric, ${p.matchStatus},
            ${p.rawRef ?? null}, ${msg.actorId}, ${msg.actorId}
          )
          ON CONFLICT (tenant_id, source, external_id) DO NOTHING
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.activityCaptured, action: "capture", resourceType: "captured_activity", resourceId: capturedId,
          payload: {
            capturedId, source: p.source, externalId: p.externalId,
            matchStatus: p.matchStatus,
            participantCount: p.participantCount ?? (p.participants ?? []).length,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "captureActivity failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.matchCapturedActivity, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contactId: string; fromStatus: string; version: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.captured_activities
          SET contact_id = ${p.contactId}, match_status = 'matched', match_confidence = 1.0000,
              updated_at = now(), updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.version}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.activityCaptureMatched, action: "match", resourceType: "captured_activity", resourceId: p.id,
          payload: { capturedId: p.id, contactId: p.contactId, fromStatus: p.fromStatus },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "matchCapturedActivity failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.upsertCampaignPerformance, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; campaignId: string; responses: number;
      costMinor: string; revenueMinor: string; currency: string;
      periodStart: string; periodEnd?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          INSERT INTO crm.campaign_performance
            (id, tenant_id, campaign_id, responses, cost_minor, revenue_minor, currency,
             period_start, period_end, created_by, updated_by)
          VALUES (
            ${p.id}, ${p.tenantId}, ${p.campaignId}, ${p.responses},
            ${p.costMinor}::bigint, ${p.revenueMinor}::bigint, ${p.currency},
            ${p.periodStart}::date, ${p.periodEnd ?? null}::date,
            ${msg.actorId}, ${msg.actorId}
          )
          ON CONFLICT (tenant_id, campaign_id, period_start) DO UPDATE
          SET responses = EXCLUDED.responses,
              cost_minor = EXCLUDED.cost_minor,
              revenue_minor = EXCLUDED.revenue_minor,
              currency = EXCLUDED.currency,
              period_end = EXCLUDED.period_end,
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = crm.campaign_performance.version + 1
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        const row = rows[0];
        if (!row) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.campaignPerformanceRecorded, action: "upsert",
          resourceType: "campaign_performance", resourceId: row.id,
          payload: {
            performanceId: row.id, campaignId: p.campaignId, periodStart: p.periodStart,
            responses: p.responses, costMinor: p.costMinor, revenueMinor: p.revenueMinor, currency: p.currency,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "upsertCampaignPerformance failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.setAccountParent, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; parentId: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.execute(sql`
          UPDATE crm.accounts
          SET parent_id = ${p.parentId}, updated_at = now(), updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        if (rows.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg) as never, {
          eventType: EVENTS.accountParentSet, action: "set_parent",
          resourceType: "account", resourceId: p.id,
          payload: { accountId: p.id, parentId: p.parentId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "setAccountParent failed");
      throw err;
    }
  });
}
