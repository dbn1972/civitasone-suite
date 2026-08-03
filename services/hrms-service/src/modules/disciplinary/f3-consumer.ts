import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import { hrmsCoiDeclarations } from "./schema.js";
import { hrmsIccComplaints, hrmsIccHearings } from "./schema.js";
const log = pino({ name: "hrms-f3-disciplinary" });
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
            await tx.insert(hrmsCoiDeclarations).values({
                    id: declId,
                    tenantId: p.tenantId,
                    employeeId: id,
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
            await tx.insert(hrmsIccComplaints).values({
                  id, tenantId: p.tenantId, complainantId: body.complainantId,
                  respondentId: body.respondentId ?? null, summary: body.summary,
                  createdBy: msg.actorId,
                });
            break;
          }
          case "disciplinary_icc_routes__1": {
            await tx.insert(hrmsIccHearings).values({
                  id: hid, tenantId: p.tenantId, complaintId: id,
                  hearingDate: body.hearingDate, notes: body.notes ?? null,
                  finding: body.finding ?? null, conductedBy: msg.actorId,
                });
            break;
          }
          case "disciplinary_routes__0": {
            await repo.updateCase(tx, c.tenantId, c.id, { ...patch, status: to, updatedBy: actorId }, c.version);
                  await repo.appendEvent(tx, {
                    tenantId: c.tenantId, caseId: c.id, fromStatus: c.status, toStatus: to,
                    action, notes, actorId,
                  });
            break;
          }
          case "disciplinary_routes__1": {
            await repo.insertCase(tx, {
                    id: caseId, tenantId: p.tenantId, employeeId: id,
                    caseNo: body.caseNo, proceedingType: body.proceedingType,
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
            await repo.updateSuspension(tx, p.tenantId, suspId, {
                    status: "revoked", paySuspended: false, revokedDate: body.revokedDate,
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    updatedBy: msg.actorId,
                  }, s.version);
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
