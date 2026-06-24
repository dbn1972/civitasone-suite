import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeRiskScore, type Likelihood, type Impact } from "./domain.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

/** Raised when an optimistic-locked update affects 0 rows (stale version / cross-tenant). */
class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(resource: string, id: string) {
    super(`[VERSION_CONFLICT] ${resource} ${id} was modified concurrently`);
  }
}

export function registerRiskConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.riskCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; riskCode: string; title: string; category: string;
      likelihood: Likelihood; impact: Impact; riskScore: number; owner?: string; reviewDate?: string;
    };
    // P1-7: recompute server-side — never trust a score carried on the wire.
    const riskScore = computeRiskScore(p.likelihood, p.impact);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRisk(tx, {
        id: p.id, tenantId: p.tenantId, riskCode: p.riskCode, title: p.title,
        category: p.category, likelihood: p.likelihood, impact: p.impact, riskScore,
        ownerRef: p.owner ?? null, reviewDate: p.reviewDate ?? null,
        status: "open", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "risk", p.id, { riskCode: p.riskCode, likelihood: p.likelihood, impact: p.impact, riskScore });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "audit_risk", "list:50"));
  });

  queue.subscribe(COMMANDS.riskUpdate, async (msg) => {
    const p = msg.payload as {
      riskId: string; tenantId: string; likelihood?: Likelihood; impact?: Impact;
      mitigationStatus?: string; status?: string; owner?: string; reviewDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const risk = await repo.findByIdTx(tx, p.riskId, p.tenantId);
      if (!risk) throw new Error(`risk ${p.riskId} not found`);
      const likelihood = (p.likelihood ?? risk.likelihood) as Likelihood;
      const impact = (p.impact ?? risk.impact) as Impact;
      const patch: Record<string, unknown> = {
        likelihood, impact,
        riskScore: computeRiskScore(likelihood, impact),
        updatedBy: msg.actorId, version: (risk.version ?? 1) + 1,
      };
      if (p.mitigationStatus !== undefined) patch.mitigationStatus = p.mitigationStatus;
      if (p.status !== undefined) patch.status = p.status;
      if (p.owner !== undefined) patch.ownerRef = p.owner;
      if (p.reviewDate !== undefined) patch.reviewDate = p.reviewDate;
      const rows = await repo.updateRiskVersioned(tx, p.riskId, p.tenantId, risk.version ?? 1, patch);
      if (rows !== 1) throw new StaleWriteError("risk", p.riskId);
      await audit(tx, msg, "update", "risk", p.riskId, { riskScore: patch.riskScore });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "audit_risk", "list:50"));
  });

  queue.subscribe(COMMANDS.riskLinkPlan, async (msg) => {
    const p = msg.payload as { planId: string; tenantId: string; riskIds: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Drop any cross-tenant / non-existent risk ids before linking.
      const valid = await repo.selectExistingRiskIds(tx, p.tenantId, p.riskIds);
      const linked = await repo.linkRisksToPlan(tx, p.tenantId, p.planId, valid, msg.actorId);
      await audit(tx, msg, "link_risks", "plan", p.planId, { requested: p.riskIds.length, linked });
    });
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string, newValue?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success", ...(newValue ? { newValue } : {}) },
  });
}
