import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

export function registerAnalyticsConsumers(q: Queue): void {
  q.subscribe<{ tenantId: string; deliveryId: string }>(
    COMMANDS.recordOpen, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.recordOpen(tx, p.tenantId, p.deliveryId);
      });
    },
  );

  q.subscribe<{ tenantId: string; deliveryId: string; linkUrl: string }>(
    COMMANDS.recordClick, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.recordClick(tx, p.tenantId, p.deliveryId, p.linkUrl);
      });
    },
  );
}
