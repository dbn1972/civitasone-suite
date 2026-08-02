/**
 * CR-MKT-04 — sending-domain registration + recorded auth-check ingestion.
 *
 * The consumer performs NO DNS lookup. It evaluates the TXT strings that the
 * scheduled checker already resolved, so the whole path is deterministic and
 * testable offline.
 *
 * DLQ safety: an auth check for a domain that does not exist, or a payload with
 * a bad timestamp, is non-retryable — retrying can never make it succeed.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { evaluateRecords, overallHealth, type DmarcPolicy } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "consumer:email-domains" });

type RegisterPayload = {
  id: string; tenantId: string; domain: string; dkimSelector: string;
  dkimValue: string; spfInclude: string; dmarcPolicy: DmarcPolicy;
};

type CheckPayload = {
  id: string; tenantId: string; sendingDomainId: string;
  dkimTxt: string[]; spfTxt: string[]; dmarcTxt: string[];
  source: "scheduled" | "manual"; checkedAt?: string;
};

export function registerEmailDomainConsumers(q: Queue): void {
  q = tenantScoped(q);

  q.subscribe<RegisterPayload>(COMMANDS.registerSendingDomain, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSendingDomain(tx, {
        id: p.id,
        tenantId: p.tenantId,
        domain: p.domain.trim().toLowerCase(),
        dkimSelector: p.dkimSelector,
        dkimValue: p.dkimValue,
        spfInclude: p.spfInclude,
        dmarcPolicy: p.dmarcPolicy,
        health: "unknown",
        enabled: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.sendingDomainRegistered,
        eventType: EVENTS.sendingDomainRegistered,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { sendingDomainId: p.id, domain: p.domain, dkimSelector: p.dkimSelector },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "register_sending_domain",
          resourceType: "sending_domain", resourceId: p.id, outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "sending_domain", p.id));
    log.info({ sendingDomainId: p.id }, "sending domain registered");
  });

  q.subscribe<CheckPayload>(COMMANDS.recordDomainAuthCheck, async (msg) => {
    const p = msg.payload;
    let checkedAt = new Date();
    if (p.checkedAt !== undefined) {
      const parsed = new Date(p.checkedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new NonRetryableError("INVALID_CHECK_PAYLOAD: checkedAt must be an ISO-8601 timestamp");
      }
      checkedAt = parsed;
    }

    let missing = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const domain = await repo.findDomainInTx(tx, p.tenantId, p.sendingDomainId);
      if (!domain) {
        missing = true;
        return;
      }

      const results = evaluateRecords(
        {
          dkimSelector: domain.dkimSelector,
          dkimValue: domain.dkimValue,
          spfInclude: domain.spfInclude,
          dmarcPolicy: domain.dmarcPolicy as DmarcPolicy,
        },
        { dkimTxt: p.dkimTxt, spfTxt: p.spfTxt, dmarcTxt: p.dmarcTxt },
      );
      const health = overallHealth(results);

      await repo.insertAuthCheck(tx, {
        id: p.id,
        tenantId: p.tenantId,
        sendingDomainId: p.sendingDomainId,
        dkimStatus: results.dkim,
        spfStatus: results.spf,
        dmarcStatus: results.dmarc,
        health,
        observed: { dkimTxt: p.dkimTxt, spfTxt: p.spfTxt, dmarcTxt: p.dmarcTxt },
        source: p.source,
        checkedAt,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await repo.applyHealth(tx, p.tenantId, p.sendingDomainId, health, checkedAt, msg.actorId, domain.version);

      await enqueue(tx, {
        topic: EVENTS.domainAuthCheckRecorded,
        eventType: EVENTS.domainAuthCheckRecorded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { checkId: p.id, sendingDomainId: p.sendingDomainId, health, ...results },
      });
      if (health === "failing") {
        await enqueue(tx, {
          topic: EVENTS.domainAuthFailing,
          eventType: EVENTS.domainAuthFailing,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { sendingDomainId: p.sendingDomainId, domain: domain.domain, ...results },
        });
      }
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "record_domain_auth_check",
          resourceType: "domain_auth_check", resourceId: p.id, outcome: "success", health,
        },
      });
    });

    if (missing) {
      throw new NonRetryableError(
        `SENDING_DOMAIN_NOT_FOUND: sending domain ${p.sendingDomainId} not found`,
      );
    }
    await cache.invalidate(cache.makeKey(p.tenantId, "sending_domain", p.sendingDomainId));
  });
}
