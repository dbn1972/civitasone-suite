import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as catalogueRepo from "../catalogue/repo.js";
import {
  enqueuePackNotifications,
  formatAmountMajor,
} from "../catalogue/notification-bindings.js";
import { computeFee, buildReceiptNo, isGatewayConfigured, isRefundable } from "./domain.js";
import type { FeeScheduleRow } from "./schema.js";

async function resolveHoaForSchedule(
  tx: repo.Writer,
  tenantId: string,
  scheduleId: string | null | undefined,
): Promise<{ hoaCode: string | null; serviceKey: string | null; serviceId: string | null }> {
  if (!scheduleId) return { hoaCode: null, serviceKey: null, serviceId: null };
  const sched = await repo.findScheduleByIdTx(tx, scheduleId, tenantId);
  if (!sched) return { hoaCode: null, serviceKey: null, serviceId: null };
  const def = await catalogueRepo.findPublishedByServiceIdTx(tx, tenantId, sched.serviceId);
  return {
    hoaCode: def?.hoaCode ?? null,
    serviceKey: def?.serviceKey ?? null,
    serviceId: sched.serviceId,
  };
}

async function emitReceiptIssued(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  payload: {
    id: string;
    applicationId: string;
    receiptNo: string;
    amountMinor: string;
    currency: string;
    hoaCode?: string | null;
    serviceKey?: string | null;
    captureMode?: string;
  },
): Promise<void> {
  await enqueue(tx, {
    topic: EVENTS.receiptIssued, eventType: EVENTS.receiptIssued,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      id: payload.id,
      applicationId: payload.applicationId,
      receiptNo: payload.receiptNo,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      ...(payload.hoaCode ? { hoaCode: payload.hoaCode } : {}),
      ...(payload.serviceKey ? { serviceKey: payload.serviceKey } : {}),
      ...(payload.captureMode ? { captureMode: payload.captureMode } : {}),
    },
  });
}

const log = pino({ name: "citizen.fee-payment.consumer" });
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}

async function resolveSchedule(
  tx: repo.Writer, tenantId: string, scheduleId?: string, serviceId?: string,
): Promise<FeeScheduleRow | null> {
  let sched = scheduleId ? await repo.findScheduleByIdTx(tx, scheduleId, tenantId) : null;
  if (!sched && serviceId) sched = await repo.findActiveScheduleForService(tx, tenantId, serviceId);
  return sched;
}

export function registerFeePaymentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.feeScheduleCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; serviceId: string; name: string;
      baseAmount: number; currency: string; exemptions: unknown;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSchedule(tx, {
        id: p.id, tenantId: p.tenantId, serviceId: p.serviceId, name: p.name,
        baseAmount: p.baseAmount, currency: p.currency, exemptions: p.exemptions as never,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "fee_schedule_create", "fee_schedule", p.id);
    });
    log.info({ id: p.id }, "fee schedule created");
  });

  queue.subscribe(COMMANDS.paymentIntentCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string; scheduleId?: string; serviceId?: string;
      citizenId?: string; subject: Record<string, unknown>;
    };
    const configured = isGatewayConfigured();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sched = await resolveSchedule(tx, p.tenantId, p.scheduleId, p.serviceId);
      if (!sched) return;
      const fee = computeFee(Number(sched.baseAmount), sched.exemptions, p.subject ?? {});
      const gatewayRef = configured ? `pi_${p.id}` : null;
      await repo.insertPayment(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId, scheduleId: sched.id,
        citizenId: p.citizenId ?? null, amount: fee.amount, currency: sched.currency,
        exemptionApplied: fee.exemptionApplied, method: "online", status: "pending",
        gatewayRef, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: COMMANDS.paymentRequested, eventType: COMMANDS.paymentRequested,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: p.id, applicationId: p.applicationId, amount: fee.amount,
          currency: sched.currency, gatewayConfigured: configured,
        },
      });
      // FN-08: payment_due bindings (amount + pay_link merge fields)
      const serviceId = p.serviceId ?? sched.serviceId;
      const recipient = p.citizenId ?? p.applicationId;
      await enqueuePackNotifications(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        serviceId, lifecycleEvent: "payment_due",
        recipient, ...(p.citizenId != null ? { recipientId: p.citizenId } : {}),
        variables: {
          applicationId: p.applicationId,
          app_no: p.applicationId,
          amount: formatAmountMajor(fee.amount, sched.currency),
          amount_paise: String(fee.amount),
          currency: sched.currency,
          pay_link: `/citizen/payments/${p.id}/pay`,
          payment_id: p.id,
        },
        eventType: "citizen.payment.due",
      });
      await audit(tx, msg, "payment_intent_create", "payment", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payment", p.id));
  });

  queue.subscribe(COMMANDS.paymentOfflineRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string; scheduleId?: string; serviceId?: string;
      citizenId?: string; subject: Record<string, unknown>; reference?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sched = await resolveSchedule(tx, p.tenantId, p.scheduleId, p.serviceId);
      if (!sched) return;
      const fee = computeFee(Number(sched.baseAmount), sched.exemptions, p.subject ?? {});
      const now = new Date();
      const year = now.getUTCFullYear();
      const seq = await repo.nextReceiptSeq(tx, p.tenantId, year);
      const receiptNo = buildReceiptNo(year, seq);
      await repo.insertPayment(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId, scheduleId: sched.id,
        citizenId: p.citizenId ?? null, amount: fee.amount, currency: sched.currency,
        exemptionApplied: fee.exemptionApplied, method: "offline", status: "offline_recorded",
        gatewayRef: p.reference ?? null, receiptNo, receiptIssuedAt: now,
        reconciliationStatus: "reconciled", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      let hoaCode: string | null = null;
      let serviceKey: string | null = null;
      if (p.serviceId) {
        const def = await catalogueRepo.findPublishedByServiceIdTx(tx, p.tenantId, p.serviceId);
        if (def) {
          hoaCode = def.hoaCode ?? null;
          serviceKey = def.serviceKey;
        }
      }
      if (!hoaCode) {
        const fromSched = await resolveHoaForSchedule(tx, p.tenantId, sched.id);
        hoaCode = fromSched.hoaCode;
        serviceKey = serviceKey ?? fromSched.serviceKey;
      }
      await emitReceiptIssued(tx, msg, {
        id: p.id,
        applicationId: p.applicationId,
        receiptNo,
        amountMinor: BigInt(fee.amount).toString(),
        currency: sched.currency,
        hoaCode,
        serviceKey,
        captureMode: "offline",
      });
      // FN-08: payment_received bindings
      const serviceId = p.serviceId ?? sched.serviceId;
      const recipient = p.citizenId ?? p.applicationId;
      await enqueuePackNotifications(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        serviceId, lifecycleEvent: "payment_received",
        recipient, ...(p.citizenId != null ? { recipientId: p.citizenId } : {}),
        variables: {
          applicationId: p.applicationId,
          app_no: p.applicationId,
          amount: formatAmountMajor(fee.amount, sched.currency),
          amount_paise: String(fee.amount),
          currency: sched.currency,
          receipt_no: receiptNo,
          payment_id: p.id,
        },
        eventType: "citizen.payment.received",
      });
      await audit(tx, msg, "payment_offline_record", "payment", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payment", p.id));
  });

  /**
   * FN-14 — confirm pending online intent → receipt + citizen.receipt.issued (GL).
   * Sandbox mode is an explicitly labelled Test capture (never claims live gateway).
   */
  queue.subscribe(COMMANDS.paymentConfirm, async (msg) => {
    const p = msg.payload as {
      paymentId: string; tenantId: string; mode: "gateway" | "sandbox"; gatewayRef?: string | null;
    };
    let confirmed = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pay = await repo.findPaymentByIdTx(tx, p.paymentId, msg.tenantId);
      if (!pay || pay.status !== "pending") return;

      const now = new Date();
      const year = now.getUTCFullYear();
      const seq = await repo.nextReceiptSeq(tx, msg.tenantId, year);
      const receiptNo = buildReceiptNo(year, seq);
      const gatewayRef = (p.gatewayRef?.trim() || pay.gatewayRef || (p.mode === "sandbox" ? `sandbox_${p.paymentId}` : null));
      const reconciliationStatus = p.mode === "sandbox" ? "sandbox" : "reconciled";

      await repo.updatePayment(tx, p.paymentId, msg.tenantId, {
        status: "paid",
        gatewayRef,
        receiptNo,
        receiptIssuedAt: now,
        reconciliationStatus,
        updatedBy: msg.actorId,
      });

      const hoa = await resolveHoaForSchedule(tx, msg.tenantId, pay.scheduleId);
      await emitReceiptIssued(tx, msg, {
        id: p.paymentId,
        applicationId: pay.applicationId,
        receiptNo,
        amountMinor: BigInt(pay.amount).toString(),
        currency: pay.currency,
        hoaCode: hoa.hoaCode,
        serviceKey: hoa.serviceKey,
        captureMode: p.mode,
      });
      await audit(tx, msg, p.mode === "sandbox" ? "payment_sandbox_confirm" : "payment_confirm", "payment", p.paymentId);
      confirmed = true;
    });
    if (confirmed) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "payment", p.paymentId));
      log.info({ paymentId: p.paymentId, mode: p.mode }, "online payment confirmed; receipt issued for GL");
    }
  });

  queue.subscribe(COMMANDS.refundRequest, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; paymentId: string; amount: number; reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pay = await repo.findPaymentByIdTx(tx, p.paymentId, p.tenantId);
      if (!pay || !isRefundable(pay.status)) return;
      if (p.amount > Number(pay.amount)) return;
      const existing = await repo.listRefundsByPayment(p.tenantId, p.paymentId);
      if (existing.some((r) => r.status === "requested")) return;
      await repo.insertRefund(tx, {
        id: p.id, tenantId: p.tenantId, paymentId: p.paymentId, amount: p.amount,
        reason: p.reason ?? null, status: "requested",
        requestedBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "refund_request", "refund", p.id);
    });
  });

  queue.subscribe(COMMANDS.refundDecide, async (msg) => {
    const p = msg.payload as { refundId: string; tenantId: string; decision: "approve" | "reject" };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const refund = await repo.findRefundByIdTx(tx, p.refundId, msg.tenantId);
      if (!refund || refund.status !== "requested") return;
      if (refund.requestedBy === msg.actorId) return;
      const approved = p.decision === "approve";
      await repo.updateRefund(tx, p.refundId, msg.tenantId, {
        status: approved ? "approved" : "rejected",
        approvedBy: msg.actorId, decidedAt: new Date(), updatedBy: msg.actorId,
      });
      if (approved) {
        await repo.updatePayment(tx, refund.paymentId, msg.tenantId, {
          status: "refunded", updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, approved ? "refund_approve" : "refund_reject", "refund", p.refundId);
    });
  });
}
