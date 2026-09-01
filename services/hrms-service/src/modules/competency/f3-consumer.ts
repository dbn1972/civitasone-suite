import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { analyzeGaps, mergeLevel } from "./domain.js";
import { competencies } from "./schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-competency" });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`):
 *
 *  - `competency_routes__1` referenced an undefined `cid` — routes.ts still computes
 *    `const cid = randomUUID()` for the new competency's primary key but the insert was
 *    moved here without it, so every "add competency to framework" POST threw a
 *    ReferenceError in this consumer after the route had already answered 201.
 *  - `competency_routes__3` referenced an undefined `level` — routes.ts clamps the
 *    submitted level to the competency's ceiling (`Math.min(body.currentLevel,
 *    comp.maxLevel)`) using a competency it fetched first; the fetch and the clamp were
 *    both dropped, so every employee-competency PUT crashed after answering 200.
 *
 * Second defect fixed here: routes.ts publishes `randomUUID()` as the message id, so the
 * generated `id` local is a fresh UUID, not the route's `:id` path param. Cases 1 and 3
 * use that param as a foreign key (frameworkId / employeeId), so they resolve `params.id`
 * explicitly — otherwise the insert would point at a framework/employee that never existed.
 *
 * Zod `.default(...)` values from validators.ts are mirrored field-for-field below,
 * because `body` here is the raw pre-validation request body forwarded through the queue.
 */
export function registerF3_competency_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "competency_routes__0",
      "competency_routes__1",
      "competency_routes__2",
      "competency_routes__3",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    // The `:id` path segment (framework id for case 1, employee id for case 3).
    const routeId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "competency_routes__0": {
            await repo.insertFramework(tx, {
                  id, tenantId: p.tenantId, name: body.name, description: body.description ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "competency_routes__1": {
            // The new competency's PK must be the id the route already handed the client:
            // routes.ts returns `{ id: row.id }` where `row` is publishF3Write's Accepted
            // envelope, i.e. exactly the message id in `p.id`. (Its `const cid = randomUUID()`
            // is dead leftover from before the route was stubbed — it is never returned.)
            // Generating a fresh UUID here would store a row the caller can never address.
            const cid = id;
            await repo.insertCompetency(tx, {
                  id: cid, tenantId: p.tenantId, frameworkId: routeId, code: body.code, name: body.name,
                  description: body.description ?? null, category: body.category ?? "general",
                  maxLevel: body.maxLevel ?? 5, certifiedLevel: body.certifiedLevel ?? 3,
                });
            break;
          }
          case "competency_routes__2": {
            await repo.upsertRoleRequirement(tx, {
                  id: randomUUID(), tenantId: p.tenantId, roleCode: body.roleCode,
                  competencyId: body.competencyId, requiredLevel: body.requiredLevel,
                });
            break;
          }
          case "competency_routes__3": {
            // routes.ts: const comp = await repo.getCompetency(...); const level = Math.min(body.currentLevel, comp.maxLevel);
            const compRows = await tx.select().from(competencies)
              .where(and(eq(competencies.tenantId, p.tenantId), eq(competencies.id, body.competencyId)))
              .limit(1);
            const comp = compRows[0];
            if (!comp) {
              log.warn({ op, competencyId: body.competencyId, messageId: msg.messageId }, "competency disappeared before async write");
              return;
            }
            const level = Math.min(body.currentLevel, comp.maxLevel);
            await repo.upsertEmployeeCompetency(tx, {
                  tenantId: p.tenantId, employeeId: routeId, competencyId: body.competencyId,
                  currentLevel: level, source: body.source ?? "manual", evidenceRef: body.evidenceRef ?? null,
                });
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
