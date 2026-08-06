/**
 * G26 discount-schedule + delegation-limit consumer. The ONLY writer of
 * crm.discount_schedules, crm.discount_slabs and crm.delegation_limits.
 *
 * Every handler follows the house transaction shape, in this order:
 *   1. markProcessed(tx, msg.messageId) — FIRST statement, so a redelivery is a no-op and
 *      the skip still COMMITS (an aborted skip would roll the inbox row back and the queue
 *      would retry a message that is not an error, three times, into the DLQ).
 *   2. the business write.
 *   3. the outbox event + audit, in the SAME transaction as the write.
 *   4. cache invalidation, AFTER the commit.
 *
 * Duplicate business keys are handled with ON CONFLICT DO NOTHING + RETURNING: an empty
 * result means a duplicate. They are NOT caught with try/catch, because postgres.js
 * re-throws the first failed statement once the transaction callback returns and rolls the
 * WHOLE transaction back — including the inbox row — which dead-letters a command that was
 * never an error.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { SCHEDULE_RESOURCE, LIMIT_RESOURCE } from "./repo.js";

const log = pino({ name: "crm-discounts-consumer" });
const SCHEDULE_TYPE = "discount_schedule";
const LIMIT_TYPE = "delegation_limit";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

interface SlabPayload {
  fromThreshold: string;
  toThreshold: string | null;
  discountBps: number;
  ordinal: number;
}

interface SchedulePayload {
  id: string;
  tenantId: string;
  name: string;
  scopeType: string;
  scopeId: string;
  basis: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  enabled: boolean;
  slabs: SlabPayload[];
}

interface LimitPayload {
  id: string;
  tenantId: string;
  role: string;
  level: number;
  maxDiscountBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  enabled: boolean;
}

export function registerDiscountConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createDiscountSchedule, async (msg) => {
    const p = msg.payload as SchedulePayload;
    let written = false;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inserted = (await tx.execute(sql`
          INSERT INTO crm.discount_schedules
            (id, tenant_id, name, scope_type, scope_id, basis, currency, effective_from,
             effective_to, enabled, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.name}, ${p.scopeType}, ${p.scopeId}, ${p.basis},
                  ${p.currency}, ${p.effectiveFrom}::date,
                  ${p.effectiveTo === null ? null : sql`${p.effectiveTo}::date`},
                  ${p.enabled}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT DO NOTHING
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        // Empty RETURNING = the business key (or the id) already exists. An operator
        // double-submit, not a failure: no second card, no event, and the inbox row stays
        // so the queue acks instead of retrying.
        if (inserted.length === 0) return;

        for (const s of p.slabs) {
          await tx.execute(sql`
            INSERT INTO crm.discount_slabs
              (tenant_id, schedule_id, from_threshold, to_threshold, discount_bps, ordinal, created_by, updated_by)
            VALUES (${p.tenantId}, ${p.id}, ${s.fromThreshold}::bigint,
                    ${s.toThreshold === null ? null : sql`${s.toThreshold}::bigint`},
                    ${s.discountBps}, ${s.ordinal}, ${msg.actorId}, ${msg.actorId})
            ON CONFLICT DO NOTHING
          `);
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.discountScheduleCreated,
          action: "create",
          resourceType: SCHEDULE_TYPE,
          resourceId: p.id,
          payload: {
            scheduleId: p.id, scopeType: p.scopeType, scopeId: p.scopeId, basis: p.basis,
            currency: p.currency, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo,
            slabCount: p.slabs.length,
          },
        });
        written = true;
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createDiscountSchedule failed");
      throw err;
    }
    if (written) await cache.invalidateResource(p.tenantId, SCHEDULE_RESOURCE);
  });

  queue.subscribe(COMMANDS.closeDiscountSchedule, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; effectiveTo: string; expectedVersion: number };
    let written = false;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // OPTIMISTIC LOCK: a command minted against a stale read matches no row, so it
        // silently loses to the newer end-date rather than overwriting it. No event is
        // emitted for a lost update, and the inbox row still commits so the message is
        // acked rather than retried.
        const updated = (await tx.execute(sql`
          UPDATE crm.discount_schedules
          SET effective_to = ${p.effectiveTo}::date, updated_at = now(),
              updated_by = ${msg.actorId}, version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND version = ${p.expectedVersion}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (updated.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.discountScheduleClosed,
          action: "close",
          resourceType: SCHEDULE_TYPE,
          resourceId: p.id,
          payload: { scheduleId: p.id, effectiveTo: p.effectiveTo },
        });
        written = true;
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "closeDiscountSchedule failed");
      throw err;
    }
    if (written) await cache.invalidateResource(p.tenantId, SCHEDULE_RESOURCE);
  });

  queue.subscribe(COMMANDS.deleteDiscountSchedule, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let written = false;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Slabs first: they carry an FK to the schedule.
        await tx.execute(sql`
          DELETE FROM crm.discount_slabs WHERE tenant_id = ${p.tenantId} AND schedule_id = ${p.id}
        `);
        const removed = (await tx.execute(sql`
          DELETE FROM crm.discount_schedules WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (removed.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.discountScheduleDeleted,
          action: "delete",
          resourceType: SCHEDULE_TYPE,
          resourceId: p.id,
          payload: { scheduleId: p.id },
        });
        written = true;
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteDiscountSchedule failed");
      throw err;
    }
    if (written) await cache.invalidateResource(p.tenantId, SCHEDULE_RESOURCE);
  });

  queue.subscribe(COMMANDS.upsertDelegationLimit, async (msg) => {
    const p = msg.payload as LimitPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Upsert, not insert-or-skip: re-issuing the same day's limit for a role is a
        // CORRECTION an admin means to land, and (tenant, role, effective_from) is the
        // business key that makes the correction converge on one row.
        const upserted = (await tx.execute(sql`
          INSERT INTO crm.delegation_limits
            (id, tenant_id, role, level, max_discount_bps, effective_from, effective_to, enabled, created_by, updated_by)
          VALUES (${p.id}, ${p.tenantId}, ${p.role}, ${p.level}, ${p.maxDiscountBps},
                  ${p.effectiveFrom}::date,
                  ${p.effectiveTo === null ? null : sql`${p.effectiveTo}::date`},
                  ${p.enabled}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, role, effective_from) DO UPDATE
            SET level = EXCLUDED.level,
                max_discount_bps = EXCLUDED.max_discount_bps,
                effective_to = EXCLUDED.effective_to,
                enabled = EXCLUDED.enabled,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by,
                version = crm.delegation_limits.version + 1
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        // The PERSISTED id, which on a correction is the id of the row that already
        // existed rather than the one this command minted. Emitting the minted id would
        // hand downstream consumers an id that resolves to nothing.
        const limitId = upserted[0]?.id ?? p.id;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.delegationLimitUpserted,
          action: "upsert",
          resourceType: LIMIT_TYPE,
          resourceId: `${p.role}:${p.effectiveFrom}`,
          payload: {
            limitId, role: p.role, level: p.level, maxDiscountBps: p.maxDiscountBps,
            effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "upsertDelegationLimit failed");
      throw err;
    }
    await cache.invalidateResource(p.tenantId, LIMIT_RESOURCE);
  });

  queue.subscribe(COMMANDS.deleteDelegationLimit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let written = false;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const removed = (await tx.execute(sql`
          DELETE FROM crm.delegation_limits WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        if (removed.length === 0) return;
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.delegationLimitDeleted,
          action: "delete",
          resourceType: LIMIT_TYPE,
          resourceId: p.id,
          payload: { limitId: p.id },
        });
        written = true;
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteDelegationLimit failed");
      throw err;
    }
    if (written) await cache.invalidateResource(p.tenantId, LIMIT_RESOURCE);
  });
}
