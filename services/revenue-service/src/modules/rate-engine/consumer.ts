import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { rateHeads, rateSlabs, penaltyRules, rebateRules } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRateEngineConsumers(queue: Queue): void {
  // ─── rateHeadCreate ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rateHeadCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        code: string;
        name: string;
        category: string;
        unitOfMeasure?: string | null;
      };

      await tx.insert(rateHeads).values({
        tenantId: msg.tenantId,
        code: p.code,
        name: p.name,
        category: p.category,
        unitOfMeasure: p.unitOfMeasure ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.rateHeadCreated,
        eventType: EVENTS.rateHeadCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "create",
          resourceType: "rate_head",
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:rate_heads`);
  });

  // ─── rateSlabCreate ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rateSlabCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        rateHeadId: string;
        slabType: string;
        bandFrom?: bigint | null;
        bandTo?: bigint | null;
        rateValue: bigint;
        effectiveFrom: string;
        effectiveTo?: string | null;
        unitOfMeasure?: string | null;
      };

      await tx.insert(rateSlabs).values({
        tenantId: msg.tenantId,
        rateHeadId: p.rateHeadId,
        slabType: p.slabType,
        bandFrom: p.bandFrom ?? null,
        bandTo: p.bandTo ?? null,
        rateValue: p.rateValue,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo ?? null,
        unitOfMeasure: p.unitOfMeasure ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.rateSlabCreated,
        eventType: EVENTS.rateSlabCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "create",
          resourceType: "rate_slab",
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:rate_slabs:${(msg.payload as { rateHeadId: string }).rateHeadId}`);
  });

  // ─── penaltyRuleCreate ──────────────────────────────────────────────────
  queue.subscribe(COMMANDS.penaltyRuleCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        rateHeadId: string;
        interestType: string;
        annualRateBps: number;
        graceDays?: number;
        capMonths?: number | null;
        roundingMode?: string;
      };

      await tx.insert(penaltyRules).values({
        tenantId: msg.tenantId,
        rateHeadId: p.rateHeadId,
        interestType: p.interestType,
        annualRateBps: p.annualRateBps,
        graceDays: p.graceDays ?? 0,
        capMonths: p.capMonths ?? null,
        roundingMode: p.roundingMode ?? "round_half_up",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.penaltyRuleCreated,
        eventType: EVENTS.penaltyRuleCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "create",
          resourceType: "penalty_rule",
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:penalty_rules:${(msg.payload as { rateHeadId: string }).rateHeadId}`);
  });

  // ─── rebateRuleCreate ───────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rebateRuleCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        rateHeadId: string;
        rebateType: string;
        discountBps: number;
        validUntilDaysBeforeDue?: number | null;
      };

      await tx.insert(rebateRules).values({
        tenantId: msg.tenantId,
        rateHeadId: p.rateHeadId,
        rebateType: p.rebateType,
        discountBps: p.discountBps,
        validUntilDaysBeforeDue: p.validUntilDaysBeforeDue ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.rebateRuleCreated,
        eventType: EVENTS.rebateRuleCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "create",
          resourceType: "rebate_rule",
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:rebate_rules:${(msg.payload as { rateHeadId: string }).rateHeadId}`);
  });
}
