/**
 * consent-exchange consumers (SVC-150) — the only writers of the consent
 * lifecycle tables (except the synchronous fetch path). Each handler runs
 * inside runWithTenant so FORCED RLS accepts the write, dedupes via
 * markProcessed, appends the append-only access ledger and emits the matching
 * `consent.*` domain event through the outbox.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "consent-exchange-consumer" });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface Msg { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown>; }

export function registerConsentExchangeConsumers(q: Queue): void {
  // dept A requests consented data about principal X held by dept B
  q.subscribe("tenant.consent.request", async (msg: Msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; principalId: string; requestingDept: string; providingDept: string;
      purposeKey: string; dataCategories: string[]; validFrom: string; validTo: string; frequency: string;
    };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertArtefact(tx, {
        id: p.id, tenantId: p.tenantId, principalId: p.principalId, requestingDept: p.requestingDept,
        providingDept: p.providingDept, purposeKey: p.purposeKey, dataCategories: p.dataCategories,
        validFrom: new Date(p.validFrom), validTo: new Date(p.validTo), frequency: p.frequency,
        status: "requested", createdBy: msg.actorId,
      });
      await repo.appendLedger(tx, {
        tenantId: p.tenantId, artefactId: p.id, principalId: p.principalId, eventType: "request",
        outcome: "recorded", requestingDept: p.requestingDept, purposeKey: p.purposeKey,
        categories: p.dataCategories, actorId: msg.actorId, correlationId: msg.correlationId,
      });
      await emit(tx, msg, "consent.requested", { artefactId: p.id, principalId: p.principalId, requestingDept: p.requestingDept, providingDept: p.providingDept, purposeKey: p.purposeKey });
      await audit(tx, msg, "request_consent", p.id);
    }));
  });

  // grant / deny by the data-principal or an authorised officer
  q.subscribe("tenant.consent.grant", (msg: Msg) => decide(msg, "active", "grant", "consent.granted", "grant_consent"));
  q.subscribe("tenant.consent.deny",  (msg: Msg) => decide(msg, "denied", "deny",  "consent.denied",  "deny_consent"));

  // principal (or officer) revokes an active consent — future fetches denied
  q.subscribe("tenant.consent.revoke", async (msg: Msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const a = await repo.findArtefactTx(tx, p.tenantId, p.id);
      if (!a) { log.warn({ id: p.id }, "revoke: artefact missing"); return; }
      await repo.revokeArtefact(tx, p.id, msg.actorId);
      await repo.appendLedger(tx, {
        tenantId: p.tenantId, artefactId: p.id, principalId: a.principalId, eventType: "revoke",
        outcome: "recorded", requestingDept: a.requestingDept, purposeKey: a.purposeKey,
        categories: a.dataCategories, actorId: msg.actorId, correlationId: msg.correlationId,
      });
      await emit(tx, msg, "consent.revoked", { artefactId: p.id, principalId: a.principalId });
      await audit(tx, msg, "revoke_consent", p.id);
    }));
  });

  // providing dept registers the data it holds about a principal, per category
  q.subscribe("tenant.consent.holding.upsert", async (msg: Msg) => {
    const p = msg.payload as { id: string; tenantId: string; principalId: string; providingDept: string; category: string; value: Record<string, unknown> };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertHolding(tx, {
        id: p.id, tenantId: p.tenantId, principalId: p.principalId, providingDept: p.providingDept,
        category: p.category, value: p.value ?? {}, createdBy: msg.actorId,
      });
      await audit(tx, msg, "register_holding", p.id);
    }));
  });
}

async function decide(msg: Msg, status: "active" | "denied", event: "grant" | "deny", topic: string, auditAction: string): Promise<void> {
  const p = msg.payload as { id: string; tenantId: string; reason?: string };
  await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const a = await repo.findArtefactTx(tx, p.tenantId, p.id);
    if (!a) { log.warn({ id: p.id }, `${event}: artefact missing`); return; }
    if (a.status !== "requested") { log.warn({ id: p.id, status: a.status }, `${event}: not in requested state`); return; }
    await repo.decideArtefact(tx, p.id, status, msg.actorId, p.reason ?? null);
    await repo.appendLedger(tx, {
      tenantId: p.tenantId, artefactId: p.id, principalId: a.principalId, eventType: event,
      outcome: "recorded", requestingDept: a.requestingDept, purposeKey: a.purposeKey,
      categories: a.dataCategories, reason: p.reason ?? null, actorId: msg.actorId, correlationId: msg.correlationId,
    });
    await emit(tx, msg, topic, { artefactId: p.id, principalId: a.principalId, requestingDept: a.requestingDept, providingDept: a.providingDept });
    await audit(tx, msg, auditAction, p.id);
  }));
}

async function emit(tx: Tx, msg: Msg, topic: string, payload: Record<string, unknown>): Promise<void> {
  await enqueue(tx, { topic, eventType: topic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
}

async function audit(tx: Tx, msg: Msg, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action, resourceType: "consent_artefact", resourceId, outcome: "success" } });
}
