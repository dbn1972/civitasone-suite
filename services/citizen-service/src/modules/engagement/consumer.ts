import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { SurveyQuestion, SurveyAnswerValue } from "./schema.js";

const log = pino({ name: "citizen.engagement.consumer" });

/** A guarded transition that matched no row (wrong state, unknown id, or maker-checker block) is acked; leave a trace. */
function noMatch(msg: { messageId: string; tenantId: string; actorId: string }, action: string, resourceType: string, id: string): void {
  log.debug({ messageId: msg.messageId, tenantId: msg.tenantId, actorId: msg.actorId, action, resourceType, id },
    "engagement transition matched 0 rows (state mismatch, not found, or maker-checker block); acked without audit");
}

export function registerEngagementConsumers(rawQueue: Queue): void {
  // #146 NOBYPASSRLS: handlers run inside the message's tenant context so
  // wrapWithTenantGuc sets app.tenant_id (FORCE RLS) in db.transaction().
  const queue = tenantScoped(rawQueue);

  // ── alerts ─────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.alertCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; title: string; body?: string; category?: string;
      targetAudience?: string; expiresAt?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAlert(tx, {
        id: p.id, tenantId: msg.tenantId, title: p.title, body: p.body ?? "",
        category: p.category ?? "general", targetAudience: p.targetAudience ?? "All Citizens",
        status: "draft", expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "citizen_alert", p.id);
    });
  });

  queue.subscribe(COMMANDS.alertPublish, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const n = await repo.transitionAlert(tx, msg.tenantId, p.id, ["draft"], {
        status: "active", publishedAt: new Date(), updatedBy: msg.actorId,
      }, msg.actorId); // maker-checker: the creator cannot publish their own draft
      if (n > 0) await audit(tx, msg, "publish", "citizen_alert", p.id);
      else noMatch(msg, "publish", "citizen_alert", p.id);
    });
  });

  queue.subscribe(COMMANDS.alertWithdraw, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const n = await repo.transitionAlert(tx, msg.tenantId, p.id, ["draft", "active"], {
        status: "withdrawn", updatedBy: msg.actorId,
      });
      if (n > 0) await audit(tx, msg, "withdraw", "citizen_alert", p.id);
      else noMatch(msg, "withdraw", "citizen_alert", p.id);
    });
  });

  // ── notices ────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.noticeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; noticeNo: string; subject: string; body?: string;
      department: string; type?: string; expiresAt?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await repo.insertNotice(tx, {
        id: p.id, tenantId: msg.tenantId, noticeNo: p.noticeNo, subject: p.subject, body: p.body ?? "",
        department: p.department, noticeType: p.type ?? "general", status: "draft",
        expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // A unique violation (concurrent same-noticeNo create) inserts nothing: never audit it as success.
      if (inserted) await audit(tx, msg, "create", "citizen_notice", p.id);
      else log.warn({ messageId: msg.messageId, tenantId: msg.tenantId, noticeNo: p.noticeNo, id: p.id },
        "notice create dropped: noticeNo already exists; no row inserted, no audit");
    });
  });

  queue.subscribe(COMMANDS.noticePublish, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const n = await repo.transitionNotice(tx, msg.tenantId, p.id, ["draft"], {
        status: "published", publishedAt: new Date(), updatedBy: msg.actorId,
      }, msg.actorId); // maker-checker: the creator cannot publish their own draft
      if (n > 0) await audit(tx, msg, "publish", "citizen_notice", p.id);
      else noMatch(msg, "publish", "citizen_notice", p.id);
    });
  });

  queue.subscribe(COMMANDS.noticeWithdraw, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const n = await repo.transitionNotice(tx, msg.tenantId, p.id, ["draft", "published"], {
        status: "withdrawn", updatedBy: msg.actorId,
      });
      if (n > 0) await audit(tx, msg, "withdraw", "citizen_notice", p.id);
      else noMatch(msg, "withdraw", "citizen_notice", p.id);
    });
  });

  // ── surveys ────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.surveyCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; surveyName: string; description?: string; questions: SurveyQuestion[];
      targetResponses?: number; startsOn?: string; endsOn?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSurvey(tx, {
        id: p.id, tenantId: msg.tenantId, surveyName: p.surveyName, description: p.description ?? "",
        questions: p.questions, targetResponses: p.targetResponses ?? null,
        startsOn: p.startsOn ?? null, endsOn: p.endsOn ?? null, status: "draft",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "citizen_survey", p.id);
    });
  });

  queue.subscribe(COMMANDS.surveyPublish, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const n = await repo.transitionSurvey(tx, msg.tenantId, p.id, ["draft"], { status: "active", updatedBy: msg.actorId }, msg.actorId); // maker-checker
      if (n > 0) await audit(tx, msg, "publish", "citizen_survey", p.id);
      else noMatch(msg, "publish", "citizen_survey", p.id);
    });
  });

  queue.subscribe(COMMANDS.surveyClose, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const n = await repo.transitionSurvey(tx, msg.tenantId, p.id, ["active"], { status: "completed", updatedBy: msg.actorId });
      if (n > 0) await audit(tx, msg, "close", "citizen_survey", p.id);
      else noMatch(msg, "close", "citizen_survey", p.id);
    });
  });

  queue.subscribe(COMMANDS.surveyRespond, async (msg) => {
    const p = msg.payload as { id: string; answers: Record<string, SurveyAnswerValue> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // The survey must still be open when the command is applied (it may have been
      // closed between 202 and consume) — otherwise ack as a no-op, never write.
      const survey = await repo.findSurveyTx(tx, msg.tenantId, p.id);
      if (!survey || survey.status !== "active") return;
      // One response per (survey, citizen): a duplicate is a no-op via the UNIQUE constraint.
      const inserted = await repo.insertResponse(tx, {
        tenantId: msg.tenantId, surveyId: p.id, citizenId: msg.actorId, // respondent identity comes from the authenticated envelope, never the payload
        answers: p.answers, createdBy: msg.actorId,
      });
      if (inserted) await audit(tx, msg, "create", "citizen_survey_response", p.id);
    });
  });
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx as never, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
