import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  hrmsRosters, hrmsRosterPoints, hrmsSanctionedPosts,
  type RosterRow, type SanctionedPostRow,
} from "./schema.js";
import { generateRosterPoints } from "./engine.js";
const log = pino({ name: "hrms-f3-reservation" });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`).
 *
 * `reservation_routes__1` (materialise the roster point chart) referenced three things
 * that were never defined in this file: `rid`, `points`, and — via the `for (const p of
 * points)` loop — a shadowed `p`. routes.ts still fetches the roster (`mustRoster`) and
 * derives the chart (`generateRosterPoints({...})`) before publishing, but the code-gen
 * tool moved only the delete/insert here. Every POST .../rosters/:rid/points therefore
 * threw a ReferenceError in this consumer after the route had already answered 200, so
 * the point chart was silently never (re)built — a reservation-roster correctness issue.
 *
 * Note the path param here is `:rid`, not `:id`, so the generated `id` local (which is a
 * fresh `randomUUID()` from the publish call anyway) is doubly wrong for this case.
 *
 * Also fixed: the loop variable `p` shadowed the message payload `p`, so `p.tenantId`
 * inside the loop read the *roster point* object rather than the payload and would have
 * written `undefined` into the tenant column even once `points` existed. Renamed to `pt`.
 *
 * Cases 0 and 2 additionally lost their Zod `.default(...)` / `.coerce` handling: `body`
 * here is the raw pre-validation body, so `body.pctSc.toFixed(2)` threw a TypeError on
 * every request that omitted a percentage (all of them are optional-with-default in
 * routes.ts). Defaults and numeric coercion below mirror that Zod schema field-for-field.
 */
export function registerF3_reservation_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "reservation_routes__0",
      "reservation_routes__1",
      "reservation_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    /** Mirrors `z.coerce.number()...default(d)` for a raw queued body value. */
    const num = (v: unknown, d: number): number => {
      if (v === undefined || v === null || v === "") return d;
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "reservation_routes__0": {
            await tx.insert(hrmsRosters).values({
                  id, tenantId: p.tenantId, cadre: body.cadre,
                  rosterKind: body.rosterKind ?? "point100",
                  rosterSize: num(body.rosterSize, 100),
                  pctSc: num(body.pctSc, 15).toFixed(2), pctSt: num(body.pctSt, 7.5).toFixed(2),
                  pctObc: num(body.pctObc, 27).toFixed(2), pctEws: num(body.pctEws, 10).toFixed(2),
                  pctPwd: num(body.pctPwd, 4).toFixed(2),
                  cfSc: num(body.cfSc, 0), cfSt: num(body.cfSt, 0), cfObc: num(body.cfObc, 0),
                  cfEws: num(body.cfEws, 0), cfUr: num(body.cfUr, 0),
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "reservation_routes__1": {
            // routes.ts: const { rid } = ridParam.parse(req.params); const r = await mustRoster(...);
            const rid = String(params.rid ?? "");
            const rosterRows = await tx.select().from(hrmsRosters)
              .where(and(eq(hrmsRosters.tenantId, p.tenantId), eq(hrmsRosters.id, rid)))
              .limit(1);
            const r = rosterRows[0] as RosterRow | undefined;
            if (!r) {
              log.warn({ op, rid, messageId: msg.messageId }, "roster disappeared before async point materialisation");
              return;
            }
            const points = generateRosterPoints({
              rosterSize: r.rosterSize, pctSc: Number(r.pctSc), pctSt: Number(r.pctSt),
              pctObc: Number(r.pctObc), pctEws: Number(r.pctEws),
            });
            // Idempotent: clear and re-materialise.
            await tx.delete(hrmsRosterPoints)
                    .where(and(eq(hrmsRosterPoints.tenantId, p.tenantId), eq(hrmsRosterPoints.rosterId, rid)));
                  for (const pt of points) {
                    await tx.insert(hrmsRosterPoints).values({
                      id: randomUUID(), tenantId: p.tenantId, rosterId: rid,
                      pointNo: pt.point, category: pt.category, filled: false,
                    });
                  }
            break;
          }
          case "reservation_routes__2": {
            await tx.insert(hrmsSanctionedPosts).values({
                  id, tenantId: p.tenantId, cadre: body.cadre,
                  sanctionedStrength: num(body.sanctionedStrength, 0),
                  ...(body.designationId ? { designationId: body.designationId } : {}),
                  ...(body.payLevel ? { payLevel: body.payLevel } : {}),
                  ...(body.remarks ? { remarks: body.remarks } : {}),
                  createdBy: msg.actorId, updatedBy: msg.actorId,
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
