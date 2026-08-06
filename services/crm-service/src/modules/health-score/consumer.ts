/**
 * G10 — Health Score consumers: config CRUD and recompute triggers.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { computeHealthScore } from "./domain.js";
import type { SignalInput, SignalConfig } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

interface CreateConfigPayload {
  id: string;
  signalName: string;
  weight: number;
  decayDays: number;
  source: string;
  enabled: boolean;
}

interface UpdateConfigPayload {
  id: string;
  weight?: number;
  decayDays?: number;
  enabled?: boolean;
}

interface RecomputePayload {
  accountId: string;
}

export function registerHealthScoreConsumers(queue: Queue): void {
  queue.subscribe<CreateConfigPayload>(COMMANDS.createHealthScoreConfig, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload;
      await tx.execute(sql`
        INSERT INTO crm.health_score_configs (id, tenant_id, signal_name, weight, decay_days, source, enabled, created_by)
        VALUES (${p.id}, ${msg.tenantId}, ${p.signalName}, ${p.weight}, ${p.decayDays}, ${p.source}, ${p.enabled}, ${msg.actorId})
        ON CONFLICT (tenant_id, signal_name) DO UPDATE SET
          weight = EXCLUDED.weight,
          decay_days = EXCLUDED.decay_days,
          source = EXCLUDED.source,
          enabled = EXCLUDED.enabled,
          updated_by = EXCLUDED.created_by,
          version = crm.health_score_configs.version + 1,
          updated_at = now()
      `);

      await enqueue(tx, {
        topic: EVENTS.healthScoreConfigCreated,
        eventType: EVENTS.healthScoreConfigCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { configId: p.id, signalName: p.signalName, source: p.source },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "create_health_score_config", resourceType: "health_score_config", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe<UpdateConfigPayload>(COMMANDS.updateHealthScoreConfig, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload;
      await tx.execute(sql`
        UPDATE crm.health_score_configs
        SET weight = COALESCE(${p.weight ?? null}::integer, weight),
            decay_days = COALESCE(${p.decayDays ?? null}::integer, decay_days),
            enabled = COALESCE(${p.enabled ?? null}::boolean, enabled),
            updated_by = ${msg.actorId},
            version = version + 1,
            updated_at = now()
        WHERE id = ${p.id} AND tenant_id = ${msg.tenantId}
      `);

      await enqueue(tx, {
        topic: EVENTS.healthScoreConfigUpdated,
        eventType: EVENTS.healthScoreConfigUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { configId: p.id },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "update_health_score_config", resourceType: "health_score_config", resourceId: p.id, outcome: "success" },
      });
    });
  });

  queue.subscribe<RecomputePayload>(COMMANDS.recomputeHealthScore, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load configs for tenant
      const configs = (await tx.execute(sql`
        SELECT signal_name AS "signalName", weight, decay_days AS "decayDays", enabled
        FROM crm.health_score_configs
        WHERE tenant_id = ${msg.tenantId} AND enabled = true
      `)) as unknown as SignalConfig[];

      if (configs.length === 0) return;

      // Load recent signals for the account (placeholder: activity recency, deal counts, etc.)
      // In a real implementation, this would aggregate from multiple sources.
      // For now, we read existing signals from the current score row (if any) and recompute.
      const existingRows = (await tx.execute(sql`
        SELECT signals FROM crm.account_health_scores
        WHERE tenant_id = ${msg.tenantId} AND account_id = ${msg.payload.accountId}
      `)) as unknown as Array<{ signals: Record<string, number> }>;

      const now = new Date();
      const signals: SignalInput[] = [];
      const existingSignals = existingRows[0]?.signals ?? {};

      // Build signal inputs from stored signal values
      for (const config of configs) {
        const value = existingSignals[config.signalName];
        if (value !== undefined) {
          signals.push({ name: config.signalName, value, recordedAt: now });
        }
      }

      const score = computeHealthScore(signals, configs, now);

      // Upsert the score
      await tx.execute(sql`
        INSERT INTO crm.account_health_scores (tenant_id, account_id, score, signals, computed_at)
        VALUES (${msg.tenantId}, ${msg.payload.accountId}, ${score}, ${JSON.stringify(existingSignals)}::jsonb, ${now.toISOString()}::timestamptz)
        ON CONFLICT (tenant_id, account_id) DO UPDATE SET
          score = EXCLUDED.score,
          signals = EXCLUDED.signals,
          computed_at = EXCLUDED.computed_at,
          version = crm.account_health_scores.version + 1,
          updated_at = now()
      `);

      await enqueue(tx, {
        topic: EVENTS.healthScoreComputed,
        eventType: EVENTS.healthScoreComputed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { accountId: msg.payload.accountId, score },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "recompute_health_score", resourceType: "account_health_score", resourceId: msg.payload.accountId, outcome: "success" },
      });
    });
  });
}
