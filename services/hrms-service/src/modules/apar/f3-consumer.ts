// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-apar" });
export function registerF3_apar_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "apar_routes__0",
      "apar_routes__1",
      "apar_routes__2",
      "apar_routes__3",
      "apar_routes__4",
      "apar_routes__5",
      "apar_routes__6",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "apar_routes__0": {
            await tx.insert((await import("../appraisals/schema.js")).hrmsAppraisals).values({
                    id, tenantId: p.tenantId, employeeId: body.employeeId,
                    appraisalPeriod: body.appraisalPeriod, status: "self_pending",
                    reportingOfficerId: body.reportingOfficerId,
                    reviewingOfficerId: body.reviewingOfficerId,
                    acceptingAuthorityId: body.acceptingAuthorityId,
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: null, toStage: "self_pending",
                    actorId: msg.actorId, actorRole: "initiator",
                    remarks: "APAR initiated", payload: { officers: body },
                  });
            break;
          }
          case "apar_routes__1": {
            await repo.updateAppraisal(tx, id, {
                    selfAppraisal: body.selfAppraisal, status: "reporting_officer", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: "self_pending", toStage: "reporting_officer",
                    actorId: msg.actorId, actorRole: trueActorRole(ctx, "appraisee", override), override,
                    remarks: "self-appraisal submitted",
                    payload: { selfAppraisal: body.selfAppraisal },
                  });
            break;
          }
          case "apar_routes__2": {
            for (const s of body.scores) {
                    await repo.upsertScore(tx, {
                      tenantId: p.tenantId, appraisalId: id, attribute: s.attribute,
                      weight: String(s.weight), score: s.score,
                      ...(s.remarks !== undefined ? { remarks: s.remarks } : {}),
                      scoredBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                  }
                  await repo.updateAppraisal(tx, id, {
                    reportingPenPicture: body.penPicture, status: "reviewing_officer", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: "reporting_officer", toStage: "reviewing_officer",
                    actorId: msg.actorId, actorRole: trueActorRole(ctx, "reporting_officer", override), override,
                    remarks: "scores + pen-picture recorded",
                    payload: { penPicture: body.penPicture, scores: body.scores },
                  });
            break;
          }
          case "apar_routes__3": {
            if (body.decision === "vary" && body.variations) {
                    const existing = await repo.listScores(p.tenantId, id);
                    const byAttr = new Map(existing.map((e) => [e.attribute, e]));
                    for (const v of body.variations) {
                      const row = byAttr.get(v.attribute);
                      if (!row) continue;
                      await repo.upsertScore(tx, {
                        tenantId: p.tenantId, appraisalId: id, attribute: v.attribute,
                        weight: row.weight, score: v.score, scoredBy: msg.actorId,
                        createdBy: msg.actorId, updatedBy: msg.actorId,
                        remarks: `varied by reviewing officer (was ${row.score})`,
                      });
                    }
                  }
                  await repo.updateAppraisal(tx, id, {
                    reviewingRemarks: body.remarks, status: "accepting_authority", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: "reviewing_officer", toStage: "accepting_authority",
                    actorId: msg.actorId, actorRole: trueActorRole(ctx, "reviewing_officer", override), override,
                    remarks: body.remarks, payload: { decision: body.decision, variations: body.variations ?? [] },
                  });
            break;
          }
          case "apar_routes__4": {
            await repo.updateAppraisal(tx, id, {
                    acceptingRemarks: body.remarks,
                    overallGrade: String(grade.overallGrade),
                    overallBand: grade.band,
                    status: "disclosed",
                    disclosedAt: new Date(),
                    updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: "accepting_authority", toStage: "disclosed",
                    actorId: msg.actorId, actorRole: trueActorRole(ctx, "accepting_authority", override), override,
                    remarks: body.remarks,
                    payload: { computed: { overallGrade: grade.overallGrade, band: grade.band, totalWeight: grade.totalWeight, attributeCount: grade.attributeCount } },
                  });
            break;
          }
          case "apar_routes__5": {
            await repo.updateAppraisal(tx, id, {
                    representation: body.representation, status: "representation", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: "disclosed", toStage: "representation",
                    actorId: msg.actorId, actorRole: trueActorRole(ctx, "appraisee", override), override,
                    remarks: "representation filed",
                    payload: { representation: body.representation },
                  });
            break;
          }
          case "apar_routes__6": {
            await repo.updateAppraisal(tx, id, { status: "finalised", updatedBy: msg.actorId }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId: id, fromStage: a.status, toStage: "finalised",
                    actorId: msg.actorId, actorRole: "hr", remarks: "APAR finalised", payload: {},
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
