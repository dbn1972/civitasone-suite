import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { and, eq, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { rateHeads, rateSlabs, penaltyRules, rebateRules } from "./schema.js";
import { assertNoSlabOverlap, planSlabReplace, DomainError, type ExistingSlab, type SlabSpec } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRateEngineConsumers(queue: Queue): void {
  // ─── rateHeadCreate ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.rateHeadCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        id?: string;
        code: string;
        name: string;
        category: string;
        unitOfMeasure?: string | null;
      };

      await tx.insert(rateHeads).values({
        ...(p.id ? { id: p.id } : {}),
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

      // GAP-REVENUE-CONFIG-01: reject a slab that overlaps an existing active
      // slab for the same rate head + type/band in the same effective window.
      // Overlapping active slabs make rate lookup non-deterministic → wrong tax
      // on every demand in the overlap. Server is the authority.
      const existingSlabs = await tx
        .select()
        .from(rateSlabs)
        .where(and(eq(rateSlabs.tenantId, msg.tenantId), eq(rateSlabs.rateHeadId, p.rateHeadId)));
      assertNoSlabOverlap(
        existingSlabs.map((s) => ({
          slabType: s.slabType,
          bandFrom: s.bandFrom ?? null,
          bandTo: s.bandTo ?? null,
          effectiveFrom: typeof s.effectiveFrom === "string" ? s.effectiveFrom : String(s.effectiveFrom),
          effectiveTo: s.effectiveTo == null ? null : typeof s.effectiveTo === "string" ? s.effectiveTo : String(s.effectiveTo),
          isActive: s.isActive,
        })),
        {
          slabType: p.slabType,
          bandFrom: p.bandFrom ?? null,
          bandTo: p.bandTo ?? null,
          effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo ?? null,
          isActive: true,
        },
      );

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

  // ─── rateSlabReplace (CLOS3-S1-11) ──────────────────────────────────────
  queue.subscribe(COMMANDS.rateSlabReplace, async (msg) => {
    const p = msg.payload as { rateHeadId: string; effectiveFrom: string; slabs: SlabSpec[] };
    let changed = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const head = await tx
        .select({ id: rateHeads.id })
        .from(rateHeads)
        .where(and(eq(rateHeads.tenantId, msg.tenantId), eq(rateHeads.id, p.rateHeadId)));
      if (head.length === 0) throw new DomainError("RATE_HEAD_NOT_FOUND", "rate head not found");

      const rows = await tx
        .select()
        .from(rateSlabs)
        .where(and(eq(rateSlabs.tenantId, msg.tenantId), eq(rateSlabs.rateHeadId, p.rateHeadId)));
      const existing: ExistingSlab[] = rows.map((s) => ({
        id: s.id,
        slabType: s.slabType,
        bandFrom: s.bandFrom ?? null,
        bandTo: s.bandTo ?? null,
        rateValue: s.rateValue,
        effectiveFrom: typeof s.effectiveFrom === "string" ? s.effectiveFrom : String(s.effectiveFrom),
        effectiveTo: s.effectiveTo == null ? null : typeof s.effectiveTo === "string" ? s.effectiveTo : String(s.effectiveTo),
        isActive: s.isActive,
      }));

      // Throws (SLAB_OVERLAP) before any write, so a bad set leaves the live set untouched.
      const plan = planSlabReplace(existing, p.slabs, p.effectiveFrom);
      if (plan.noop) return;

      for (const r of plan.retire) {
        await tx
          .update(rateSlabs)
          .set(
            r.mode === "close"
              ? { effectiveTo: p.effectiveFrom, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${rateSlabs.version} + 1` }
              : { isActive: false, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${rateSlabs.version} + 1` },
          )
          .where(and(eq(rateSlabs.tenantId, msg.tenantId), eq(rateSlabs.id, r.id)));
      }

      for (const s of plan.insert) {
        await tx.insert(rateSlabs).values({
          tenantId: msg.tenantId,
          rateHeadId: p.rateHeadId,
          slabType: s.slabType,
          bandFrom: s.bandFrom == null ? null : BigInt(s.bandFrom),
          bandTo: s.bandTo == null ? null : BigInt(s.bandTo),
          rateValue: BigInt(s.rateValue),
          effectiveFrom: p.effectiveFrom,
          effectiveTo: null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      }

      await enqueue(tx, {
        topic: EVENTS.rateSlabCreated,
        eventType: EVENTS.rateSlabCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { rateHeadId: p.rateHeadId, effectiveFrom: p.effectiveFrom, slabCount: plan.insert.length, retired: plan.retire.length },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "supersede",
          resourceType: "rate_slab",
          resourceId: p.rateHeadId,
          outcome: "success",
        },
      });
      changed = true;
    });

    if (changed) await cache.invalidate(`${SERVICE}:${msg.tenantId}:rate_slabs:${p.rateHeadId}`);
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
