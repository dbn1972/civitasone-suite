import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertUcExpenditureWithinReleased } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerUcConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.ucSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; schemeId: string; ucNo: string;
      periodFrom: string; periodTo: string; releasedMinor: number; expenditureMinor: number;
      submittedBy: string;
      items: Array<{ componentId: string; releasedMinor: number; expenditureMinor: number }>;
    };

    const releasedMinor = BigInt(p.releasedMinor);
    const expenditureMinor = BigInt(p.expenditureMinor);

    try {
      assertUcExpenditureWithinReleased(releasedMinor, expenditureMinor);
    } catch (err) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.ucExpenditureExceeded, eventType: EVENTS.ucExpenditureExceeded,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            ucId: p.id, schemeId: p.schemeId, releasedMinor: p.releasedMinor,
            expenditureMinor: p.expenditureMinor, reason: String(err),
          },
        });
      });
      return;
    }

    const balanceMinor = releasedMinor - expenditureMinor;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertUcStatement(tx, {
        id: p.id, schemeId: p.schemeId, tenantId: p.tenantId,
        ucNo: p.ucNo, periodFrom: p.periodFrom, periodTo: p.periodTo,
        releasedMinor, expenditureMinor, balanceMinor,
        submittedBy: p.submittedBy, submittedAt: new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows = p.items.map((i) => ({
        id: randomUUID(), ucStatementId: p.id, componentId: i.componentId,
        tenantId: p.tenantId, releasedMinor: BigInt(i.releasedMinor),
        expenditureMinor: BigInt(i.expenditureMinor),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertUcItems(tx, itemRows);
      await enqueue(tx, {
        topic: EVENTS.ucSubmitted, eventType: EVENTS.ucSubmitted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          ucId: p.id, schemeId: p.schemeId, ucNo: p.ucNo,
          releasedMinor: p.releasedMinor, expenditureMinor: p.expenditureMinor,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "project", action: "submit", resourceType: "uc_statement", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "uc", p.schemeId));
  });
}
