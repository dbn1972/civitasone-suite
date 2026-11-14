/**
 * Plans consumer — the ONLY code that writes Postgres for plans.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { PlanView } from "./repo.js";
import { runWithTenant } from "@civitasone/db";
import { planPriceInsert, PriceError } from "@civitasone/schemas/plan-pricing";
import * as prices from "./prices.js";
import type { SetPriceBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "plan";

function keyFor(tenantId: string, id: string) { return cache.makeKey(tenantId, RESOURCE, id); }

export function registerPlanConsumers(queue: Queue): void {
  queue.subscribe<PlanView>(COMMANDS.planCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx as unknown as repo.Writer, {
        id: p.id,
        tenantId: p.tenantId,
        code: p.code,
        name: p.name,
        edition: p.edition,
        maxUsers: p.maxUsers,
        maxStorageGb: p.maxStorageGb,
        enabledModules: p.enabledModules,
        catalogueModules: p.catalogueModules ?? null,
        priceMinor: BigInt(p.priceMinor),
        billingCycle: p.billingCycle,
        features: p.features,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.planCreated, { planId: p.id, code: p.code, edition: p.edition }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
  });

  queue.subscribe<{ id: string } & Partial<Omit<PlanView, "id">>>(COMMANDS.planUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx as unknown as repo.Writer, msg.payload.id);
      if (!cur) throw new Error(`plan ${msg.payload.id} not found`);
      const { id, ...rest } = msg.payload;
      const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) patch[k] = v;
      }
      await repo.update(tx as unknown as repo.Writer, id, patch);
      await emit(tx, msg, EVENTS.planUpdated, { planId: id }, "update", id);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
  });

  // M6: a new effective-dated price. The same transaction closes the previous open price, inserts the new one and
  // enqueues the audit event; an overlap / back-dated price aborts the whole transaction (loud, never half-written).
  queue.subscribe<SetPriceBody & { id: string }>(COMMANDS.planPriceSet, async (msg) => {
    const p = msg.payload;
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const t = tx as unknown as prices.Tx;
      const existing = await prices.listForSubjectTx(t, msg.tenantId, p.subjectKind, p.subjectKey, p.billingCycle);
      const next = {
        subjectKind: p.subjectKind, subjectKey: p.subjectKey, billingCycle: p.billingCycle,
        amountMinor: BigInt(p.amountMinor), gstRateBps: p.gstRateBps, effectiveFrom: p.effectiveFrom, effectiveTo: null,
      };
      let plan;
      try { plan = planPriceInsert(existing, next); } catch (err) {
        if (err instanceof PriceError) throw new Error(`price rejected (${err.code}): ${err.message}`);
        throw err;
      }
      if (plan.close?.id) await prices.closeTx(t, plan.close.id, plan.close.effectiveTo);
      await prices.insertTx(t, {
        id: p.id, tenantId: msg.tenantId, subjectKind: p.subjectKind, subjectKey: p.subjectKey, billingCycle: p.billingCycle,
        amountMinor: BigInt(p.amountMinor), gstRateBps: p.gstRateBps, effectiveFrom: p.effectiveFrom, effectiveTo: null,
        note: p.note ?? null, createdBy: msg.actorId,
      });
      const evt = tx as Parameters<typeof enqueue>[0];
      const auditPayload = {
        service: "tenant", action: "plan_price_set", resourceType: "plan_price", resourceId: p.id, outcome: "success",
        subjectKind: p.subjectKind, subjectKey: p.subjectKey, billingCycle: p.billingCycle,
        amountMinor: String(p.amountMinor), gstRateBps: p.gstRateBps, effectiveFrom: p.effectiveFrom,
        closedPreviousId: plan.close?.id ?? null, closedPreviousTo: plan.close?.effectiveTo ?? null,
      };
      await enqueue(evt, { topic: EVENTS.planPriceRecorded, eventType: EVENTS.planPriceRecorded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: auditPayload });
      await enqueue(evt, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: auditPayload });
    }));
  });
}

/** Enqueue domain event + mandatory audit event. */
async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "tenant", action, resourceType: "plan", resourceId, outcome: "success" },
  });
}
