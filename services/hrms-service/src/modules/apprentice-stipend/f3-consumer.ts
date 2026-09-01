import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hrmsEmployees } from "../employee/schema.js";
import { computeStipend } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-apprentice-stipend" });
/**
 * HR-A deep-verify fix (F3 batch 5). The F3 code-gen lifted each route's WRITE
 * into the switch below but dropped the "fetch the current record + compute the
 * derived values" preamble that sat above it in the original handler. Every case
 * here therefore referenced locals (`emp`, `a`, `s`, `patch`, `stipend`,
 * `stipendId`) declared nowhere in this file, so each one threw a ReferenceError
 * the instant it ran. The route has already answered 200/201 by then — the write
 * is fire-and-forget through the queue — so every enrolment, edit, verify,
 * approve, reject and mark-paid was a FAKE SUCCESS: the caller was told it
 * worked while this consumer crashed before touching the database.
 *
 * The preambles are restored below, mirroring routes.ts. Checks the route
 * already performed (state-machine transitions, two-person control) are NOT
 * repeated: the HTTP layer rejected those before publishing, so only the data
 * the write itself needs is re-derived here. `body` is the RAW pre-Zod request
 * body forwarded through the queue, so each schema `.default(...)` is applied
 * explicitly to keep persisted values identical to the validated ones.
 *
 * Entity ids come from `params` (what the route's `idParam`/`stipendParam`
 * parsed), not from the top-level `id`: routes.ts publishes a fresh randomUUID
 * as the message id, so `id` identifies the MESSAGE and is only usable as the
 * primary key of a row this consumer creates.
 */
export function registerF3_apprentice_stipend_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "apprentice_stipend_routes__0",
      "apprentice_stipend_routes__1",
      "apprentice_stipend_routes__2",
      "apprentice_stipend_routes__3",
      "apprentice_stipend_routes__4",
      "apprentice_stipend_routes__5",
      "apprentice_stipend_routes__6",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "apprentice_stipend_routes__0": {
            // Restored: routes.ts read the employee (mustEmployee) for the
            // NAPS-id fallback before inserting.
            const empRows = await tx.select().from(hrmsEmployees)
              .where(and(eq(hrmsEmployees.id, body.apprenticeId), eq(hrmsEmployees.tenantId, p.tenantId))).limit(1);
            const emp = empRows[0];
            if (!emp) throw new HttpError(404, "NOT_FOUND", "apprentice (employee) not found");
            await repo.insertApprenticeship(tx, {
                  id, tenantId: p.tenantId, apprenticeId: body.apprenticeId,
                  napsId: body.napsId ?? (emp.napsId as string | undefined) ?? null,
                  ...(body.trade ? { trade: body.trade } : {}),
                  qualification: body.qualification ?? "other",
                  monthlyStipendMinor: BigInt(body.monthlyStipendMinor),
                  napsReimbPctBps: body.napsReimbPctBps ?? 2500,
                  napsReimbCapMinor: BigInt(body.napsReimbCapMinor ?? 150000),
                  trainingStart: body.trainingStart,
                  ...(body.trainingEnd ? { trainingEnd: body.trainingEnd } : {}),
                  status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "apprentice_stipend_routes__1": {
            // Restored: `a` (the current apprenticeship, for its optimistic-lock
            // version) and `patch` (built field-by-field from the body).
            const apprenticeshipId = (params.id as string) || id;
            const a = await repo.findApprenticeship(p.tenantId, apprenticeshipId);
            if (!a) throw new HttpError(404, "NOT_FOUND", "apprenticeship not found");
            const patch = {
              updatedBy: msg.actorId,
              ...(body.monthlyStipendMinor !== undefined ? { monthlyStipendMinor: BigInt(body.monthlyStipendMinor) } : {}),
              ...(body.trainingEnd !== undefined ? { trainingEnd: body.trainingEnd as string } : {}),
              ...(body.status !== undefined ? { status: body.status as string } : {}),
            };
            await repo.updateApprenticeship(tx, p.tenantId, apprenticeshipId, patch, a.version);
            break;
          }
          case "apprentice_stipend_routes__2": {
            // Restored: `a` — the run snapshots the apprenticeship's agreed
            // stipend and NAPS rate/cap, so `a` must be read before inserting.
            const apprenticeshipId = (params.id as string) || id;
            const a = await repo.findApprenticeship(p.tenantId, apprenticeshipId);
            if (!a) throw new HttpError(404, "NOT_FOUND", "apprenticeship not found");
            const stipendId = id;
            await repo.insertStipend(tx, {
                    id: stipendId, tenantId: p.tenantId, apprenticeshipId,
                    month: body.month, workingDays: body.workingDays, daysPresent: body.daysPresent,
                    // Snapshot the agreed stipend AND the NAPS rate/cap for THIS period, so a
                    // later edit to the apprenticeship master can't retroactively change how
                    // an already-submitted run is computed at approval.
                    monthlyStipendMinor: a.monthlyStipendMinor,
                    napsReimbPctBps: a.napsReimbPctBps, napsReimbCapMinor: a.napsReimbCapMinor,
                    status: "submitted",
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "apprentice_stipend_routes__3": {
            // Restored: `s` — read for its optimistic-lock version.
            const stipendId = (params.stipendId as string) || id;
            const s = await repo.findStipend(p.tenantId, stipendId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "stipend run not found");
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                  status: "verified", verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
                }, s.version);
            break;
          }
          case "apprentice_stipend_routes__4": {
            // Restored: `s`, its parent apprenticeship `a` (for the event
            // payload) and `stipend` — the pro-rated stipend + NAPS
            // reimbursement, computed from the values SNAPSHOTTED on the run at
            // submit (not the live master), exactly as routes.ts did.
            const stipendId = (params.stipendId as string) || id;
            const s = await repo.findStipend(p.tenantId, stipendId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "stipend run not found");
            const a = await repo.findApprenticeship(p.tenantId, s.apprenticeshipId);
            if (!a) throw new HttpError(404, "NOT_FOUND", "apprenticeship not found");
            const stipend = computeStipend({
              monthlyStipendMinor: s.monthlyStipendMinor,
              workingDays: s.workingDays, daysPresent: s.daysPresent,
              napsReimbPctBps: s.napsReimbPctBps, napsReimbCapMinor: s.napsReimbCapMinor,
            });
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                    status: "approved",
                    grossStipendMinor: stipend.grossStipendMinor,
                    napsReimbMinor: stipend.napsReimbMinor,
                    employerCostMinor: stipend.employerCostMinor,
                    approvedBy: msg.actorId, approvedAt: new Date(),
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, s.version);
                  await enqueue(tx, {
                    topic: EVENTS.apprenticeStipendApproved, eventType: EVENTS.apprenticeStipendApproved,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      stipendId, apprenticeshipId: s.apprenticeshipId, apprenticeId: a.apprenticeId, napsId: a.napsId,
                      month: s.month, grossStipendMinor: stipend.grossStipendMinor.toString(),
                      napsReimbMinor: stipend.napsReimbMinor.toString(), employerCostMinor: stipend.employerCostMinor.toString(),
                    },
                  });
            break;
          }
          case "apprentice_stipend_routes__5": {
            // Restored: `s` — read for its optimistic-lock version.
            const stipendId = (params.stipendId as string) || id;
            const s = await repo.findStipend(p.tenantId, stipendId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "stipend run not found");
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                  status: "rejected",
                  ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                  updatedBy: msg.actorId,
                }, s.version);
            break;
          }
          case "apprentice_stipend_routes__6": {
            // Restored: `s` — read for its version AND for the paid-event
            // payload (month + the gross approved at the previous step).
            const stipendId = (params.stipendId as string) || id;
            const s = await repo.findStipend(p.tenantId, stipendId);
            if (!s) throw new HttpError(404, "NOT_FOUND", "stipend run not found");
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                    status: "paid", paymentRef: body.paymentRef, paidAt: new Date(), updatedBy: msg.actorId,
                  }, s.version);
                  await enqueue(tx, {
                    topic: EVENTS.apprenticeStipendPaid, eventType: EVENTS.apprenticeStipendPaid,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      stipendId, apprenticeshipId: s.apprenticeshipId, month: s.month,
                      grossStipendMinor: s.grossStipendMinor.toString(), paymentRef: body.paymentRef,
                    },
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
