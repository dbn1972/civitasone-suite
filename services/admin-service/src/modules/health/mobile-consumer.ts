import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./mobile-repo.js";

const log = pino({ name: "admin-mobile-telemetry-consumer" });

export function registerMobileTelemetryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.mobileTelemetryRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; appVersion: string; platform: string; osVersion: string;
      deviceModel: string; coldStartMs: number; warmStartMs: number | null;
      crashCount: number; anrCount: number; sessionCount: number; recordedAt: string;
      screens: Array<{ screen: string; renderMs: number; sampleCount: number }>;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const w = tx as repo.Writer;
        const recordedAt = new Date(p.recordedAt);
        const event = await repo.insertTelemetry(w, {
          id: p.id,
          tenantId: p.tenantId,
          appVersion: p.appVersion,
          platform: p.platform,
          osVersion: p.osVersion,
          deviceModel: p.deviceModel,
          coldStartMs: p.coldStartMs,
          warmStartMs: p.warmStartMs,
          crashCount: p.crashCount,
          anrCount: p.anrCount,
          sessionCount: p.sessionCount,
          recordedAt,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await repo.insertScreenRenders(w, p.screens.map((s) => ({
          tenantId: p.tenantId,
          eventId: event.id,
          platform: p.platform,
          appVersion: p.appVersion,
          screen: s.screen,
          renderMs: s.renderMs,
          sampleCount: s.sampleCount,
          recordedAt,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "mobileTelemetryRecord failed");
      throw err;
    }
  });
}
