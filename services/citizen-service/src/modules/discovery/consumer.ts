import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { matchServices, isConsentActive, type CandidateRuleSet } from "./domain.js";

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
    payload: { service: "citizen", action, resourceType: "discovery", resourceId, outcome: "success" },
  });
}

export function registerDiscoveryConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.discoveryConsentGrant, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; citizenId: string; scope: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findActiveConsentTx(tx, p.tenantId, p.citizenId, p.scope);
      if (existing && isConsentActive(existing)) return;
      await repo.insertConsent(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId, scope: p.scope,
        granted: true, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "consent_grant", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "discovery-consent", p.citizenId));
  });

  queue.subscribe(COMMANDS.discoveryConsentRevoke, async (msg) => {
    const p = msg.payload as { consentId: string; tenantId: string; citizenId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateConsent(tx, p.consentId, msg.tenantId, {
        granted: false, revokedAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "consent_revoke", p.consentId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "discovery-consent", p.citizenId));
  });

  queue.subscribe(COMMANDS.discoveryRun, async (msg) => {
    const p = msg.payload as {
      runId: string; tenantId: string; citizenId: string; scope: string;
      profile: Record<string, unknown>; recipient?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const consent = await repo.findActiveConsentTx(tx, p.tenantId, p.citizenId, p.scope);
      if (!isConsentActive(consent)) return;
      const ruleSets = await repo.listPublishedRuleSets(tx, p.tenantId);
      const candidates: CandidateRuleSet[] = ruleSets.map((rs) => ({
        serviceId: rs.serviceId, ruleSetId: rs.id, rules: rs.rules,
      }));
      const matches = matchServices(candidates, p.profile);
      for (const m of matches) {
        const matchId = randomUUID();
        await repo.insertMatch(tx, {
          id: matchId, tenantId: p.tenantId, citizenId: p.citizenId, serviceId: m.serviceId,
          ruleSetId: m.ruleSetId, outcome: m.outcome, reasons: m.reasons, notified: true,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.serviceDiscovered,
            recipient: p.recipient ?? p.citizenId,
            recipientId: p.citizenId,
            channel: "in_app",
            variables: { serviceId: m.serviceId, strength: m.strength },
          }) as unknown as Record<string, unknown>,
        });
        await enqueue(tx, {
          topic: EVENTS.serviceDiscovered, eventType: EVENTS.serviceDiscovered,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { matchId, citizenId: p.citizenId, serviceId: m.serviceId, outcome: m.outcome },
        });
      }
      await audit(tx, msg, "discovery_run", p.citizenId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "discovery-matches", p.citizenId));
  });

  queue.subscribe(COMMANDS.discoveryAssistedEnrol, async (msg) => {
    const p = msg.payload as {
      matchId: string; tenantId: string; applicationId: string; serviceType: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const match = await repo.findMatchByIdTx(tx, p.matchId, msg.tenantId);
      if (!match) return;
      const consent = await repo.findActiveConsentTx(tx, msg.tenantId, match.citizenId, "benefit_discovery");
      if (!isConsentActive(consent)) return;
      if (match.enrolledApplicationId) return;
      await repo.updateMatch(tx, p.matchId, msg.tenantId, {
        enrolledApplicationId: p.applicationId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: COMMANDS.applicationSubmit, eventType: COMMANDS.applicationSubmit,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: p.applicationId, tenantId: msg.tenantId, refNo: `APP-${Date.now()}`,
          citizenId: match.citizenId, serviceId: match.serviceId,
          serviceType: p.serviceType, documentTypes: [],
        },
      });
      await audit(tx, msg, "assisted_enrol", p.matchId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "discovery-match", p.matchId));
  });
}
