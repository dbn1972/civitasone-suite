import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeVacancy, allocateRoster, canApprove } from "./domain.js";
const log = pino({ name: "hrms-f3-manpower-planning" });

// Mirrors the module-private `AUDIT` constant in manpower-planning/routes.ts.
const AUDIT = "audit.event.record";

export function registerF3_manpower_planning_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "manpower_planning_routes__0",
      "manpower_planning_routes__1",
      "manpower_planning_routes__2",
      "manpower_planning_routes__3",
      "manpower_planning_routes__4",
      "manpower_planning_routes__5",
      "manpower_planning_routes__6",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    // Every route calls `publishF3Write(ctx, op, randomUUID(), …)`, so `p.id`
    // (and therefore `id` above) is a FRESH uuid minted at publish time — it is
    // NEVER the `:id` from the URL. `id` is only safe as the primary key of a
    // brand-new row; anything that addresses an EXISTING row must use the path
    // param. `pathId` below is that value.
    const pathId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "manpower_planning_routes__0": {
            await repo.insertPlan(tx, {
                    id, tenantId: p.tenantId, planYear: body.planYear, unitId: body.unitId,
                    cadre: body.cadre, designationId: body.designationId ?? null,
                    requiredStrength: body.requiredStrength, sanctionedStrength: body.sanctionedStrength,
                    filledStrength: body.filledStrength, remarks: body.remarks ?? null,
                    status: "draft", createdBy: msg.actorId,
                  });
            break;
          }
          case "manpower_planning_routes__1": {
            await repo.updateDraftPlan(tx, p.tenantId, pathId, {
                  ...(body.requiredStrength !== undefined ? { requiredStrength: body.requiredStrength } : {}),
                  ...(body.sanctionedStrength !== undefined ? { sanctionedStrength: body.sanctionedStrength } : {}),
                  ...(body.filledStrength !== undefined ? { filledStrength: body.filledStrength } : {}),
                  ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
                });
            break;
          }
          case "manpower_planning_routes__2": {
            await repo.replaceRoster(tx, p.tenantId, pathId, body.entries);
            break;
          }
          case "manpower_planning_routes__3": {
            await repo.submitPlan(tx, p.tenantId, pathId);
            break;
          }
          case "manpower_planning_routes__4": {
            // F3 codegen repair (same bug class as leave/f3-consumer.ts
            // `leave_policy_admin_routes__0`): the generator dropped the
            // "load the plan, then compute its vacancy" preamble that
            // manpower-planning/routes.ts ran before it was stubbed down to
            // publishF3Write(...). `plan`, `vac` and `AUDIT` were referenced but
            // never defined, so approving a manpower plan threw a ReferenceError
            // here on every call — after the route had already answered 200
            // "approved". The plan was never approved, no recruitment
            // requisition was generated, and no hrms.job.create was emitted.
            const plan = await repo.getPlanTx(tx, p.tenantId, pathId);
            // The route already 404'd on a missing plan and enforced the
            // maker-checker guard (canApprove) before publishing.
            if (!plan) return null;
            const vac = computeVacancy({
              requiredStrength: plan.requiredStrength,
              sanctionedStrength: plan.sanctionedStrength,
              filledStrength: plan.filledStrength,
            });

            const approved = await repo.approvePlan(tx, p.tenantId, pathId, msg.actorId);
                  if (!approved) return null; // lost the race — no longer pending

                  // Persist an auto-allocated roster if the maker did not set one.
                  const existing = await repo.listRoster(p.tenantId, pathId);
                  if (existing.length === 0 && vac.vacancy > 0) {
                    const alloc = allocateRoster(vac.vacancy);
                    await repo.replaceRoster(tx, p.tenantId, pathId,
                      alloc.rows.map((r) => ({ category: r.category, reservedCount: r.reservedCount })));
                  }

                  let requisition: { id: string; requisitionNo: string; jobOpeningId: string; requestedVacancies: number } | null = null;

                  // Generate a recruitment requisition FROM the plan only when there is a
                  // recruitable vacancy (sanctioned − filled > 0).
                  if (vac.vacancy > 0) {
                    const reqId = randomUUID();
                    const jobOpeningId = randomUUID();
                    const shortId = reqId.slice(0, 8).toUpperCase();
                    const requisitionNo = `MP-REQ-${plan.planYear}-${shortId}`;
                    const refNo = `${body.refNoPrefix ?? "RCT"}/${plan.planYear}/${shortId}`;
                    const title = body.title ?? `${plan.cadre} (${plan.planYear})`;

                    await repo.insertRequisition(tx, {
                      id: reqId, tenantId: p.tenantId, planId: pathId, requisitionNo,
                      unitId: plan.unitId, cadre: plan.cadre, designationId: plan.designationId,
                      requestedVacancies: vac.vacancy, filledCount: 0, jobOpeningId,
                      status: "emitted", createdBy: msg.actorId,
                    });

                    // Emit to the EXISTING recruitment flow via the outbox. The recruitment
                    // consumer inserts a job opening with id === jobOpeningId, so a later
                    // hire against that opening maps straight back to this requisition.
                    await enqueue(tx, {
                      topic: COMMANDS.jobCreate, eventType: COMMANDS.jobCreate,
                      tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                      payload: {
                        id: jobOpeningId, tenantId: p.tenantId, refNo, title,
                        departmentId: plan.unitId, designationId: plan.designationId ?? undefined,
                        vacancies: vac.vacancy, vacancyType: "regular",
                        description: `Auto-generated from approved manpower plan ${pathId}`,
                        isPublished: false,
                      },
                    });

                    requisition = { id: reqId, requisitionNo, jobOpeningId, requestedVacancies: vac.vacancy };
                  }

                  await enqueue(tx, {
                    topic: AUDIT, eventType: AUDIT,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: { service: "hrms", action: "approve", resourceType: "manpower_plan", resourceId: pathId, outcome: "success" },
                  });

                  return { approved, requisition };
          }
          case "manpower_planning_routes__5": {
            await repo.rejectPlan(tx, p.tenantId, pathId, msg.actorId);
            break;
          }
          case "manpower_planning_routes__6": {
            await repo.markRequisitionAdvertised(tx, p.tenantId, pathId, body.advertisementRef);
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
