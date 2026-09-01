import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { stageOwner } from "./routes.js";
import { computeOverallGrade, type ScoreInput } from "./engine.js";
import type { AppraisalRow } from "../appraisals/schema.js";
const log = pino({ name: "hrms-f3-apar" });

/**
 * F3 leftover write consumer for the APAR / SPARROW appraisal workflow.
 *
 * ── Bug class fixed here (same shape as `leave_policy_admin_routes__0`) ──
 * The generator that stubbed these routes down to a bare `publishF3Write(...)`
 * dropped the "fetch the appraisal + compute the derived values" preamble each
 * handler had. Cases 1–6 closed over locals that exist only in the route file
 * and are NEVER defined here: the fetched appraisal `a` (used for its
 * optimistic-lock `version` and its previous stage), the request context `ctx`,
 * the `override` flag from `assertStageOwner`, the module-private
 * `trueActorRole()` helper, and the computed `grade`. Every one of them threw
 * `ReferenceError: <x> is not defined`. Because the routes answer 200 as soon as
 * the message is queued (fire-and-forget), the whole APAR chain was a fake
 * success — self-appraisal, reporting scores, reviewing concurrence/variation,
 * acceptance-with-grade, representation and finalisation all reported the new
 * stage to the caller while the appraisal never moved and no stage-history row
 * was ever appended.
 *
 * ── Reconstruction rules used below ──
 *  - `id` (i.e. `p.id`) is the queued entity id and is the PRIMARY KEY of the
 *    appraisal created by `apar_routes__0` (the contract the already-correct
 *    `disciplinary_routes__3` follows). Cases 1–6 act on an EXISTING appraisal
 *    and therefore key off the route path param `params.id`: the generated
 *    `const id = p.id || params.id` above always resolves to `p.id`, which the
 *    stubbed routes fill with a throwaway `randomUUID()`, so an update keyed off
 *    `id` would match zero rows.
 *  - `a` is re-fetched here inside the consumer. That is strictly better than
 *    the original: `version` and the recorded `fromStage` are read at write time
 *    rather than from a stale pre-publish snapshot.
 *  - `override` and the audited actor role are DERIVED, not guessed — see
 *    `stageOverride()` / `actorRoleFor()` below for the exact argument.
 *  - Stage-ownership (403) and stage-order (409) checks the route already ran in
 *    `assertStageOwner` are not repeated; only write-time data is rebuilt.
 *
 * KNOWN REMAINING DEFECT (route-side, out of scope for this file): POST
 * /v1/hrms/apar mints its own uuid, returns it to the caller, then publishes an
 * unrelated `randomUUID()` — so the id the caller receives is not the id
 * persisted here and the caller cannot drive the chain on the APAR it just
 * created. `disciplinary_routes__3` shows the intended fix.
 */

/**
 * Recovers the route's `override` flag without needing `ctx.roles`.
 *
 * `assertStageOwner` in routes.ts admits exactly two outcomes (everything else
 * throws before publish): the actor IS the officer assigned to the current
 * stage => override false, or the actor is a super_admin acting as an explicit
 * privileged override => override true. Stage ownership is a pure function of
 * the appraisal row and the actor id, both of which are available here, so the
 * flag is reproduced exactly rather than inferred.
 */
function stageOverride(a: AppraisalRow, actorId: string): boolean {
  const { ownerId } = stageOwner(a);
  return !(ownerId !== null && ownerId === actorId);
}

/**
 * Mirrors the module-private `trueActorRole()` in routes.ts. That helper records
 * the functional stage role when the actor genuinely owns the stage, and the
 * actor's real elevated role on an override. Since `assertStageOwner` only ever
 * returns `override: true` on the `ctx.roles.includes("super_admin")` branch,
 * an override is necessarily a super_admin — so history is never falsified.
 */
function actorRoleFor(functionalRole: string, override: boolean): string {
  return override ? "super_admin" : functionalRole;
}

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
    /** The appraisal a stage-transition case acts on (cases 1..6). */
    const appraisalId = String(params.id ?? "");
    const mustAppraisal = async (): Promise<AppraisalRow> => {
      const a = await repo.findAppraisal(appraisalId, p.tenantId);
      if (!a) throw new HttpError(404, "NOT_FOUND", "appraisal not found");
      return a;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "apar_routes__0": {
            // POST /v1/hrms/apar — no path param; `id` is the new appraisal's PK.
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
            // POST /v1/hrms/apar/:id/self-appraisal — stage self_pending -> reporting_officer
            const a = await mustAppraisal();
            const override = stageOverride(a, msg.actorId);
            await repo.updateAppraisal(tx, appraisalId, {
                    selfAppraisal: body.selfAppraisal, status: "reporting_officer", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId, fromStage: "self_pending", toStage: "reporting_officer",
                    actorId: msg.actorId, actorRole: actorRoleFor("appraisee", override), override,
                    remarks: "self-appraisal submitted",
                    payload: { selfAppraisal: body.selfAppraisal },
                  });
            break;
          }
          case "apar_routes__2": {
            // POST /v1/hrms/apar/:id/reporting — stage reporting_officer -> reviewing_officer.
            // `weight` falls back to the route schema's Zod `.default(1)` because
            // `body` here is the raw pre-Zod request payload.
            const a = await mustAppraisal();
            const override = stageOverride(a, msg.actorId);
            for (const s of body.scores) {
                    await repo.upsertScore(tx, {
                      tenantId: p.tenantId, appraisalId, attribute: s.attribute,
                      weight: String(s.weight ?? 1), score: s.score,
                      ...(s.remarks !== undefined ? { remarks: s.remarks } : {}),
                      scoredBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                  }
                  await repo.updateAppraisal(tx, appraisalId, {
                    reportingPenPicture: body.penPicture, status: "reviewing_officer", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId, fromStage: "reporting_officer", toStage: "reviewing_officer",
                    actorId: msg.actorId, actorRole: actorRoleFor("reporting_officer", override), override,
                    remarks: "scores + pen-picture recorded",
                    payload: { penPicture: body.penPicture, scores: body.scores },
                  });
            break;
          }
          case "apar_routes__3": {
            // POST /v1/hrms/apar/:id/reviewing — stage reviewing_officer -> accepting_authority
            const a = await mustAppraisal();
            const override = stageOverride(a, msg.actorId);
            if (body.decision === "vary" && body.variations) {
                    const existing = await repo.listScores(p.tenantId, appraisalId);
                    const byAttr = new Map(existing.map((e) => [e.attribute, e]));
                    for (const v of body.variations) {
                      const row = byAttr.get(v.attribute);
                      if (!row) continue;
                      await repo.upsertScore(tx, {
                        tenantId: p.tenantId, appraisalId, attribute: v.attribute,
                        weight: row.weight, score: v.score, scoredBy: msg.actorId,
                        createdBy: msg.actorId, updatedBy: msg.actorId,
                        remarks: `varied by reviewing officer (was ${row.score})`,
                      });
                    }
                  }
                  await repo.updateAppraisal(tx, appraisalId, {
                    reviewingRemarks: body.remarks, status: "accepting_authority", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId, fromStage: "reviewing_officer", toStage: "accepting_authority",
                    actorId: msg.actorId, actorRole: actorRoleFor("reviewing_officer", override), override,
                    remarks: body.remarks, payload: { decision: body.decision, variations: body.variations ?? [] },
                  });
            break;
          }
          case "apar_routes__4": {
            // POST /v1/hrms/apar/:id/accept — stage accepting_authority -> disclosed.
            // The grade is server-computed, exactly as the route did: read the
            // persisted attribute scores (already including any stage-3
            // variations) and run the same engine.
            const a = await mustAppraisal();
            const override = stageOverride(a, msg.actorId);
            const scoreRows = await repo.listScores(p.tenantId, appraisalId);
            if (scoreRows.length === 0) throw new HttpError(409, "NO_SCORES", "no attribute scores to grade");
            const scores: ScoreInput[] = scoreRows.map((s) => ({
              attribute: s.attribute, weight: Number(s.weight), score: s.score,
            }));
            const grade = computeOverallGrade(scores);
            await repo.updateAppraisal(tx, appraisalId, {
                    acceptingRemarks: body.remarks,
                    overallGrade: String(grade.overallGrade),
                    overallBand: grade.band,
                    status: "disclosed",
                    disclosedAt: new Date(),
                    updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId, fromStage: "accepting_authority", toStage: "disclosed",
                    actorId: msg.actorId, actorRole: actorRoleFor("accepting_authority", override), override,
                    remarks: body.remarks,
                    payload: { computed: { overallGrade: grade.overallGrade, band: grade.band, totalWeight: grade.totalWeight, attributeCount: grade.attributeCount } },
                  });
            break;
          }
          case "apar_routes__5": {
            // POST /v1/hrms/apar/:id/representation — stage disclosed -> representation
            const a = await mustAppraisal();
            const override = stageOverride(a, msg.actorId);
            await repo.updateAppraisal(tx, appraisalId, {
                    representation: body.representation, status: "representation", updatedBy: msg.actorId,
                  }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId, fromStage: "disclosed", toStage: "representation",
                    actorId: msg.actorId, actorRole: actorRoleFor("appraisee", override), override,
                    remarks: "representation filed",
                    payload: { representation: body.representation },
                  });
            break;
          }
          case "apar_routes__6": {
            // POST /v1/hrms/apar/:id/finalise — HR closes from disclosed or
            // representation; the route restricts this to HR_ROLES, so the audited
            // actor role stays "hr" and there is no stage-owner override concept.
            const a = await mustAppraisal();
            await repo.updateAppraisal(tx, appraisalId, { status: "finalised", updatedBy: msg.actorId }, a.version);
                  await repo.appendHistory(tx, {
                    tenantId: p.tenantId, appraisalId, fromStage: a.status, toStage: "finalised",
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
