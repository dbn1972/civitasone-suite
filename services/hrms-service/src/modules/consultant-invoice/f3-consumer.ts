// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { computeInvoiceTax } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-consultant-invoice" });
export function registerF3_consultant_invoice_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "consultant_invoice_routes__0",
      "consultant_invoice_routes__1",
      "consultant_invoice_routes__2",
      "consultant_invoice_routes__3",
      "consultant_invoice_routes__4",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "consultant_invoice_routes__0": {
            await repo.insertInvoice(tx, {
                    id: invId, tenantId: p.tenantId, consultantId: id,
                    invoiceNo: body.invoiceNo, invoiceDate: body.invoiceDate,
                    ...(body.periodFrom ? { periodFrom: body.periodFrom } : {}),
                    ...(body.periodTo ? { periodTo: body.periodTo } : {}),
                    ...(body.description ? { description: body.description } : {}),
                    grossMinor: BigInt(body.grossMinor),
                    gstApplicable: body.gstApplicable, gstRateBps: body.gstRateBps,
                    tdsRateBps: body.tdsRateBps,
                    gstin: body.gstin ?? (emp.gstin as string | undefined) ?? null,
                    sacCode: body.sacCode ?? (emp.sacCode as string | undefined) ?? null,
                    status: "submitted",
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "consultant_invoice_routes__1": {
            await repo.updateInvoice(tx, p.tenantId, invId, {
                    status: "verified", verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
                  }, inv.version);
            break;
          }
          case "consultant_invoice_routes__2": {
            // Serialize approvals for the same consultant so two concurrent approvals
                  // can't each read a pre-crossing YTD total and both under-withhold 194J.
                  await repo.lockConsultantForInvoicing(tx, p.tenantId, inv.consultantId);
                  const ytd = await repo.ytdApprovedGrossTx(tx, p.tenantId, inv.consultantId, fy.from, fy.to, inv.id);
                  tax = computeInvoiceTax({
                    grossMinor: inv.grossMinor,
                    gstApplicable: inv.gstApplicable, gstRateBps,
                    tdsRateBps, tdsThresholdMinor: TDS_194J_THRESHOLD_MINOR,
                    ytdGrossMinor: ytd,
                  });
                  await repo.updateInvoice(tx, p.tenantId, invId, {
                    status: "approved",
                    gstRateBps, tdsRateBps,
                    gstMinor: tax.gstMinor, tdsMinor: tax.tdsMinor, netPayableMinor: tax.netPayableMinor,
                    approvedBy: msg.actorId, approvedAt: new Date(),
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, inv.version);
                  // Finance AP: an approved consultant invoice is a payable (194J TDS credit).
                  await enqueue(tx, {
                    topic: EVENTS.consultantInvoiceApproved, eventType: EVENTS.consultantInvoiceApproved,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      invoiceId: invId, consultantId: inv.consultantId, invoiceNo: inv.invoiceNo,
                      grossMinor: inv.grossMinor.toString(), gstMinor: tax.gstMinor.toString(),
                      tdsSection: inv.tdsSection, tdsMinor: tax.tdsMinor.toString(),
                      netPayableMinor: tax.netPayableMinor.toString(), gstin: inv.gstin, sacCode: inv.sacCode,
                    },
                  });
            break;
          }
          case "consultant_invoice_routes__3": {
            await repo.updateInvoice(tx, p.tenantId, invId, {
                    status: "rejected",
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, inv.version);
            break;
          }
          case "consultant_invoice_routes__4": {
            await repo.updateInvoice(tx, p.tenantId, invId, {
                    status: "paid", paymentRef: body.paymentRef, paidAt: new Date(), updatedBy: msg.actorId,
                  }, inv.version);
                  await enqueue(tx, {
                    topic: EVENTS.consultantInvoicePaid, eventType: EVENTS.consultantInvoicePaid,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      invoiceId: invId, consultantId: inv.consultantId, invoiceNo: inv.invoiceNo,
                      netPayableMinor: inv.netPayableMinor.toString(), paymentRef: body.paymentRef,
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
