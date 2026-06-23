import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { computeMonthlyDep, generatePeriods } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";

export function registerDepreciationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.depSchedule, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string; method: string; startDate: string;
      depBook?: string;
    };
    const depBook = p.depBook ?? "company";
    const method = p.method as "SLM" | "WDV";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const asset = await registerRepo.findAssetById(p.assetId);
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

      const periods = generatePeriods(startDate, endDate);
      let bookValue = asset.acquisitionCost;
      for (const period of periods) {
        const amount = computeMonthlyDep(
          method,
          asset.acquisitionCost, asset.salvageValue,
          bookValue, usefulLifeYears, ratePercent
        );
        bookValue = bookValue - amount;
        if (bookValue < asset.salvageValue) bookValue = asset.salvageValue;
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
    const dueEntries = await repo.findDueEntries(p.period, p.depBook);
    for (const entry of dueEntries) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, `${msg.messageId}:${entry.id}`))) return;
        const glRef = `dep:${entry.depBook}:${entry.assetId}:${entry.period}`;
        await repo.markEntryPosted(tx, entry.id, glRef, msg.actorId);
        if (entry.depBook === "company") {
          await registerRepo.updateAssetBookValue(
            tx, entry.assetId,
            entry.bookValueAfterMinor,
            ((await registerRepo.findAssetById(entry.assetId))?.accumulatedDep ?? 0n) + entry.amountMinor,
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
