/**
 * G17 — Due-horizon work-queue generator consumer.
 *
 * Processes commands to create/update configs and execute sweeps.
 * The sweep reads subscriptions whose next_due_date falls within each
 * configured horizon, groups them by org-unit dimension, and records
 * a due_horizon_run per horizon.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { computeHorizonWindow } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "due_horizon_config";

interface CreateConfigPayload {
  id: string;
  tenantId: string;
  name: string;
  horizons: number[];
  groupBy: string;
  consentRequired: boolean;
  active: boolean;
}

interface UpdateConfigPayload {
  id: string;
  tenantId: string;
  name?: string;
  horizons?: number[];
  groupBy?: string;
  consentRequired?: boolean;
  active?: boolean;
  version: number;
}

interface RunSweepPayload {
  id: string;
  configId: string;
  tenantId: string;
}

export function registerDueHorizonConsumers(queue: Queue): void {
  // Create a due-horizon config
  queue.subscribe<CreateConfigPayload>(COMMANDS.createDueHorizonConfig, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.execute(sql`
        INSERT INTO crm.due_horizon_configs (id, tenant_id, name, horizons, group_by, consent_required, active, created_by)
        VALUES (${msg.payload.id}, ${msg.payload.tenantId}, ${msg.payload.name},
                ${JSON.stringify(msg.payload.horizons)}::jsonb,
                ${msg.payload.groupBy}, ${msg.payload.consentRequired}, ${msg.payload.active},
                ${msg.actorId})
        ON CONFLICT (id) DO NOTHING
      `);

      await enqueue(tx, {
        topic: EVENTS.dueHorizonConfigCreated,
        eventType: EVENTS.dueHorizonConfigCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { configId: msg.payload.id, name: msg.payload.name, horizons: msg.payload.horizons },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "create_due_horizon_config", resourceType: "due_horizon_config", resourceId: msg.payload.id, outcome: "success" },
      });
    });
  });

  // Update a due-horizon config
  queue.subscribe<UpdateConfigPayload>(COMMANDS.updateDueHorizonConfig, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const sets: string[] = [];
      const vals: unknown[] = [];

      if (msg.payload.name !== undefined) { sets.push("name"); vals.push(msg.payload.name); }
      if (msg.payload.horizons !== undefined) { sets.push("horizons"); vals.push(JSON.stringify(msg.payload.horizons)); }
      if (msg.payload.groupBy !== undefined) { sets.push("group_by"); vals.push(msg.payload.groupBy); }
      if (msg.payload.consentRequired !== undefined) { sets.push("consent_required"); vals.push(msg.payload.consentRequired); }
      if (msg.payload.active !== undefined) { sets.push("active"); vals.push(msg.payload.active); }

      await tx.execute(sql`
        UPDATE crm.due_horizon_configs
        SET name = COALESCE(${msg.payload.name ?? null}, name),
            horizons = COALESCE(${msg.payload.horizons ? JSON.stringify(msg.payload.horizons) : null}::jsonb, horizons),
            group_by = COALESCE(${msg.payload.groupBy ?? null}, group_by),
            consent_required = COALESCE(${msg.payload.consentRequired ?? null}, consent_required),
            active = COALESCE(${msg.payload.active ?? null}, active),
            updated_by = ${msg.actorId},
            updated_at = now(),
            version = version + 1
        WHERE id = ${msg.payload.id}
          AND tenant_id = ${msg.payload.tenantId}
          AND version = ${msg.payload.version}
      `);

      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, msg.payload.id));
      await cache.invalidateResource(msg.tenantId, RESOURCE);

      await enqueue(tx, {
        topic: EVENTS.dueHorizonConfigUpdated,
        eventType: EVENTS.dueHorizonConfigUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { configId: msg.payload.id },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "update_due_horizon_config", resourceType: "due_horizon_config", resourceId: msg.payload.id, outcome: "success" },
      });
    });
  });

  // Run a due-horizon sweep
  queue.subscribe<RunSweepPayload>(COMMANDS.runDueHorizonSweep, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load config
      const configs = (await tx.execute(sql`
        SELECT id, horizons, group_by AS "groupBy", consent_required AS "consentRequired", active
        FROM crm.due_horizon_configs
        WHERE id = ${msg.payload.configId} AND tenant_id = ${msg.payload.tenantId} AND active = true
        LIMIT 1
      `)) as unknown as Array<{ id: string; horizons: number[]; groupBy: string; consentRequired: boolean; active: boolean }>;

      const config = configs[0];
      if (!config) return;

      const now = new Date();
      const horizons: number[] = Array.isArray(config.horizons) ? config.horizons : JSON.parse(config.horizons as unknown as string);

      for (const horizonDays of horizons) {
        const window = computeHorizonWindow(now, horizonDays);

        // Count matching subscriptions for this horizon
        const countResult = (await tx.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM crm.subscriptions
          WHERE tenant_id = ${msg.payload.tenantId}
            AND status = 'active'
            AND next_due_date IS NOT NULL
            AND next_due_date::timestamptz >= ${window.from.toISOString()}::timestamptz
            AND next_due_date::timestamptz <= ${window.to.toISOString()}::timestamptz
        `)) as unknown as Array<{ count: number }>;

        const itemsGenerated = countResult[0]?.count ?? 0;

        // Record the run
        await tx.execute(sql`
          INSERT INTO crm.due_horizon_runs (tenant_id, config_id, horizon_days, run_at, items_generated, status)
          VALUES (${msg.payload.tenantId}, ${msg.payload.configId}, ${horizonDays}, ${now.toISOString()}::timestamptz,
                  ${itemsGenerated}, 'completed')
        `);
      }

      await enqueue(tx, {
        topic: EVENTS.dueHorizonRunCompleted,
        eventType: EVENTS.dueHorizonRunCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { configId: msg.payload.configId, horizons, runAt: now.toISOString() },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "run_due_horizon_sweep", resourceType: "due_horizon_run", resourceId: msg.payload.configId, outcome: "success" },
      });
    });
  });
}
