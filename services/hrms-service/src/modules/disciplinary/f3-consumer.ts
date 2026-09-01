import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import { hrmsCoiDeclarations } from "./schema.js";
import { hrmsIccComplaints, hrmsIccHearings } from "./schema.js";
import { hrmsSuspensions, type DisciplinaryCaseInsert } from "./schema.js";
const log = pino({ name: "hrms-f3-disciplinary" });

/**
 * F3 leftover write consumer for the disciplinary / vigilance module.
 *
 * ── Bug class fixed here (same shape as `leave_policy_admin_routes__0`) ──
 * The generator that stubbed these routes down to a bare `publishF3Write(...)`
 * dropped the "fetch the record + compute the derived values" preamble each
 * handler had. Every case below except `disciplinary_routes__3` closed over
 * locals that live only in the route file and are NEVER defined here — the
 * fetched case row `c`, the fetched suspension `s`, the computed target status
 * `to`, plus `patch` / `action` / `notes` / `actorId` / `declId` / `hid` /
 * `caseId` / `suspId`. Each threw `ReferenceError: <x> is not defined` on the
 * first line it executed. Because the HTTP routes answer 200/201 as soon as the
 * message is queued (fire-and-forget), every one of these writes was a fake
 * success: charge-memos, inquiries, findings, penalties, appeals, case closure,
 * suspension revocations, COI declarations and ICC complaints/hearings were all
 * reported as applied while nothing was ever written.
 *
 * ── Reconstruction rules used below ──
 *  - `id` (i.e. `p.id`) is the queued entity id and is the PRIMARY KEY of the
 *    row an INSERT case creates — the contract the already-correct
 *    `disciplinary_routes__3` follows (it publishes its own `suspId` there).
 *  - The entity a case MUTATES is identified by the ROUTE PATH PARAM. The
 *    generated `const id = p.id || params.id` above always resolves to `p.id`,
 *    which the stubbed routes fill with a throwaway `randomUUID()`, so keying an
 *    update off `id` would match zero rows and silently no-op.
 *  - Rows fetched by the route before the write are re-fetched here INSIDE the
 *    consumer transaction. That is strictly better than the original: the
 *    optimistic-lock `version` and the `fromStatus` recorded in the audit trail
 *    are read at write time rather than from a stale pre-publish snapshot.
 *  - Validation the route already performed (`mustEmployee`, `hasActiveSuspension`,
 *    `canTransition`) is NOT repeated; only the write-time data is rebuilt.
 *
 * KNOWN REMAINING DEFECT (route-side, out of scope for this file): the create
 * routes (`disciplinary_routes__1`, `disciplinary_coi_routes__0`,
 * `disciplinary_icc_routes__0/1`) mint their own uuid, return it to the caller,
 * then publish an UNRELATED `randomUUID()` — so the id the caller receives is
 * not the id persisted here, and the caller cannot act on the row it just
 * created. `disciplinary_routes__3` shows the intended fix (publish the route's
 * own id).
 */
export function registerF3_disciplinary_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "disciplinary_coi_routes__0",
      "disciplinary_coi_routes__1",
      "disciplinary_coi_routes__2",
      "disciplinary_icc_routes__0",
      "disciplinary_icc_routes__1",
      "disciplinary_routes__0",
      "disciplinary_routes__1",
      "disciplinary_routes__2",
      "disciplinary_routes__3",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "disciplinary_coi_routes__0": {
            // POST /v1/hrms/employees/:id/declarations
            const declId = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsCoiDeclarations).values({
                    id: declId,
                    tenantId: p.tenantId,
                    employeeId,
                    declarationType: body.declarationType,
                    declarationDate: body.declarationDate,
                    details: body.details,
                    status: "active",
                    createdBy: msg.actorId,
                    updatedBy: msg.actorId,
                  });
            break;
          }
          case "disciplinary_coi_routes__1": {
            // POST /v1/hrms/declarations/:declId/revoke
            const declId = String(params.declId ?? "");
            const rows = await tx.select({ id: hrmsCoiDeclarations.id, status: hrmsCoiDeclarations.status, version: hrmsCoiDeclarations.version })
                    .from(hrmsCoiDeclarations)
                    .where(and(eq(hrmsCoiDeclarations.id, declId), eq(hrmsCoiDeclarations.tenantId, p.tenantId)))
                    .limit(1);
                  const decl = rows[0];
                  if (!decl) throw new HttpError(404, "NOT_FOUND", "declaration not found");
                  if (decl.status !== "active") {
                    throw new HttpError(409, "WRONG_STATE", `declaration is '${decl.status}', cannot revoke`);
                  }
                  await tx.update(hrmsCoiDeclarations)
                    .set({
                      status: "revoked",
                      revokedAt: new Date(),
                      revokeReason: body.reason,
                      updatedBy: msg.actorId,
                      updatedAt: new Date(),
                    })
                    .where(and(eq(hrmsCoiDeclarations.id, declId), eq(hrmsCoiDeclarations.version, decl.version)));
            break;
          }
          case "disciplinary_coi_routes__2": {
            // POST /v1/hrms/declarations/:declId/acknowledge
            const declId = String(params.declId ?? "");
            const rows = await tx.select({ id: hrmsCoiDeclarations.id, status: hrmsCoiDeclarations.status, version: hrmsCoiDeclarations.version })
                    .from(hrmsCoiDeclarations)
                    .where(and(eq(hrmsCoiDeclarations.id, declId), eq(hrmsCoiDeclarations.tenantId, p.tenantId)))
                    .limit(1);
                  const decl = rows[0];
                  if (!decl) throw new HttpError(404, "NOT_FOUND", "declaration not found");
                  if (decl.status !== "active") {
                    throw new HttpError(409, "WRONG_STATE", `declaration is '${decl.status}', cannot acknowledge`);
                  }
                  await tx.update(hrmsCoiDeclarations)
                    .set({
                      acknowledgedAt: new Date(),
                      updatedBy: msg.actorId,
                      updatedAt: new Date(),
                    })
                    .where(and(eq(hrmsCoiDeclarations.id, declId), eq(hrmsCoiDeclarations.version, decl.version)));
            break;
          }
          case "disciplinary_icc_routes__0": {
            // POST /v1/hrms/icc/complaints — no path param; `id` is the new PK.
            await tx.insert(hrmsIccComplaints).values({
                  id, tenantId: p.tenantId, complainantId: body.complainantId,
                  respondentId: body.respondentId ?? null, summary: body.summary,
                  createdBy: msg.actorId,
                });
            break;
          }
          case "disciplinary_icc_routes__1": {
            // POST /v1/hrms/icc/complaints/:id/hearings
            const hid = id;
            const complaintId = String(params.id ?? "");
            await tx.insert(hrmsIccHearings).values({
                  id: hid, tenantId: p.tenantId, complaintId,
                  hearingDate: body.hearingDate, notes: body.notes ?? null,
                  finding: body.finding ?? null, conductedBy: msg.actorId,
                });
            break;
          }
          case "disciplinary_routes__0": {
            // Guarded case transition (charge-memo / inquiry / finding / penalty /
            // appeal / appeal-decision / close / drop). The route's `transition()`
            // helper already validated the transition with `canTransition` and
            // forwards the derived values on the payload, so `action`, `patch`,
            // `notes`, `caseId`, `actorId` and the target status `to` are read
            // from `p` — but the case row itself was never forwarded, so it is
            // re-fetched here (inside the tx) for `fromStatus` and `version`.
            const caseId = String(p.caseId ?? "");
            const actorId = String(p.actorId ?? msg.actorId);
            const to = String(p.to ?? "");
            const action = String(p.action ?? "");
            const notes = (p.notes ?? null) as string | null;
            const patch = (p.patch ?? {}) as Partial<DisciplinaryCaseInsert>;
            const c = await repo.findCaseTx(tx, p.tenantId, caseId);
            if (!c) throw new HttpError(404, "NOT_FOUND", "disciplinary case not found");
            await repo.updateCase(tx, c.tenantId, c.id, { ...patch, status: to, updatedBy: actorId }, c.version);
                  await repo.appendEvent(tx, {
                    tenantId: c.tenantId, caseId: c.id, fromStatus: c.status, toStatus: to,
                    action, notes, actorId,
                  });
            break;
          }
          case "disciplinary_routes__1": {
            // POST /v1/hrms/employees/:id/disciplinary-cases — `proceedingType`
            // mirrors the route's Zod `.default("major")`, because `body` here is
            // the raw pre-Zod request payload.
            const caseId = id;
            const employeeId = String(params.id ?? "");
            await repo.insertCase(tx, {
                    id: caseId, tenantId: p.tenantId, employeeId,
                    caseNo: body.caseNo, proceedingType: body.proceedingType ?? "major",
                    status: "opened", allegation: body.allegation,
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  await repo.appendEvent(tx, {
                    tenantId: p.tenantId, caseId, fromStatus: null, toStatus: "opened",
                    action: "open", notes: null, actorId: msg.actorId,
                  });
            break;
          }
          case "disciplinary_routes__2": {
            // POST /v1/hrms/suspensions/:suspId/revoke — the suspension row was
            // fetched by the route for its optimistic-lock `version` but never
            // forwarded, so it is re-read here inside the tx.
            const suspId = String(params.suspId ?? "");
            const sRows = await tx.select({ id: hrmsSuspensions.id, status: hrmsSuspensions.status, version: hrmsSuspensions.version })
                    .from(hrmsSuspensions)
                    .where(and(eq(hrmsSuspensions.id, suspId), eq(hrmsSuspensions.tenantId, p.tenantId)))
                    .limit(1);
            const s = sRows[0];
            if (!s) throw new HttpError(404, "NOT_FOUND", "suspension not found");
            await repo.updateSuspension(tx, p.tenantId, suspId, {
                    status: "revoked", paySuspended: false, revokedDate: body.revokedDate,
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    updatedBy: msg.actorId,
                  }, s.version);
            break;
          }
          case "disciplinary_routes__3": {
            const employeeId = String(params.id ?? "");
            await repo.insertSuspension(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              fromDate: body.fromDate,
              paySuspended: Boolean(body.paySuspended),
              subsistencePct: Number(body.subsistencePct ?? 50).toFixed(2),
              status: "active",
              ...(body.caseId ? { caseId: body.caseId } : {}),
              ...(body.orderRef ? { orderRef: body.orderRef } : {}),
              ...(body.toDate ? { toDate: body.toDate } : {}),
              ...(body.remarks ? { remarks: body.remarks } : {}),
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
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
