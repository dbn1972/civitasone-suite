/**
 * Custom Domains consumer — the ONLY code that writes Postgres for custom domains.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { customDomains, type CustomDomainRow } from "./schema.js";
import { checkDomainOwnership } from "./dns-verify.js";
import { normalizeDomain } from "./validators.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "admin-custom-domains-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "custom_domain";

function listKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerCustomDomainConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; domain: string;
    verificationMethod: string; verificationToken: string;
  }>(COMMANDS.customDomainRegister, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).insert(customDomains).values({
          id: p.id,
          tenantId: p.tenantId,
          // FQ12-SEC: canonical lower-case form (also covers in-flight
          // commands published before the validator normalised).
          domain: normalizeDomain(p.domain),
          status: "pending_verification",
          verificationToken: p.verificationToken,
          verificationMethod: p.verificationMethod,
          sslStatus: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, "admin.custom_domain.registered", p, "register", p.id);
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.customDomainRegister }, "Consumer processing failed");
    }
  });

  queue.subscribe<{ domainId: string; tenantId: string }>(COMMANDS.customDomainVerify, async (msg) => {
    try {
      const p = msg.payload;
      // FQ12-SEC #20: real ownership proof, fail closed. Read the challenge the
      // register flow stored, resolve it OUTSIDE the write transaction (a DNS
      // round-trip must not hold a row lock), then record the outcome. Only a
      // matching DNS answer marks the domain verified; NXDOMAIN, no record, a
      // wrong value, resolver errors and timeouts all leave it unverified with
      // the reason in the audit row (no admin.custom_domain.verified event).
      const rows = await db.transaction(async (tx) => (tx as any).select().from(customDomains)
        .where(and(eq(customDomains.id, p.domainId), eq(customDomains.tenantId, p.tenantId))).limit(1));
      const row = rows[0] as CustomDomainRow | undefined;
      if (!row) {
        log.warn({ messageId: msg.messageId, domainId: p.domainId }, "verify: custom domain not found for tenant; nothing to verify");
        return;
      }
      if (row.status === "verified" || row.status === "active" || row.status === "revoked") return;

      const result = await checkDomainOwnership({
        domain: row.domain, verificationMethod: row.verificationMethod, verificationToken: row.verificationToken,
      });

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const now = new Date();
        if (result.verified) {
          await (tx as any).update(customDomains).set({
            status: "verified",
            verifiedAt: now,
            updatedBy: msg.actorId,
            updatedAt: now,
          }).where(and(
            eq(customDomains.id, p.domainId),
            eq(customDomains.tenantId, p.tenantId),
            eq(customDomains.status, row.status),
          ));
          await emit(tx, msg, "admin.custom_domain.verified", p, "verify", p.domainId);
          return;
        }
        // A definite wrong answer is `failed`; an absent record or a resolver
        // problem stays `pending_verification` so the tenant can retry once DNS
        // propagates. Neither ever sets verified_at.
        const status = result.reason === "mismatch" || result.reason === "unsupported" ? "failed" : "pending_verification";
        await (tx as any).update(customDomains).set({
          status,
          updatedBy: msg.actorId,
          updatedAt: now,
        }).where(and(eq(customDomains.id, p.domainId), eq(customDomains.tenantId, p.tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "admin", action: "verify", resourceType: RESOURCE, resourceId: p.domainId,
            outcome: "failure", reason: result.reason, details: { status, detail: result.detail },
          },
        });
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.customDomainVerify }, "Consumer processing failed");
    }
  });

  queue.subscribe<{ domainId: string; tenantId: string; reason?: string | null }>(COMMANDS.customDomainDelete, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).delete(customDomains)
          .where(and(eq(customDomains.id, p.domainId), eq(customDomains.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.custom_domain.deleted", p, "delete", p.domainId, { reason: p.reason ?? null });
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.customDomainDelete }, "Consumer processing failed");
    }
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
  auditExtra: Record<string, unknown> = {},
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success", ...auditExtra },
  });
}
