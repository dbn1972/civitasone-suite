import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { bills } from "./schema.js";
import { demands } from "../assessment/schema.js";
import { rateHeads } from "../rate-engine/schema.js";
import { generateBillFromDemand } from "./domain.js";
import { eq, and } from "drizzle-orm";

export function registerBillingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.billGenerate, async (msg) => {
    let assesseeId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assessmentId } = msg.payload as { assessmentId: string };

      // Load demand for the assessment
      const [demand] = await tx
        .select()
        .from(demands)
        .where(and(eq(demands.tenantId, msg.tenantId), eq(demands.assessmentId, assessmentId)));

      if (!demand) {
        throw new Error(`No demand found for assessment ${assessmentId}`);
      }

      assesseeId = demand.assesseeId;

      // Load the rate head to get the category
      const [rateHead] = await tx
        .select()
        .from(rateHeads)
        .where(eq(rateHeads.id, demand.rateHeadId));

      const rateCategory = rateHead?.category ?? "property_tax";

      // Determine bill sequence (count of existing bills for tenant + 1)
      const existingBills = await tx
        .select()
        .from(bills)
        .where(eq(bills.tenantId, msg.tenantId));
      const billSequence = existingBills.length + 1;

      const billDate = new Date().toISOString().split("T")[0]!;

      // Generate the bill using the domain function
      const billData = generateBillFromDemand(
        {
          id: demand.id,
          assesseeId: demand.assesseeId,
          assessmentId: demand.assessmentId,
          rateHeadId: demand.rateHeadId,
          financialYear: demand.financialYear,
          dueDate: demand.dueDate,
          principalMinor: demand.principalMinor,
          rebateMinor: demand.rebateMinor,
          penaltyMinor: demand.penaltyMinor,
          netMinor: demand.netMinor,
        },
        rateCategory,
        billSequence,
        billDate,
      );

      // Insert the bill
      await tx.insert(bills).values({
        tenantId: msg.tenantId,
        assesseeId: billData.assesseeId,
        demandId: billData.demandId,
        assessmentId: billData.assessmentId,
        billNo: billData.billNo,
        billDate: billData.billDate,
        dueDate: billData.dueDate,
        principalMinor: billData.principalMinor,
        rebateMinor: billData.rebateMinor,
        penaltyMinor: billData.penaltyMinor,
        totalMinor: billData.totalMinor,
        receiptHeadCode: billData.receiptHeadCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Enqueue domain event
      await enqueue(tx, {
        topic: EVENTS.billGenerated,
        eventType: EVENTS.billGenerated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          assessmentId,
          billNo: billData.billNo,
          totalMinor: billData.totalMinor.toString(),
          assesseeId: billData.assesseeId,
        },
      });

      // Enqueue audit event
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "generate",
          resourceType: "bill",
          resourceId: billData.billNo,
          outcome: "success",
        },
      });
    });

    // Invalidate cache outside transaction
    if (assesseeId) {
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:bills:${assesseeId}`);
    }
  });
}
