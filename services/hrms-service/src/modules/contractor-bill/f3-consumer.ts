// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { computeContractTax, type ContractorKind } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-contractor-bill" });
export function registerF3_contractor_bill_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "contractor_bill_routes__0",
      "contractor_bill_routes__1",
      "contractor_bill_routes__2",
      "contractor_bill_routes__3",
      "contractor_bill_routes__4",
      "contractor_bill_routes__5",
      "contractor_bill_routes__6",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "contractor_bill_routes__0": {
            await repo.insertContractor(tx, {
                  id, tenantId: p.tenantId, name: body.name, contractorKind: body.contractorKind,
                  ...(body.clraLicenseNo ? { clraLicenseNo: body.clraLicenseNo } : {}),
                  ...(body.clraLicenseValidTill ? { clraLicenseValidTill: body.clraLicenseValidTill } : {}),
                  ...(body.pan ? { pan: body.pan } : {}),
                  ...(body.gstin ? { gstin: body.gstin } : {}),
                  ...(body.contactEmail ? { contactEmail: body.contactEmail } : {}),
                  ...(body.contactPhone ? { contactPhone: body.contactPhone } : {}),
                  status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "contractor_bill_routes__1": {
            await repo.updateContractor(tx, p.tenantId, id, patch, c.version);
            break;
          }
          case "contractor_bill_routes__2": {
            await repo.insertBill(tx, {
                    id: billId, tenantId: p.tenantId, contractorId: id,
                    billNo: body.billNo, billDate: body.billDate,
                    ...(body.periodFrom ? { periodFrom: body.periodFrom } : {}),
                    ...(body.periodTo ? { periodTo: body.periodTo } : {}),
                    ...(body.description ? { description: body.description } : {}),
                    workersCount: body.workersCount, wagesDisbursedVerified: body.wagesDisbursedVerified,
                    grossMinor: BigInt(body.grossMinor),
                    gstApplicable: body.gstApplicable, gstRateBps: body.gstRateBps,
                    gstin: (c.gstin as string | undefined) ?? null,
                    status: "submitted",
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "contractor_bill_routes__3": {
            await repo.updateBill(tx, p.tenantId, billId, {
                  status: "verified", verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
                }, bill.version);
            break;
          }
          case "contractor_bill_routes__4": {
            await repo.lockContractorForBilling(tx, p.tenantId, bill.contractorId);
                  const ytd = await repo.ytdApprovedGrossTx(tx, p.tenantId, bill.contractorId, fy.from, fy.to, bill.id);
                  tax = computeContractTax({
                    grossMinor: bill.grossMinor,
                    gstApplicable: bill.gstApplicable, gstRateBps,
                    contractorKind: contractor.contractorKind as ContractorKind,
                    singleThresholdMinor: TDS_194C_SINGLE_MINOR,
                    annualThresholdMinor: TDS_194C_ANNUAL_MINOR,
                    ytdGrossMinor: ytd,
                  });
                  await repo.updateBill(tx, p.tenantId, billId, {
                    status: "approved",
                    gstRateBps, tdsRateBps: tax.tdsRateBps,
                    gstMinor: tax.gstMinor, tdsMinor: tax.tdsMinor, netPayableMinor: tax.netPayableMinor,
                    approvedBy: msg.actorId, approvedAt: new Date(),
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, bill.version);
                  await enqueue(tx, {
                    topic: EVENTS.contractorBillApproved, eventType: EVENTS.contractorBillApproved,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      billId, contractorId: bill.contractorId, billNo: bill.billNo,
                      grossMinor: bill.grossMinor.toString(), gstMinor: tax.gstMinor.toString(),
                      tdsSection: bill.tdsSection, tdsRateBps: tax.tdsRateBps, tdsMinor: tax.tdsMinor.toString(),
                      netPayableMinor: tax.netPayableMinor.toString(), gstin: bill.gstin,
                    },
                  });
            break;
          }
          case "contractor_bill_routes__5": {
            await repo.updateBill(tx, p.tenantId, billId, {
                  status: "rejected",
                  ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                  updatedBy: msg.actorId,
                }, bill.version);
            break;
          }
          case "contractor_bill_routes__6": {
            await repo.updateBill(tx, p.tenantId, billId, {
                    status: "paid", paymentRef: body.paymentRef, paidAt: new Date(), updatedBy: msg.actorId,
                  }, bill.version);
                  await enqueue(tx, {
                    topic: EVENTS.contractorBillPaid, eventType: EVENTS.contractorBillPaid,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      billId, contractorId: bill.contractorId, billNo: bill.billNo,
                      netPayableMinor: bill.netPayableMinor.toString(), paymentRef: body.paymentRef,
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
