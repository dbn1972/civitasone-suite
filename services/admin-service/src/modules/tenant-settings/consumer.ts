/**
 * tenant-settings consumer — the ONLY code that writes Postgres for tenant settings.
 * idempotency-check -> locked read-merge-write + outbox (event + audit) -> refresh cache.
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { settingsSections, tenantLogos } from "./schema.js";
import { SETTINGS_COMMANDS, SETTINGS_EVENTS } from "./topics.js";
import { decodeLogo, type SettingsSection } from "./validators.js";

const log = pino({ name: "admin-tenant-settings-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "tenant_settings";
const NOTIFY_TOPIC = "notification.send";

export const settingsCacheKey = (tenantId: string) => cache.makeKey(tenantId, RESOURCE, "all");

type Msg<P> = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: P };
type Tx = Parameters<typeof enqueue>[0];

async function audit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await enqueue(tx as Tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success", ...extra },
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function registerTenantSettingsConsumers(queue: Queue): void {
  queue.subscribe<{
    tenantId: string; section: SettingsSection; values: Record<string, unknown>; secretCiphertext?: string;
  }>(SETTINGS_COMMANDS.update, async (msg: Msg<{
    tenantId: string; section: SettingsSection; values: Record<string, unknown>; secretCiphertext?: string;
  }>) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        // Make sure the row exists, then lock it: two admins saving different
        // fields of the same section serialise here and BOTH edits survive
        // (read-merge-write under the row lock, never a blind overwrite).
        await (tx as any).insert(settingsSections)
          .values({ tenantId: p.tenantId, section: p.section, values: {}, updatedBy: msg.actorId })
          .onConflictDoNothing();
        const rows = await (tx as any).select().from(settingsSections)
          .where(and(eq(settingsSections.tenantId, p.tenantId), eq(settingsSections.section, p.section)))
          .for("update");
        const row = rows[0] as { values: Record<string, unknown>; secretCiphertext: string | null; version: number };
        const changedFields = Object.keys(p.values).filter((k) => !same(row.values[k], p.values[k]));
        const oldValue: Record<string, unknown> = {};
        const newValue: Record<string, unknown> = {};
        for (const k of changedFields) { oldValue[k] = row.values[k] ?? null; newValue[k] = p.values[k]; }
        const updated = await (tx as any).update(settingsSections)
          .set({
            values: { ...row.values, ...p.values },
            secretCiphertext: p.secretCiphertext ?? row.secretCiphertext,
            version: sql`${settingsSections.version} + 1`,
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          })
          .where(and(
            eq(settingsSections.tenantId, p.tenantId),
            eq(settingsSections.section, p.section),
            eq(settingsSections.version, row.version),
          ))
          .returning({ version: settingsSections.version });
        if (updated.length !== 1) throw new Error("SETTINGS_VERSION_CONFLICT");
        const fields = p.secretCiphertext !== undefined ? [...changedFields, "smtpPass"] : changedFields;
        await enqueue(tx as Tx, {
          topic: SETTINGS_EVENTS.updated, eventType: SETTINGS_EVENTS.updated, tenantId: msg.tenantId,
          actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { section: p.section, changedFields: fields },
        });
        // Secrets never go to the audit trail: only the name of the field that changed.
        await audit(tx, msg, `settings.${p.section}.update`, p.section, { changedFields: fields, oldValue, newValue });
      });
      await cache.invalidate(settingsCacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: SETTINGS_COMMANDS.update }, "Consumer processing failed");
      throw err;
    }
  });

  queue.subscribe<{ tenantId: string; recipient: string }>(SETTINGS_COMMANDS.emailTest, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        // Delivery goes through the platform notification service; the stored
        // SMTP section is only the "is it configured" precondition.
        await enqueue(tx as Tx, {
          topic: NOTIFY_TOPIC, eventType: NOTIFY_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            channel: "email",
            recipient: p.recipient,
            subject: "CivitasOne test email",
            body: "This is a test message sent by the CivitasOne platform email sender, requested from System Settings. "
              + "Receiving it confirms the platform sender works and that SMTP settings have been saved for your office. "
              + "It was not sent through your office's own SMTP server.",
          },
        });
        await audit(tx, msg, "settings.email.test", "email", { recipient: p.recipient });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: SETTINGS_COMMANDS.emailTest }, "Consumer processing failed");
      throw err;
    }
  });

  queue.subscribe<{ tenantId: string; contentType: "image/png" | "image/jpeg"; dataBase64: string; sha256: string; sizeBytes: number }>(
    SETTINGS_COMMANDS.logoSet,
    async (msg) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const decoded = decodeLogo(p.contentType, p.dataBase64);
          if (!decoded.ok) throw new Error(`LOGO_REJECTED: ${decoded.reason}`);
          const sha = createHash("sha256").update(decoded.bytes).digest("hex");
          if (sha !== p.sha256) throw new Error("LOGO_REJECTED: checksum mismatch");
          await (tx as any).insert(tenantLogos)
            .values({
              tenantId: p.tenantId, contentType: p.contentType, sizeBytes: decoded.bytes.length,
              sha256: sha, data: decoded.bytes, updatedBy: msg.actorId,
            })
            .onConflictDoUpdate({
              target: tenantLogos.tenantId,
              set: {
                contentType: p.contentType, sizeBytes: decoded.bytes.length, sha256: sha, data: decoded.bytes,
                version: sql`${tenantLogos.version} + 1`, updatedAt: new Date(), updatedBy: msg.actorId,
              },
            });
          await enqueue(tx as Tx, {
            topic: SETTINGS_EVENTS.logoChanged, eventType: SETTINGS_EVENTS.logoChanged, tenantId: msg.tenantId,
            actorId: msg.actorId, correlationId: msg.correlationId, payload: { action: "set", sha256: sha },
          });
          await audit(tx, msg, "settings.logo.set", "logo", { sha256: sha, sizeBytes: decoded.bytes.length });
        });
        await cache.invalidate(settingsCacheKey(msg.payload.tenantId));
      } catch (err) {
        log.error({ err, messageId: msg.messageId, type: SETTINGS_COMMANDS.logoSet }, "Consumer processing failed");
        throw err;
      }
    },
  );

  queue.subscribe<{ tenantId: string }>(SETTINGS_COMMANDS.logoRemove, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const removed = await (tx as any).delete(tenantLogos).where(eq(tenantLogos.tenantId, p.tenantId)).returning({ t: tenantLogos.tenantId });
        if (removed.length === 0) return; // idempotent: nothing to remove, nothing to audit
        await enqueue(tx as Tx, {
          topic: SETTINGS_EVENTS.logoChanged, eventType: SETTINGS_EVENTS.logoChanged, tenantId: msg.tenantId,
          actorId: msg.actorId, correlationId: msg.correlationId, payload: { action: "remove" },
        });
        await audit(tx, msg, "settings.logo.remove", "logo");
      });
      await cache.invalidate(settingsCacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: SETTINGS_COMMANDS.logoRemove }, "Consumer processing failed");
      throw err;
    }
  });
}
