import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

type GenerateCauseListPayload = {
  id: string;
  tenantId: string;
  courtId: string;
  benchId?: string;
  listDate: string; // YYYY-MM-DD
  listType?: string;
};

type ListCasePayload = {
  id: string;
  causeListId: string;
  tenantId: string;
  caseId: string;
  itemNumber: number;
  slot: string;
  courtroom: string;
};

export function registerCauseListConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Generate (materialize) a cause-list for a court/day (§17).
  register<GenerateCauseListPayload>(COMMANDS.generateCauseList, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCauseList(tx, {
        id: p.id,
        tenantId: p.tenantId,
        courtId: p.courtId,
        benchId: p.benchId ?? null,
        listDate: p.listDate,
        status: "draft",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.causeListGenerated,
        eventType: EVENTS.causeListGenerated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { courtId: p.courtId, causeListId: p.id, listDate: p.listDate },
      });
      await audit(tx, msg, "generate", "court_cause_list", p.id);
    });
  });

  // List a case onto a slot/courtroom of a cause-list (§17) — the btree_gist
  // EXCLUDE constraint guards against double-booking a (list_date, slot, courtroom).
  register<ListCasePayload>(COMMANDS.listCaseOnCauseList, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const parent = await repo.getCauseList(p.tenantId, p.causeListId);
      if (!parent) throw new NonRetryableError(`CAUSELIST_NOT_FOUND: ${p.causeListId}`);

      try {
        await repo.insertCauseListItem(tx, {
          id: p.id,
          tenantId: p.tenantId,
          causeListId: p.causeListId,
          caseId: p.caseId,
          itemNumber: p.itemNumber,
          slot: p.slot,
          courtroom: p.courtroom,
          listDate: parent.listDate, // denormalized from the parent cause-list
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      } catch (e) {
        if (repo.isUniqueViolation(e)) {
          throw new NonRetryableError("CAUSELIST_SLOT_CONFLICT: courtroom/slot already booked");
        }
        // Backstop for the rare TOCTOU race with the command layer's synchronous
        // existence pre-check (commands.ts) — the common case is now an honest
        // 404 there, before this insert ever runs.
        if (repo.isForeignKeyViolation(e)) {
          throw new NonRetryableError("CAUSELIST_CASE_NOT_FOUND: referenced case does not exist");
        }
        throw e;
      }

      await enqueue(tx, {
        topic: EVENTS.causeListItemAdded,
        eventType: EVENTS.causeListItemAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { causeListId: p.causeListId, caseId: p.caseId, slot: p.slot, courtroom: p.courtroom },
      });
      await audit(tx, msg, "list_case", "court_cause_list_item", p.id);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
