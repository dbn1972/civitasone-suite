import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "admin-api-keys-consumer" });

function audit(actorId: string, tenantId: string, correlationId: string, action: string, resourceId: string) {
  return {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId, actorId, correlationId,
    payload: { service: "admin", action, resourceType: "api_key", resourceId, outcome: "success" },
  };
}

export function registerApiKeyConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.apiKeyCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; keyName: string; keyPrefix: string; keyHash: string;
      scopes: string[]; expiresAt?: string;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertKey(tx, {
          id: p.id, tenantId: p.tenantId, keyName: p.keyName, keyPrefix: p.keyPrefix,
          keyHash: p.keyHash, scopes: p.scopes, createdBy: msg.actorId, updatedBy: msg.actorId,
          ...(p.expiresAt ? { expiresAt: new Date(p.expiresAt) } : {}),
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "api_key_create", p.id));
      });
      await cache.invalidateResource(msg.tenantId, "api_keys");
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "apiKeyCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.apiKeyRotate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; keyPrefix: string; keyHash: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.rotateKey(tx, p.id, p.tenantId, p.keyPrefix, p.keyHash, msg.actorId);
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "api_key_rotate", p.id));
      });
      await cache.invalidateResource(msg.tenantId, "api_keys");
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "apiKeyRotate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.apiKeyRevoke, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.revokeKey(p.id, p.tenantId, msg.actorId);
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "api_key_revoke", p.id));
      });
      await cache.invalidateResource(msg.tenantId, "api_keys");
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "apiKeyRevoke failed");
      throw err;
    }
  });
}
