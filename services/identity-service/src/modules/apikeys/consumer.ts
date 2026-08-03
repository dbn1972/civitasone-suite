import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransition, type ApiKeyStatus } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerApiKeyConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.apiKeyIssue, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; keyPrefix: string; secretHash: string;
      scopes: string[]; expiresAt: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, keyPrefix: p.keyPrefix, secretHash: p.secretHash,
        scopes: p.scopes, status: "active", keyVersion: 1,
        expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await repo.audit(tx, p.tenantId, p.id, "issue", msg.actorId, `scopes=${p.scopes.join(",")}`);
      await repo.emitAudit(tx, {
        eventType: "identity.apikey.issued", tenantId: p.tenantId, actorId: msg.actorId,
        correlationId: msg.correlationId, action: "issue", resourceId: p.id, severity: "high",
        payload: { apiKeyId: p.id, keyPrefix: p.keyPrefix, scopes: p.scopes },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "identity", action: "issue", resourceType: "api_key", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.apiKeyRotate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; keyPrefix: string; secretHash: string; reason: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findByIdForUpdate(tx, p.tenantId, p.id);
      if (!row) return;
      try { assertTransition(row.status as ApiKeyStatus, "rotated"); } catch { return; }
      const newVersion = row.keyVersion + 1;
      const n = await repo.updateLifecycle(tx, p.tenantId, p.id, row.version, {
        keyPrefix: p.keyPrefix, secretHash: p.secretHash, keyVersion: newVersion,
        status: "active", updatedBy: msg.actorId,
      });
      if (n === 0) return;
      await repo.audit(tx, p.tenantId, p.id, "rotate", msg.actorId, p.reason);
      await repo.emitAudit(tx, {
        eventType: "identity.apikey.rotated", tenantId: p.tenantId, actorId: msg.actorId,
        correlationId: msg.correlationId, action: "rotate", resourceId: p.id, severity: "high",
        payload: { apiKeyId: p.id, keyPrefix: p.keyPrefix, keyVersion: newVersion, ...(p.reason ? { reason: p.reason } : {}) },
      });
    });
  });

  queue.subscribe(COMMANDS.apiKeyRevoke, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findByIdForUpdate(tx, p.tenantId, p.id);
      if (!row) return;
      if (row.status === "revoked") return;
      const n = await repo.updateLifecycle(tx, p.tenantId, p.id, row.version, {
        status: "revoked", revokedAt: new Date(), updatedBy: msg.actorId,
      });
      if (n === 0) return;
      await repo.audit(tx, p.tenantId, p.id, "revoke", msg.actorId, p.reason);
      await repo.emitAudit(tx, {
        eventType: "identity.apikey.revoked", tenantId: p.tenantId, actorId: msg.actorId,
        correlationId: msg.correlationId, action: "revoke", resourceId: p.id, severity: "high",
        payload: { apiKeyId: p.id, ...(p.reason ? { reason: p.reason } : {}) },
      });
    });
  });
}
