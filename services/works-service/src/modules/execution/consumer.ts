import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { workIssues, workClosures } from "./schema.js";
import { eq } from "drizzle-orm";

export function registerExecutionConsumers(q: Queue): void {
  q.subscribe(COMMANDS.issueCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workIssues).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        issueTypeId: (p.issueTypeId as string) ?? undefined,
        description: p.description as string,
        attachmentKey: (p.attachmentKey as string) ?? undefined,
        raisedDate: new Date(),
        status: "open",
      });

      await enqueue(tx, {
        topic: EVENTS.issueCreated,
        eventType: EVENTS.issueCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
    });
  });

  q.subscribe(COMMANDS.workClose, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workClosures).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        closureType: p.closureType as string,
        closedDate: new Date(),
        remarks: (p.remarks as string) ?? undefined,
      });

      await enqueue(tx, {
        topic: EVENTS.workClosed,
        eventType: EVENTS.workClosed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { workId: p.workId, closureType: p.closureType },
      });
    });
  });
}
