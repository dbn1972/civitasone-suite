import type { Queue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { dscConfig, DSC_CACHE_RESOURCE as CACHE_RESOURCE } from "./schema.js";
import { isSealed, sealDscPassphrase } from "./secret.js";

const log = pino({ name: "payroll-dsc-config-consumer" });
const AUDIT = "audit.event.record";

export function registerDscConfigConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.dscConfigUpsert, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      storageRef: string;
      /** Sealed passphrase envelope (current producers). */
      passphraseSealed?: string;
      /**
       * LEGACY: plaintext passphrase from a message published by a pre-fix
       * route instance and still in flight during rollout. Sealed below
       * before it touches the DB; never logged.
       */
      passphrase?: string;
      subjectCn: string;
      serialNumber: string;
      notBefore: string;
      notAfter: string;
      sha256Fingerprint: string;
      reason?: string | null;
    };

    try {
      // Only ciphertext reaches the DB. A legacy in-flight plaintext message
      // is sealed here; a message with neither field is malformed (drop to
      // DLQ via throw — the error text never contains secret material).
      const raw = p.passphraseSealed ?? p.passphrase;
      if (typeof raw !== "string" || raw.length === 0) {
        throw new Error("dscConfigUpsert payload missing passphraseSealed");
      }
      const passphraseSealed = isSealed(raw) ? raw : sealDscPassphrase(raw);

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(dscConfig).values({
          tenantId: p.tenantId,
          storageRef: p.storageRef,
          passphraseSealed,
          subjectCn: p.subjectCn,
          serialNumber: p.serialNumber,
          notBefore: new Date(p.notBefore),
          notAfter: new Date(p.notAfter),
          sha256Fingerprint: p.sha256Fingerprint,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        }).onConflictDoUpdate({
          target: dscConfig.tenantId,
          set: {
            storageRef: p.storageRef,
            passphraseSealed,
            subjectCn: p.subjectCn,
            serialNumber: p.serialNumber,
            notBefore: new Date(p.notBefore),
            notAfter: new Date(p.notAfter),
            sha256Fingerprint: p.sha256Fingerprint,
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          },
        });
        await enqueue(tx, {
          topic: EVENTS.dscConfigUpserted,
          eventType: EVENTS.dscConfigUpserted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { tenantId: p.tenantId, subjectCn: p.subjectCn },
        });
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "dsc_config_updated",
            resourceType: "dsc_config",
            resourceId: p.tenantId,
            outcome: "success",
            detail: {
              subjectCN: p.subjectCn,
              serialNumber: p.serialNumber,
              sha256Fingerprint: p.sha256Fingerprint,
              notAfter: p.notAfter,
              reason: p.reason ?? null,
            },
          },
        });
      });
      await cache.invalidate(cache.makeKey(p.tenantId, CACHE_RESOURCE, p.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "dscConfigUpsert failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.dscConfigRemove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(dscConfig).where(eq(dscConfig.tenantId, p.tenantId)).limit(1);
        const row = rows[0];
        await tx.delete(dscConfig).where(eq(dscConfig.tenantId, p.tenantId));
        await enqueue(tx, {
          topic: EVENTS.dscConfigRemoved,
          eventType: EVENTS.dscConfigRemoved,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { tenantId: p.tenantId },
        });
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "dsc_config_deleted",
            resourceType: "dsc_config",
            resourceId: p.tenantId,
            outcome: "success",
            detail: row
              ? { subjectCN: row.subjectCn, serialNumber: row.serialNumber, reason: p.reason ?? null }
              : { reason: p.reason ?? null },
          },
        });
      });
      await cache.invalidate(cache.makeKey(p.tenantId, CACHE_RESOURCE, p.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "dscConfigRemove failed");
      throw err;
    }
  });
}
