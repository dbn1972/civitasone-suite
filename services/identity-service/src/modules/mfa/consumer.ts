import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { mfaConfigs } from "./schema.js";
import { users } from "../users/schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerMfaConsumers(q: Queue): void {
  q.subscribe<{ id: string; userId: string; method: string; tenantId: string }>(
    COMMANDS.enableMfa,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const { id, userId, method, tenantId } = msg.payload;
        const existing = await tx
          .select()
          .from(mfaConfigs)
          .where(and(eq(mfaConfigs.userId, userId), eq(mfaConfigs.tenantId, tenantId)))
          .limit(1);
        if (existing.length) {
          await tx
            .update(mfaConfigs)
            .set({
              method,
              enabled: true,
              updatedBy: msg.actorId,
              version: (existing[0]?.version ?? 0) + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(mfaConfigs.userId, userId), eq(mfaConfigs.tenantId, tenantId)));
        } else {
          await tx.insert(mfaConfigs).values({
            id,
            tenantId,
            userId,
            method,
            enabled: true,
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
            version: 1,
          });
        }
        await tx
          .update(users)
          .set({ mfaEnabled: true, updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.mfaEnabled,
          eventType: EVENTS.mfaEnabled,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId, method },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "identity",
            action: "mfa_enable",
            resourceType: "user",
            resourceId: userId,
            outcome: "success",
          },
        });
      });
    },
  );

  q.subscribe<{
    id: string;
    userId: string;
    tenantId: string;
    encryptedSecret: string;
    method: string;
    existing: boolean;
    currentVersion: number;
  }>(COMMANDS.setupMfa, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const now = new Date();
      if (p.existing) {
        await tx
          .update(mfaConfigs)
          .set({
            method: p.method,
            secret: p.encryptedSecret,
            enabled: false,
            updatedBy: msg.actorId,
            version: p.currentVersion + 1,
            updatedAt: now,
          })
          .where(and(eq(mfaConfigs.userId, p.userId), eq(mfaConfigs.tenantId, p.tenantId)));
      } else {
        await tx.insert(mfaConfigs).values({
          id: p.id,
          tenantId: p.tenantId,
          userId: p.userId,
          method: p.method,
          secret: p.encryptedSecret,
          enabled: false,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "identity",
          action: "mfa_setup",
          resourceType: "user",
          resourceId: p.userId,
          outcome: "success",
        },
      });
    });
  });

  q.subscribe<{
    userId: string;
    tenantId: string;
    nextFailed: number;
    lock: boolean;
    lockUntilMs: number;
    currentVersion: number;
  }>(COMMANDS.mfaVerifyFail, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const now = new Date();
      await tx
        .update(mfaConfigs)
        .set({
          failedAttempts: p.lock ? 0 : p.nextFailed,
          ...(p.lock ? { lockedUntil: new Date(now.getTime() + p.lockUntilMs) } : {}),
          updatedBy: msg.actorId,
          version: p.currentVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(mfaConfigs.userId, p.userId), eq(mfaConfigs.tenantId, p.tenantId)));
    });
  });

  q.subscribe<{
    userId: string;
    tenantId: string;
    matchedStep: number;
    enable: boolean;
    currentVersion: number;
  }>(COMMANDS.mfaVerifySuccess, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const now = new Date();
      await tx
        .update(mfaConfigs)
        .set({
          lastUsedStep: p.matchedStep,
          failedAttempts: 0,
          lockedUntil: null,
          ...(p.enable ? { enabled: true } : {}),
          updatedBy: msg.actorId,
          version: p.currentVersion + 1,
          updatedAt: now,
        })
        .where(and(eq(mfaConfigs.userId, p.userId), eq(mfaConfigs.tenantId, p.tenantId)));
      if (p.enable) {
        await tx
          .update(users)
          .set({ mfaEnabled: true, updatedBy: msg.actorId, updatedAt: now })
          .where(and(eq(users.id, p.userId), eq(users.tenantId, p.tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.mfaEnabled,
          eventType: EVENTS.mfaEnabled,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.userId, method: "totp" },
        });
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "identity",
          action: "mfa_verify",
          resourceType: "user",
          resourceId: p.userId,
          outcome: "success",
        },
      });
    });
  });
}
