import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hrmsEmployees } from "../employee/schema.js";
import { computeInvoiceTax } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-consultant-invoice" });

/** 194J FY threshold: ₹30,000 => 3,000,000 paise. Mirrors routes.ts. */
const TDS_194J_THRESHOLD_MINOR = 3_000_000n;

/** Indian financial year window (Apr 1 – Mar 31) for a YYYY-MM-DD date. Mirrors routes.ts. */
function financialYearWindow(isoDate: string): { from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7)); // 1-based
  const startYear = month >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/**
 * HR-A deep-verify fix (F3 batch 5). The F3 code-gen lifted each route's WRITE
 * into the switch below but dropped the "fetch the invoice + compute the tax"
 * preamble that sat above it in the original handler. Every case referenced
 * locals (`invId`, `inv`, `emp`, `fy`, `tax`, `gstRateBps`, `tdsRateBps`,
 * `TDS_194J_THRESHOLD_MINOR`) declared nowhere in this file, so each threw a
 * ReferenceError the instant it ran. The route has already answered 200/201 by
 * then — the write is fire-and-forget through the queue — so every invoice
 * submission, verify, approve, reject and mark-paid was a FAKE SUCCESS: the
 * caller was told it worked while this consumer crashed before touching the
 * database. On the approve path that also meant no GST and no Section-194J TDS
 * was ever withheld.
 *
 * The preambles are restored below, mirroring routes.ts. Checks the route
 * already performed (state-machine transitions, two-person control) are NOT
 * repeated: the HTTP layer rejected those before publishing. `body` is the RAW
 * pre-Zod body forwarded through the queue, so each `.default(...)` is applied
 * explicitly. Entity ids come from `params` (what `idParam`/`invParam` parsed);
 * routes.ts publishes a fresh randomUUID as the message id, so the top-level
 * `id` identifies the MESSAGE and is only usable as the PK of a row created here.
 */
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
            // Restored: the consultant from the route path, the employee row
            // (mustEmployee — for the GSTIN / SAC-code fallbacks) and the new
            // invoice's id.
            const consultantId = (params.id as string) || id;
            const empRows = await tx.select().from(hrmsEmployees)
              .where(and(eq(hrmsEmployees.id, consultantId), eq(hrmsEmployees.tenantId, p.tenantId))).limit(1);
            const emp = empRows[0];
            if (!emp) throw new HttpError(404, "NOT_FOUND", "consultant (employee) not found");
            const invId = id;
            await repo.insertInvoice(tx, {
                    id: invId, tenantId: p.tenantId, consultantId,
                    invoiceNo: body.invoiceNo, invoiceDate: body.invoiceDate,
                    ...(body.periodFrom ? { periodFrom: body.periodFrom } : {}),
                    ...(body.periodTo ? { periodTo: body.periodTo } : {}),
                    ...(body.description ? { description: body.description } : {}),
                    grossMinor: BigInt(body.grossMinor),
                    gstApplicable: body.gstApplicable ?? false, gstRateBps: body.gstRateBps ?? 0,
                    tdsRateBps: body.tdsRateBps ?? 1000,
                    gstin: body.gstin ?? (emp.gstin as string | undefined) ?? null,
                    sacCode: body.sacCode ?? (emp.sacCode as string | undefined) ?? null,
                    status: "submitted",
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "consultant_invoice_routes__1": {
            // Restored: `inv` — read for its optimistic-lock version.
            const invId = (params.invId as string) || id;
            const inv = await repo.findInvoice(p.tenantId, invId);
            if (!inv) throw new HttpError(404, "NOT_FOUND", "consultant invoice not found");
            await repo.updateInvoice(tx, p.tenantId, invId, {
                    status: "verified", verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
                  }, inv.version);
            break;
          }
          case "consultant_invoice_routes__2": {
            // Restored: `inv`, the FY window for the 194J aggregate, and the
            // statutory rates. The checker (a finance role) may override the
            // submitted rates; omitted => keep what was submitted. This is the
            // step that actually withholds GST + 194J TDS.
            const invId = (params.invId as string) || id;
            const inv = await repo.findInvoice(p.tenantId, invId);
            if (!inv) throw new HttpError(404, "NOT_FOUND", "consultant invoice not found");
            const gstRateBps = body.gstRateBps ?? inv.gstRateBps;
            const tdsRateBps = body.tdsRateBps ?? inv.tdsRateBps;
            const fy = financialYearWindow(inv.invoiceDate as unknown as string);
            // Serialize approvals for the same consultant so two concurrent approvals
                  // can't each read a pre-crossing YTD total and both under-withhold 194J.
                  await repo.lockConsultantForInvoicing(tx, p.tenantId, inv.consultantId);
                  const ytd = await repo.ytdApprovedGrossTx(tx, p.tenantId, inv.consultantId, fy.from, fy.to, inv.id);
                  const tax = computeInvoiceTax({
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
            // Restored: `inv` — read for its optimistic-lock version.
            const invId = (params.invId as string) || id;
            const inv = await repo.findInvoice(p.tenantId, invId);
            if (!inv) throw new HttpError(404, "NOT_FOUND", "consultant invoice not found");
            await repo.updateInvoice(tx, p.tenantId, invId, {
                    status: "rejected",
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, inv.version);
            break;
          }
          case "consultant_invoice_routes__4": {
            // Restored: `inv` — read for its version AND for the paid-event
            // payload (invoice no + the net payable settled at approval).
            const invId = (params.invId as string) || id;
            const inv = await repo.findInvoice(p.tenantId, invId);
            if (!inv) throw new HttpError(404, "NOT_FOUND", "consultant invoice not found");
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
