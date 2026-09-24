// @ts-nocheck — generated F3 leftover consumer
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { hrmsServiceBookEntries } from "./schema.js";

const log = pino({ name: "hrms-f3-service-book" });
const AUDIT = "audit.event.record";

// SEC-CRIT-002: local HR audit trail for service-book mutations. Mirrors the
// audit() helper pattern used by every other hrms-service consumer (e.g.
// modules/appraisals/consumer.ts, modules/contracts/consumer.ts) -- this
// consumer was missing it entirely, a regression versus the legacy
// service-book/consumer.ts it superseded (which did call enqueue(...AUDIT)).
async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}

export function registerF3_service_book_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "service_book_routes__0",
      "service_book_routes__1",
      "service_book_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.entryId as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "service_book_routes__0": {
            const employeeId = String(params.id ?? "");
            await repo.insertServiceBookEntry(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              recordedBy: msg.actorId,
              entryType: body.entryType,
              effectiveDate: body.effectiveDate,
              description: body.description,
              documentRef: body.documentRef ?? null,
            });
            await audit(tx, msg, "add_entry", "service_book", id);
            break;
          }
          case "service_book_routes__1": {
            // SEC-CRIT-003: immutable-once-attested guard. This WHERE clause
            // was missing `eq(attested, false)` -- compare the attest case
            // below, which always had it -- so a stale/racing edit (the
            // route's own pre-check reads attested BEFORE this async command
            // is processed) could silently overwrite an already-attested
            // entry. .returning() lets us tell "guard blocked it" apart from
            // "row genuinely doesn't exist" and fail loudly either way
            // instead of a silent no-op.
            const updated = await tx.update(hrmsServiceBookEntries)
              .set({
                description: body.description,
                documentRef: body.documentRef ?? null,
                updatedAt: new Date(),
                updatedBy: msg.actorId,
              })
              .where(and(
                eq(hrmsServiceBookEntries.id, id),
                eq(hrmsServiceBookEntries.tenantId, p.tenantId),
                eq(hrmsServiceBookEntries.attested, false),
              ))
              .returning();
            if (updated.length === 0) {
              // Permanent, not transient -- retrying can never make an edit
              // against an attested entry succeed. Route straight to the DLQ
              // (see NonRetryableError's contract in queue-service/bus.ts)
              // instead of quietly doing nothing.
              throw new NonRetryableError(`service book entry ${id} is attested and cannot be edited`);
            }
            await audit(tx, msg, "edit", "service_book", id);
            break;
          }
          case "service_book_routes__2": {
            const attested = await tx.update(hrmsServiceBookEntries)
              .set({
                attested: true,
                attestedBy: msg.actorId,
                attestedAt: new Date(),
                attestRemarks: body.remarks ?? null,
              })
              .where(and(
                eq(hrmsServiceBookEntries.id, id),
                eq(hrmsServiceBookEntries.tenantId, p.tenantId),
                eq(hrmsServiceBookEntries.attested, false),
              ))
              .returning();
            if (attested.length === 0) {
              // Loser of a concurrent double-attest race (the route's own
              // pre-check normally catches this before publish). Don't audit
              // a write that didn't happen; this WHERE guard already existed
              // before this change, so unlike the edit case above this is
              // not a new failure mode being introduced here.
              log.warn({ op, id, messageId: msg.messageId }, "attest no-op: entry already attested");
              break;
            }
            await audit(tx, msg, "attest", "service_book", id);
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
