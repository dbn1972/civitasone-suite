import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertRulesWellFormed, evaluateEligibility } from "./domain.js";

const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "eligibility_rule_set", resourceId, outcome: "success" },
  });
}

export function registerEligibilityConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.eligibilityRuleSetCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; serviceId: string; name: string; rules: unknown[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      try { assertRulesWellFormed(p.rules as never); } catch { return; }
      const next = (await repo.latestVersionForService(tx, p.tenantId, p.serviceId)) + 1;
      await repo.insertRuleSet(tx, {
        id: p.id, tenantId: p.tenantId, serviceId: p.serviceId, name: p.name,
        version: next, status: "draft", rules: p.rules as never,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "ruleset_create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "eligibility", p.id));
  });

  queue.subscribe(COMMANDS.eligibilityRuleSetSubmit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rs = await repo.findRuleSetByIdTx(tx, p.id, msg.tenantId);
      if (!rs || rs.status !== "draft") return;
      await repo.updateRuleSet(tx, p.id, msg.tenantId, { submittedBy: msg.actorId, updatedBy: msg.actorId });
      await audit(tx, msg, "ruleset_submit", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "eligibility", p.id));
  });

  queue.subscribe(COMMANDS.eligibilityRuleSetPublish, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rs = await repo.findRuleSetByIdTx(tx, p.id, msg.tenantId);
      if (!rs || rs.status !== "draft" || !rs.submittedBy) return;
      if (rs.submittedBy === msg.actorId) return;
      try { assertRulesWellFormed(rs.rules); } catch { return; }
      await repo.updateRuleSet(tx, p.id, msg.tenantId, {
        status: "published", publishedBy: msg.actorId, publishedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.eligibilityRuleSetPublished, eventType: EVENTS.eligibilityRuleSetPublished,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, serviceId: rs.serviceId, version: rs.version },
      });
      await audit(tx, msg, "ruleset_publish", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "eligibility", p.id));
  });

  queue.subscribe(COMMANDS.eligibilityEvaluate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ruleSetId?: string; serviceId?: string;
      applicationId?: string; subjectRef?: string; subject: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      let rs = p.ruleSetId ? await repo.findRuleSetByIdTx(tx, p.ruleSetId, msg.tenantId) : null;
      if (!rs && p.serviceId) rs = await repo.findPublishedRuleSet(tx, msg.tenantId, p.serviceId);
      if (!rs || rs.status !== "published") return;
      const { outcome, reasons } = evaluateEligibility(rs.rules, p.subject);
      const reviewStatus = outcome === "refer_manual" ? "pending" : "none";
      await repo.insertEvaluation(tx, {
        id: p.id, tenantId: p.tenantId, ruleSetId: rs.id,
        applicationId: p.applicationId ?? null, subjectRef: p.subjectRef ?? null,
        subject: p.subject, outcome, reasons, reviewStatus,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "eligibility-eval", p.id));
  });

  queue.subscribe(COMMANDS.eligibilityReviewDecide, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ev = await repo.findEvaluationByIdTx(tx, p.id, msg.tenantId);
      if (!ev || ev.reviewStatus !== "pending") return;
      await repo.updateEvaluation(tx, p.id, msg.tenantId, {
        reviewStatus: "decided", reviewDecision: p.decision, reviewNote: p.note ?? null,
        reviewedBy: msg.actorId, reviewedAt: new Date(), updatedBy: msg.actorId,
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "eligibility-eval", p.id));
  });
}
