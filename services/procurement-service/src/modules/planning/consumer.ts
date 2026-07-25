import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { allocateDocNo } from "../../shared/numbering.js";
import * as repo from "./repo.js";
import * as indentRepo from "../indent/repo.js";
import { procurementIndentItems } from "../indent/schema.js";
import {
  aggregateDemand, planTotalMinor, assertTransitionAllowed,
  assertDistinctMakerChecker, assertPlanApprovedForLinkage,
  type DemandInput,
} from "./domain.js";
import type { PlanLineInsert } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";

export function registerPlanningConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.planCreate, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      let lines: PlanLineInsert[];
      if (p.mode === "from_indents") {
        // SVC-041: aggregate yearly demand from approved indents.
        const demand: DemandInput[] = [];
        for (const indentId of p.indentIds as string[]) {
          const indent = await indentRepo.findIndentByIdTx(tx, indentId);
          if (!indent || indent.tenantId !== p.tenantId) continue;
          if (indent.status !== "approved") continue;
          const items = await tx.select().from(procurementIndentItems)
            .where(and(
              eq(procurementIndentItems.indentId, indentId),
              eq(procurementIndentItems.tenantId, p.tenantId),
            ));
          for (const it of items) {
            demand.push({
              itemCode: it.itemCode,
              description: it.description,
              quantity: it.quantity,
              uom: it.unit,
              unitPriceMinor: BigInt(it.unitPriceMinor),
              procurementMethod: p.defaultMethod,
              sourceIndentId: indentId,
            });
          }
        }
        const aggregated = aggregateDemand(demand);
        lines = aggregated.map((a) => ({
          id: randomUUID(), planId: p.id, tenantId: p.tenantId,
          itemCode: a.itemCode, description: a.description, aggregatedQty: a.aggregatedQty,
          uom: a.uom, procurementCategory: a.procurementCategory, procurementMethod: a.procurementMethod,
          budgetLine: a.budgetLine, estimatedValueMinor: a.estimatedValueMinor,
          timelineQuarter: a.timelineQuarter, packageGroup: a.packageGroup,
          sourceIndentIds: a.sourceIndentIds,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        }));
      } else {
        lines = (p.lines as any[] ?? []).map((l) => ({
          id: randomUUID(), planId: p.id, tenantId: p.tenantId,
          itemCode: l.itemCode, description: l.description, aggregatedQty: l.aggregatedQty ?? 0,
          uom: l.uom ?? "nos", procurementCategory: l.procurementCategory ?? "goods",
          procurementMethod: l.procurementMethod ?? "gem", budgetLine: l.budgetLine ?? null,
          estimatedValueMinor: BigInt(l.estimatedValueMinor ?? 0), timelineQuarter: l.timelineQuarter ?? null,
          packageGroup: l.packageGroup ?? null, sourceIndentIds: l.sourceIndentIds ?? [],
          createdBy: msg.actorId, updatedBy: msg.actorId,
        }));
      }

      const total = planTotalMinor(lines.map((l) => ({ estimatedValueMinor: BigInt(l.estimatedValueMinor ?? 0) })));
      const planNo = await allocateDocNo(tx, p.tenantId, "plan", String(p.planYear));
      await repo.insertPlan(tx, {
        id: p.id, tenantId: p.tenantId, planNo, planYear: p.planYear,
        title: p.title, department: p.department, status: "draft",
        totalEstimatedMinor: total, currency: "INR", notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertPlanLines(tx, lines);
      await audit(tx, msg, "create", "procurement_plan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.id));
  });

  queue.subscribe(COMMANDS.planSubmit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const plan = await repo.findPlanByIdTx(tx, p.id, p.tenantId);
      if (!plan) throw new Error(`plan ${p.id} not found`);
      assertTransitionAllowed(plan.status, "pending");
      await repo.updatePlan(tx, p.id, {
        status: "pending", submittedBy: msg.actorId, submittedAt: new Date(),
        notes: p.notes ?? plan.notes, updatedBy: msg.actorId, version: (plan.version ?? 1) + 1,
      });
      // Maker-checker workflow task for a checker to approve.
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: randomUUID(), tenantId: msg.tenantId,
          name: `Annual Procurement Plan Approval — ${plan.planNo}`,
          status: "active", definitionCode: "procurement_plan_approval",
          initialTaskName: "Plan Approval", version: 1,
          refType: "procurement_plan", refId: p.id,
        },
      });
      await audit(tx, msg, "submit", "procurement_plan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.id));
  });

  queue.subscribe(COMMANDS.planApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const plan = await repo.findPlanByIdTx(tx, p.id, p.tenantId);
      if (!plan) throw new Error(`plan ${p.id} not found`);
      // Maker-checker defense-in-depth.
      assertDistinctMakerChecker(plan.submittedBy ?? plan.createdBy, msg.actorId);
      assertTransitionAllowed(plan.status, "approved");
      await repo.updatePlan(tx, p.id, {
        status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
        updatedBy: msg.actorId, version: (plan.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.planApproved, eventType: EVENTS.planApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          planId: p.id, tenantId: p.tenantId, planNo: plan.planNo,
          planYear: plan.planYear, totalEstimatedMinor: plan.totalEstimatedMinor.toString(),
        },
      });
      await audit(tx, msg, "approve", "procurement_plan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.id));
  });

  queue.subscribe(COMMANDS.planReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const plan = await repo.findPlanByIdTx(tx, p.id, p.tenantId);
      if (!plan) throw new Error(`plan ${p.id} not found`);
      assertTransitionAllowed(plan.status, "rejected");
      await repo.updatePlan(tx, p.id, {
        status: "rejected", rejectedReason: p.reason,
        updatedBy: msg.actorId, version: (plan.version ?? 1) + 1,
      });
      await audit(tx, msg, "reject", "procurement_plan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.id));
  });

  queue.subscribe(COMMANDS.planLinkTender, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; lineId: string; tenderId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const plan = await repo.findPlanByIdTx(tx, p.id, p.tenantId);
      if (!plan) throw new Error(`plan ${p.id} not found`);
      assertPlanApprovedForLinkage(plan.status);
      const line = await repo.findPlanLineByIdTx(tx, p.lineId, p.tenantId);
      if (!line || line.planId !== p.id) throw new Error(`plan line ${p.lineId} not found`);
      await repo.updatePlanLine(tx, p.lineId, {
        tenderId: p.tenderId, tenderLinkedAt: new Date(),
        updatedBy: msg.actorId, version: (line.version ?? 1) + 1,
      });
      await audit(tx, msg, "link_tender", "procurement_plan_line", p.lineId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.id));
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
