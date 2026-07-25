import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./reconcile-repo.js";
import { exchangeEntity, getEntityStatus, GemIntegrationError, CircuitBreakerOpenError } from "./integration-adapter.js";
import { foldExchangeResult, reconcile, type Provider, type EntityType } from "./reconcile-domain.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * SVC-050 — GeM/CPPP exchange + reconciliation consumer.
 * Records honest state transitions: provider errors increment attempts and set
 * last_error (never a fabricated success); reconciliation only marks a ref
 * reconciled when the provider reports a terminal-accepted status.
 */
export function registerGemReconcileConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.gemExchange, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; provider: Provider; entityType: EntityType;
      entityId: string; payload?: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ref = await repo.findRefByIdTx(tx, p.id, p.tenantId);
      if (!ref) throw new Error(`integration ref ${p.id} not found`);
      let outcome;
      try {
        const r = await exchangeEntity(p.provider, p.entityType, p.entityId, p.payload ?? {});
        outcome = foldExchangeResult(ref.attempts, { ok: true, externalRef: r.externalRef, externalStatus: r.externalStatus });
      } catch (err) {
        const error = err instanceof GemIntegrationError ? err.code
          : err instanceof CircuitBreakerOpenError ? "CIRCUIT_OPEN" : "EXCHANGE_ERROR";
        outcome = foldExchangeResult(ref.attempts, { ok: false, error });
      }
      await repo.updateRef(tx, p.id, {
        status: outcome.status, attempts: outcome.attempts,
        externalRef: outcome.externalRef ?? ref.externalRef,
        externalStatus: outcome.externalStatus ?? ref.externalStatus,
        lastError: outcome.lastError, updatedBy: msg.actorId, version: (ref.version ?? 1) + 1,
      });
      await audit(tx, msg, "exchange", "gem_integration_ref", p.id);
    });
  });

  queue.subscribe(COMMANDS.gemReconcile, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ref = await repo.findRefByIdTx(tx, p.id, p.tenantId);
      if (!ref) throw new Error(`integration ref ${p.id} not found`);
      if (!ref.externalRef) {
        // Nothing was exchanged yet — cannot reconcile. Honest no-op.
        await repo.updateRef(tx, p.id, { lastError: "no_external_ref_to_reconcile", updatedBy: msg.actorId, version: (ref.version ?? 1) + 1 });
        return;
      }
      let result;
      try {
        const externalStatus = await getEntityStatus(ref.provider as Provider, ref.externalRef);
        result = reconcile(externalStatus);
      } catch (err) {
        const error = err instanceof GemIntegrationError ? err.code
          : err instanceof CircuitBreakerOpenError ? "CIRCUIT_OPEN" : "RECONCILE_ERROR";
        await repo.updateRef(tx, p.id, { attempts: ref.attempts + 1, lastError: error, updatedBy: msg.actorId, version: (ref.version ?? 1) + 1 });
        return;
      }
      await repo.updateRef(tx, p.id, {
        status: result.status, externalStatus: result.externalStatus,
        lastError: result.discrepancy ? `discrepancy:${result.externalStatus}` : null,
        updatedBy: msg.actorId, version: (ref.version ?? 1) + 1,
      });
      await audit(tx, msg, "reconcile", "gem_integration_ref", p.id);
    });
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
