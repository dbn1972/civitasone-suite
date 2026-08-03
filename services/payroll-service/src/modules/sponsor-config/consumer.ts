import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { sponsorBankConfig } from "./schema.js";

const log = pino({ name: "payroll-sponsor-config-consumer" });
const AUDIT = "audit.event.record";
const CACHE_RESOURCE = "sponsor_bank_config";

export function registerSponsorConfigConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.sponsorConfigUpsert, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      sponsorCode: string;
      sponsorIfsc: string;
      sponsorAccount: string;
      utilityCode?: string | null;
      userNumber?: string | null;
      settlementOffsetDays: number;
      nachEnabled: boolean;
      apbsEnabled: boolean;
      maxRecordsPerFile: number;
      maxAmountPerFileMinor: string;
    };

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(sponsorBankConfig).values({
          tenantId: p.tenantId,
          sponsorCode: p.sponsorCode,
          sponsorIfsc: p.sponsorIfsc,
          sponsorAccount: p.sponsorAccount,
          utilityCode: p.utilityCode ?? null,
          userNumber: p.userNumber ?? null,
          settlementOffsetDays: p.settlementOffsetDays,
          nachEnabled: p.nachEnabled,
          apbsEnabled: p.apbsEnabled,
          maxRecordsPerFile: p.maxRecordsPerFile,
          maxAmountPerFileMinor: BigInt(p.maxAmountPerFileMinor),
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        }).onConflictDoUpdate({
          target: sponsorBankConfig.tenantId,
          set: {
            sponsorCode: p.sponsorCode,
            sponsorIfsc: p.sponsorIfsc,
            sponsorAccount: p.sponsorAccount,
            utilityCode: p.utilityCode ?? null,
            userNumber: p.userNumber ?? null,
            settlementOffsetDays: p.settlementOffsetDays,
            nachEnabled: p.nachEnabled,
            apbsEnabled: p.apbsEnabled,
            maxRecordsPerFile: p.maxRecordsPerFile,
            maxAmountPerFileMinor: BigInt(p.maxAmountPerFileMinor),
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          },
        });
        await enqueue(tx, {
          topic: EVENTS.sponsorConfigUpserted,
          eventType: EVENTS.sponsorConfigUpserted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { tenantId: p.tenantId, sponsorCode: p.sponsorCode },
        });
        await enqueue(tx, {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "payroll",
            action: "upsert",
            resourceType: "sponsor_bank_config",
            resourceId: p.tenantId,
            outcome: "success",
          },
        });
      });
      await cache.invalidate(cache.makeKey(p.tenantId, CACHE_RESOURCE, p.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "sponsorConfigUpsert failed");
      throw err;
    }
  });
}
