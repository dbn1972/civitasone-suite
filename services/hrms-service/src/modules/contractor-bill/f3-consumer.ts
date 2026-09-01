import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { computeContractTax, type ContractorKind } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-contractor-bill" });

/** Section 194C thresholds. Mirror routes.ts. */
const TDS_194C_SINGLE_MINOR = 3_000_000n;   // ₹30,000
const TDS_194C_ANNUAL_MINOR = 10_000_000n;  // ₹1,00,000

/** Indian financial year window (Apr 1 – Mar 31) for a YYYY-MM-DD date. Mirrors routes.ts. */
function financialYearWindow(isoDate: string): { from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7)); // 1-based
  const startYear = month >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/**
 * HR-A deep-verify fix (F3 batch 5). The F3 code-gen lifted each route's WRITE
 * into the switch below but dropped the "fetch the contractor/bill + compute the
 * tax" preamble that sat above it in the original handler. Every case referenced
 * locals (`c`, `patch`, `billId`, `bill`, `contractor`, `fy`, `tax`,
 * `gstRateBps`, `TDS_194C_SINGLE_MINOR`, `TDS_194C_ANNUAL_MINOR`) declared
 * nowhere in this file, so each threw a ReferenceError the instant it ran. The
 * route has already answered 200/201 by then — the write is fire-and-forget
 * through the queue — so every contractor registration, edit, bill submission,
 * verify, approve, reject and mark-paid was a FAKE SUCCESS: the caller was told
 * it worked while this consumer crashed before touching the database. On the
 * approve path that also meant no GST and no Section-194C TDS was ever withheld.
 *
 * The preambles are restored below, mirroring routes.ts. Checks the route
 * already performed (blacklist, state-machine transitions, two-person control,
 * the CLRA licence guard) are NOT repeated: the HTTP layer rejected those before
 * publishing. `body` is the RAW pre-Zod body forwarded through the queue, so each
 * `.default(...)` is applied explicitly. Entity ids come from `params` (what
 * `idParam`/`billParam` parsed); routes.ts publishes a fresh randomUUID as the
 * message id, so the top-level `id` identifies the MESSAGE and is only usable as
 * the PK of a row created here.
 */
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
                  id, tenantId: p.tenantId, name: body.name, contractorKind: body.contractorKind ?? "other",
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
            // Restored: `c` (the current contractor, for its optimistic-lock
            // version) and `patch` (built field-by-field from the body).
            const contractorId = (params.id as string) || id;
            const c = await repo.findContractor(p.tenantId, contractorId);
            if (!c) throw new HttpError(404, "NOT_FOUND", "contractor not found");
            const patch = {
              updatedBy: msg.actorId,
              ...(body.clraLicenseNo !== undefined ? { clraLicenseNo: body.clraLicenseNo as string } : {}),
              ...(body.clraLicenseValidTill !== undefined ? { clraLicenseValidTill: body.clraLicenseValidTill as string } : {}),
              ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail as string } : {}),
              ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone as string } : {}),
              ...(body.status !== undefined ? { status: body.status as string } : {}),
            };
            await repo.updateContractor(tx, p.tenantId, contractorId, patch, c.version);
            break;
          }
          case "contractor_bill_routes__2": {
            // Restored: `c` — the bill snapshots the contractor's GSTIN — and
            // the new bill's id.
            const contractorId = (params.id as string) || id;
            const c = await repo.findContractor(p.tenantId, contractorId);
            if (!c) throw new HttpError(404, "NOT_FOUND", "contractor not found");
            const billId = id;
            await repo.insertBill(tx, {
                    id: billId, tenantId: p.tenantId, contractorId,
                    billNo: body.billNo, billDate: body.billDate,
                    ...(body.periodFrom ? { periodFrom: body.periodFrom } : {}),
                    ...(body.periodTo ? { periodTo: body.periodTo } : {}),
                    ...(body.description ? { description: body.description } : {}),
                    workersCount: body.workersCount ?? 0, wagesDisbursedVerified: body.wagesDisbursedVerified ?? false,
                    grossMinor: BigInt(body.grossMinor),
                    gstApplicable: body.gstApplicable ?? false, gstRateBps: body.gstRateBps ?? 0,
                    gstin: (c.gstin as string | undefined) ?? null,
                    status: "submitted",
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "contractor_bill_routes__3": {
            // Restored: `bill` — read for its optimistic-lock version.
            const billId = (params.billId as string) || id;
            const bill = await repo.findBill(p.tenantId, billId);
            if (!bill) throw new HttpError(404, "NOT_FOUND", "contractor bill not found");
            await repo.updateBill(tx, p.tenantId, billId, {
                  status: "verified", verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
                }, bill.version);
            break;
          }
          case "contractor_bill_routes__4": {
            // Restored: `bill`, its `contractor` (the 194C rate depends on the
            // contractor kind — 1% individual/HUF, 2% otherwise), the FY window
            // for the 194C annual aggregate, and the GST rate (the checker may
            // override the submitted one). This is the step that actually
            // withholds GST + Section-194C TDS.
            const billId = (params.billId as string) || id;
            const bill = await repo.findBill(p.tenantId, billId);
            if (!bill) throw new HttpError(404, "NOT_FOUND", "contractor bill not found");
            const contractor = await repo.findContractor(p.tenantId, bill.contractorId);
            if (!contractor) throw new HttpError(404, "NOT_FOUND", "contractor not found");
            const gstRateBps = body.gstRateBps ?? bill.gstRateBps;
            const fy = financialYearWindow(bill.billDate as unknown as string);
            await repo.lockContractorForBilling(tx, p.tenantId, bill.contractorId);
                  const ytd = await repo.ytdApprovedGrossTx(tx, p.tenantId, bill.contractorId, fy.from, fy.to, bill.id);
                  const tax = computeContractTax({
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
            // Restored: `bill` — read for its optimistic-lock version.
            const billId = (params.billId as string) || id;
            const bill = await repo.findBill(p.tenantId, billId);
            if (!bill) throw new HttpError(404, "NOT_FOUND", "contractor bill not found");
            await repo.updateBill(tx, p.tenantId, billId, {
                  status: "rejected",
                  ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                  updatedBy: msg.actorId,
                }, bill.version);
            break;
          }
          case "contractor_bill_routes__6": {
            // Restored: `bill` — read for its version AND for the paid-event
            // payload (bill no + the net payable settled at approval).
            const billId = (params.billId as string) || id;
            const bill = await repo.findBill(p.tenantId, billId);
            if (!bill) throw new HttpError(404, "NOT_FOUND", "contractor bill not found");
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
