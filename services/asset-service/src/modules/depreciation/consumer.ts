import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { computeMonthlyDep, generatePeriods } from "./domain.js";
import { uuidV5 } from "../../shared/ids.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";

export function registerDepreciationConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.depSchedule, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string; method: string; startDate: string;
      depBook?: string;
    };
    const depBook = p.depBook ?? "company";
    const method = p.method as "SLM" | "WDV";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const asset = await registerRepo.findAssetById(p.assetId, p.tenantId);
      if (!asset) return;
      const usefulLifeYears = asset.usefulLifeYears;
      const ratePercent = depBook === "statutory" ? 25 : Number(asset.depRate);
      const startDate = p.startDate;
      const endDate = new Date(
        new Date(startDate).getFullYear() + usefulLifeYears,
        new Date(startDate).getMonth(),
        1
      ).toISOString().slice(0, 10);

      await repo.insertSchedule(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        method, rate: String(ratePercent), depBook,
        usefulLifeYears, startDate, endDate,
        originalCostMinor: asset.acquisitionCost,
        salvageMinor: asset.salvageValue,
        currency: asset.currency ?? "INR",
        status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });

      // P1-2 rounding true-up: bigint truncating division means sum(monthly dep)
      // drifts below (cost - salvage) over the asset's life (SLM), and WDV's
      // geometric decay never reaches salvage exactly. We carry the running book
      // value and, on the FINAL period, post a plug = (bookValue - salvage) so the
      // schedule reconciles exactly: sum(amountMinor) === cost - salvage, and the
      // last bookValueAfterMinor === salvage. Per-period amounts are clamped so we
      // never depreciate below salvage before the end.
      const periods = generatePeriods(startDate, endDate);
      const salvage = asset.salvageValue;
      let bookValue = asset.acquisitionCost;
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i]!;
        const isLast = i === periods.length - 1;
        let amount: bigint;
        if (isLast) {
          // final-period plug: depreciate whatever remains down to salvage
          amount = bookValue - salvage;
          if (amount < 0n) amount = 0n;
        } else {
          amount = computeMonthlyDep(
            method,
            asset.acquisitionCost, salvage,
            bookValue, usefulLifeYears, ratePercent
          );
          // never let a mid-schedule period push book value below salvage
          const maxAmount = bookValue - salvage;
          if (amount > maxAmount) amount = maxAmount > 0n ? maxAmount : 0n;
        }
        bookValue = bookValue - amount;
        if (bookValue < salvage) bookValue = salvage;
        await repo.upsertEntry(tx, {
          id: randomUUID(), tenantId: p.tenantId, assetId: p.assetId,
          scheduleId: p.id, period, depBook,
          amountMinor: amount, currency: asset.currency ?? "INR",
          bookValueAfterMinor: bookValue,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "create", "dep_schedule", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "dep_schedule", p.assetId));
  });

  queue.subscribe(COMMANDS.depRun, async (msg) => {
    const p = msg.payload as { tenantId: string; period: string; depBook?: string };
    const dueEntries = await repo.findDueEntries(p.tenantId, p.period, p.depBook);
    for (const entry of dueEntries) {
      await db.transaction(async (tx) => {
        // Per-entry idempotency key must be a UUID (the _inbox.processed.message_id
        // column is typed uuid). Derive a deterministic UUIDv5 from the outer
        // messageId + entry id so redeliveries dedupe without a malformed cast.
        if (!(await markProcessed(tx, uuidV5(`${msg.messageId}:${entry.id}`)))) return;
        const glRef = `dep:${entry.depBook}:${entry.assetId}:${entry.period}`;
        await repo.markEntryPosted(tx, entry.id, p.tenantId, glRef, msg.actorId);
        if (entry.depBook === "company") {
          await registerRepo.updateAssetBookValue(
            tx, entry.assetId, p.tenantId,
            entry.bookValueAfterMinor,
            ((await registerRepo.findAssetById(entry.assetId, p.tenantId))?.accumulatedDep ?? 0n) + entry.amountMinor,
            msg.actorId
          );
        }
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            assetId: entry.assetId, period: entry.period,
            depAmountMinor: entry.amountMinor.toString(),
            currency: entry.currency, type: "depreciation",
            depBook: entry.depBook,
          },
        });
        await enqueue(tx, {
          topic: EVENTS.depPosted, eventType: EVENTS.depPosted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { assetId: entry.assetId, period: entry.period, amount: entry.amountMinor.toString(), depBook: entry.depBook },
        });
        await audit(tx, msg, "dep_post", "dep_entry", entry.id);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", entry.assetId));
    }
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
