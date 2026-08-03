import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsContractConfig } from "./schema.js";
import { DomainError, daysUntilExpiry } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-contracts" });
export function registerF3_contracts_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "contracts_routes__0",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "contracts_routes__0": {
            const updated = await tx
                    .insert(hrmsContractConfig)
                    .values(insertValues as typeof hrmsContractConfig.$inferInsert)
                    .onConflictDoUpdate({
                      target: hrmsContractConfig.tenantId,
                      set: updateSet,
                    })
                    .returning();
                  return updated[0] ?? null;
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
