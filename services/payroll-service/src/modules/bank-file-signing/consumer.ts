import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { parseStoredConfig } from "./config-repo.js";
import { assertUnsignedAllowed } from "./service.js";
import { bankFileSigningConfigSchema, type BankFileSigningConfig } from "./types.js";

const log = pino({ name: "payroll-bank-file-signing-consumer" });
const AUDIT = "audit.event.record";

/**
 * payroll.bank_file_signing.update -> payroll_settings.bank_file_signing, with
 * a before/after audit event, in ONE transaction. The command carries only the
 * policy (format / overrides / encrypt flag / opaque keyRef) -- never key
 * material.
 */
export function registerBankFileSigningConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.bankFileSigningUpdate, async (msg) => {
    const p = msg.payload as BankFileSigningConfig & { id: string; tenantId: string; reason?: string | null };
    try {
      const parsed = bankFileSigningConfigSchema.safeParse({
        format: p.format, perBankOverrides: p.perBankOverrides, encryptToBank: p.encryptToBank, keyRef: p.keyRef,
      });
      // A malformed command can never succeed on retry: dead-letter it.
      if (!parsed.success) throw new NonRetryableError("bank file signing update rejected: invalid configuration");
      const next: BankFileSigningConfig = parsed.data;
      // Defence in depth -- the route already refuses this with a 422.
      try {
        await assertUnsignedAllowed(p.tenantId, next);
      } catch {
        throw new NonRetryableError("bank file signing update rejected: unsigned bank files are not allowed in production");
      }

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const prevRows = (await tx.execute(sql`
          SELECT bank_file_signing FROM payroll.payroll_settings
           WHERE tenant_id = ${p.tenantId}::uuid FOR UPDATE
        `)) as unknown as Array<{ bank_file_signing: unknown }>;
        const before = parseStoredConfig(prevRows[0]?.bank_file_signing ?? null);
        await tx.execute(sql`
          INSERT INTO payroll.payroll_settings (tenant_id, bank_file_signing, created_at, updated_at)
          VALUES (${p.tenantId}::uuid, ${JSON.stringify(next)}::jsonb, NOW(), NOW())
          ON CONFLICT (tenant_id) DO UPDATE
            SET bank_file_signing = EXCLUDED.bank_file_signing, updated_at = NOW()
        `);
        await enqueue(tx, {
          topic: EVENTS.bankFileSigningUpdated, eventType: EVENTS.bankFileSigningUpdated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { tenantId: p.tenantId, format: next.format },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "bank_file_signing_updated",
            resourceType: "payroll_settings",
            resourceId: p.tenantId,
            outcome: "success",
            // before = null: the tenant was on the application default (pgp_detached).
            detail: { before, after: next, reason: p.reason ?? null },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "bankFileSigningUpdate failed");
      throw err;
    }
  });
}
