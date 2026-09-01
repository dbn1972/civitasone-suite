import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  canApprove, decideApproval, nextWaitlistPosition, pickPromotion, summariseAttendance,
} from "./domain.js";
import { hrmsNominations } from "../training/schema.js";
import { trainingSessions } from "./schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-training-admin" });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`):
 *
 *  - `training_admin_routes__0` referenced an undefined `sid` (the new session's primary
 *    key, still computed in routes.ts and returned to the client as 201 `{id}`).
 *  - `training_admin_routes__1` referenced undefined `outcome` and `waitlistPosition` —
 *    the seat-vs-waitlist decision. routes.ts loads the session, counts the already
 *    approved nominations, and calls `decideApproval(session.capacity, approvedCount)` /
 *    `nextWaitlistPosition(...)`; all of that was dropped by the code-gen tool.
 *  - `training_admin_routes__2` referenced undefined `freedApproved` and `sessionId` —
 *    derived in routes.ts from the nomination's PRE-rejection state (`nom.status ===
 *    "approved"`, `nom.sessionId`), which drives whether a freed seat promotes the next
 *    waitlisted candidate.
 *
 * Each of these threw a ReferenceError inside this async consumer *after* the HTTP route
 * had already answered 200/201, so training-session creation, nomination approval and
 * nomination rejection all reported success while writing nothing. For approvals this is
 * the worst of the three: capacity enforcement and waitlist ordering never ran at all.
 *
 * Second defect fixed here: routes.ts publishes `randomUUID()` as the message id, so the
 * generated `id` local is a fresh UUID rather than the `:id` path param. Cases 0/1/2/3 all
 * need that param (training id, nomination id, session id), so it is resolved explicitly.
 *
 * Case 2 must read the nomination BEFORE `repo.rejectNomination` overwrites its status —
 * that ordering is what `freedApproved` depends on, and is preserved below.
 *
 * Reads are done inside `tx` (rather than the repo's scopedRead helpers) so they see this
 * transaction's own writes; the counts mirror `repo.countApprovedForSession` /
 * `countWaitlistedForSession` exactly. Zod `.default(...)` values from validators.ts are
 * mirrored because `body` here is the raw pre-validation request body.
 */
export function registerF3_training_admin_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "training_admin_routes__0",
      "training_admin_routes__1",
      "training_admin_routes__2",
      "training_admin_routes__3",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    // The `:id` path segment: training id (case 0), nomination id (1, 2), session id (3).
    const routeId = String(params.id ?? "");
    const countByStatus = async (tx: any, sessionId: string, status: string): Promise<number> => {
      const rows = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(hrmsNominations)
        .where(and(
          eq(hrmsNominations.tenantId, p.tenantId),
          eq(hrmsNominations.sessionId, sessionId),
          eq(hrmsNominations.status, status),
        ));
      return rows[0]?.n ?? 0;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "training_admin_routes__0": {
            // The new session's PK must be the id the route already handed the client:
            // routes.ts returns `{ id: row.id }` where `row` is publishF3Write's Accepted
            // envelope, i.e. exactly the message id in `p.id`. (Its `const sid = randomUUID()`
            // is dead leftover from before the route was stubbed — it is never returned.)
            const sid = id;
            await repo.insertSession(tx, {
                  id: sid, tenantId: p.tenantId, trainingId: routeId, title: body.title,
                  sessionDate: body.sessionDate, startTime: body.startTime ?? null, endTime: body.endTime ?? null,
                  venue: body.venue ?? null, capacity: body.capacity ?? 30, status: "scheduled",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "training_admin_routes__1": {
            // routes.ts: session -> approvedCount -> decideApproval -> nextWaitlistPosition
            const sessionRows = await tx.select().from(trainingSessions)
              .where(and(eq(trainingSessions.tenantId, p.tenantId), eq(trainingSessions.id, body.sessionId)))
              .limit(1);
            const session = sessionRows[0];
            if (!session) {
              log.warn({ op, sessionId: body.sessionId, messageId: msg.messageId }, "session disappeared before async approval");
              return;
            }
            const approvedCount = await countByStatus(tx, body.sessionId, "approved");
            const outcome = decideApproval(session.capacity, approvedCount);
            let waitlistPosition: number | null = null;
            if (outcome === "waitlisted") {
              const waited = await countByStatus(tx, body.sessionId, "waitlisted");
              waitlistPosition = nextWaitlistPosition(waited);
            }
            await repo.decideNomination(tx, p.tenantId, routeId, msg.actorId, {
                  status: outcome, sessionId: body.sessionId, waitlistPosition,
                });
            break;
          }
          case "training_admin_routes__2": {
            // The freed-seat decision is derived from the nomination's PRE-rejection state,
            // so this read must happen before repo.rejectNomination overwrites `status`.
            const nomRows = await tx.select().from(hrmsNominations)
              .where(and(eq(hrmsNominations.tenantId, p.tenantId), eq(hrmsNominations.id, routeId)))
              .limit(1);
            const nom = nomRows[0];
            if (!nom) {
              log.warn({ op, nominationId: routeId, messageId: msg.messageId }, "nomination disappeared before async rejection");
              return;
            }
            const freedApproved = nom.status === "approved";
            const sessionId = nom.sessionId;
            const row = await repo.rejectNomination(tx, p.tenantId, routeId, msg.actorId);
                  if (!row) return;
                  // If a seat was freed, promote the earliest waitlisted nomination.
                  let promotedId: string | null = null;
                  if (freedApproved && sessionId) {
                    const waitlisted = await tx
                      .select({ id: hrmsNominations.id, waitlistPosition: hrmsNominations.waitlistPosition })
                      .from(hrmsNominations)
                      .where(and(
                        eq(hrmsNominations.tenantId, p.tenantId),
                        eq(hrmsNominations.sessionId, sessionId),
                        eq(hrmsNominations.status, "waitlisted"),
                      ));
                    promotedId = pickPromotion(waitlisted);
                    if (promotedId) await repo.promoteNomination(tx, p.tenantId, promotedId, msg.actorId);
                  }
            break;
          }
          case "training_admin_routes__3": {
            await repo.upsertAttendance(tx, {
                  tenantId: p.tenantId, sessionId: routeId, employeeId: body.employeeId,
                  status: body.status ?? "present", markedBy: msg.actorId,
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
