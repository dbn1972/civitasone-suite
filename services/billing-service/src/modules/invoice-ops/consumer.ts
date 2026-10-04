/**
 * invoice-ops consumers: the ONLY code that writes Postgres for offline payments, billing settings and
 * reminders. Every handler is idempotent (markProcessed), tenant-scoped (RLS + explicit tenant_id), takes
 * the invoice row lock where money or rate limits are involved, and ends with an audit event.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { buildNotificationPayload } from "@civitasone/events";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { EVENTS } from "../../topics.js";
import { billingInvoices } from "../invoices/schema.js";
import { billingPayments } from "../payments/schema.js";
import {
  billingInvoiceReminders, billingOfflinePayments, billingSettingRequests, billingSettings, type OfflinePaymentRow,
} from "./schema.js";
import { MANUAL_REMINDER_WINDOW_MS, SCHEDULED_REMINDER_WINDOW_MS, amountProblem, formatPaise, isSettleable } from "./domain.js";
import { OPS_COMMANDS } from "./topics.js";
import type { Recipient } from "./identity-client.js";

const AUDIT_TOPIC = "audit.event.record";
const NOTIFY_TOPIC = "notification.send";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Msg<P> = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: P };
type Ctx = { tenantId: string; actorId: string; correlationId: string };

async function audit(tx: Tx, c: Ctx, action: string, resourceType: string, resourceId: string, outcome: "success" | "denied", extra: Record<string, unknown> = {}): Promise<void> {
  await enqueue(tx as never, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId,
    payload: { service: "billing", action, resourceType, resourceId, outcome, ...(outcome === "denied" ? { severity: "high" } : {}), ...extra },
  });
}

/** The invoice row, locked for the rest of the transaction (serialises with webhook payments and other decisions). */
async function lockInvoice(tx: Tx, tenantId: string, invoiceId: string) {
  const rows = await tx.select().from(billingInvoices)
    .where(and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.tenantId, tenantId)))
    .for("update");
  return rows[0];
}

async function makerCheckerEnabled(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.select().from(billingSettings).where(eq(billingSettings.tenantId, tenantId));
  return rows[0]?.offlineMakerChecker ?? true;
}

/**
 * Settle the invoice for an approved offline payment. The caller holds the invoice lock; the guarded
 * UPDATE still re-checks status and the exact outstanding amount, so a webhook-paid, cancelled or
 * partially-paid-since invoice is never altered. Returns false when the guard refuses.
 */
async function settle(tx: Tx, c: Ctx, req: OfflinePaymentRow): Promise<boolean> {
  const updated = await tx.update(billingInvoices)
    .set({ paidMinor: sql`${billingInvoices.totalMinor}`, status: "paid", paidAt: new Date(), updatedBy: c.actorId, updatedAt: new Date(), version: sql`${billingInvoices.version} + 1` })
    .where(and(
      eq(billingInvoices.id, req.invoiceId),
      eq(billingInvoices.tenantId, c.tenantId),
      sql`${billingInvoices.status} IN ('issued','partially_paid','overdue')`,
      sql`${billingInvoices.totalMinor} - ${billingInvoices.paidMinor} = ${req.amountMinor}`,
    ))
    .returning({ total: billingInvoices.totalMinor });
  if (updated.length !== 1) return false;
  const paymentId = randomUUID();
  await tx.insert(billingPayments).values({
    id: paymentId, tenantId: c.tenantId, invoiceId: req.invoiceId, amountMinor: req.amountMinor,
    method: `offline_${req.mode}`, status: "completed",
    receiptNo: `RCPT-OFF-${new Date().getUTCFullYear()}-${req.id.slice(0, 8).toUpperCase()}`,
    reference: req.reference, receivedAt: new Date(`${req.paidOn}T00:00:00+05:30`),
    createdBy: c.actorId, updatedBy: c.actorId,
  });
  await tx.update(billingOfflinePayments).set({ paymentId }).where(eq(billingOfflinePayments.id, req.id));
  await enqueue(tx as never, {
    topic: EVENTS.paymentReceived, eventType: EVENTS.paymentReceived, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId,
    payload: { paymentId, invoiceId: req.invoiceId, amountMinor: req.amountMinor.toString(), mode: req.mode },
  });
  await enqueue(tx as never, {
    topic: EVENTS.invoicePaid, eventType: EVENTS.invoicePaid, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId,
    payload: { invoiceId: req.invoiceId, totalMinor: updated[0]!.total.toString() },
  });
  return true;
}

export function registerInvoiceOpsConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // ── offline payment: request ───────────────────────────────────────────────────────────
  queue.subscribe<{ requestId: string; invoiceId: string; mode: string; reference: string; referenceNorm: string; paidOn: string; amountMinor: string; reason: string }>(
    OPS_COMMANDS.offlineRequest,
    async (msg: Msg<{ requestId: string; invoiceId: string; mode: string; reference: string; referenceNorm: string; paidOn: string; amountMinor: string; reason: string }>) => {
      const c: Ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
      const p = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inv = await lockInvoice(tx, c.tenantId, p.invoiceId);
        const amount = BigInt(p.amountMinor);
        // A refused request is RECORDED as a rejected row (not a silent 202), so the invoice screen shows what happened.
        const refuse = async (code: string) => {
          await tx.insert(billingOfflinePayments).values({
            id: p.requestId, tenantId: c.tenantId, invoiceId: p.invoiceId, mode: p.mode, reference: p.reference, referenceNorm: p.referenceNorm,
            paidOn: p.paidOn, amountMinor: amount, reason: p.reason, requestedBy: c.actorId, status: "rejected", decisionReason: code, decidedAt: new Date(),
          }).onConflictDoNothing();
          await audit(tx, c, "offline_payment.request", "invoice", p.invoiceId, "denied", { reason: code, mode: p.mode });
        };
        if (!inv || !isSettleable(inv.status) || amountProblem(inv.totalMinor, inv.paidMinor, amount)) {
          await refuse("The invoice changed before the request was processed: it is no longer unpaid for the requested amount.");
          return;
        }
        const inserted = await tx.insert(billingOfflinePayments).values({
          id: p.requestId, tenantId: c.tenantId, invoiceId: p.invoiceId, mode: p.mode, reference: p.reference,
          referenceNorm: p.referenceNorm, paidOn: p.paidOn, amountMinor: amount, reason: p.reason, requestedBy: c.actorId,
        }).onConflictDoNothing().returning();
        const req = inserted[0];
        if (!req) {
          // duplicate UTR for this tenant, or a request is already pending for the invoice (lost a race)
          await refuse("Refused: this UTR / instrument number is already recorded, or another request for this invoice is already pending.");
          return;
        }
        await audit(tx, c, "offline_payment.request", "offline_payment", req.id, "success", { invoiceId: p.invoiceId, mode: p.mode, reference: p.referenceNorm, paidOn: p.paidOn, amountMinor: p.amountMinor, reason: p.reason });
        if (!(await makerCheckerEnabled(tx, c.tenantId))) {
          // The tenant switched maker-checker off (itself an approved request): apply immediately, still audited.
          const decided = await tx.update(billingOfflinePayments)
            .set({ status: "approved", decidedBy: c.actorId, decidedAt: new Date(), decisionReason: "maker-checker disabled for this tenant", autoApproved: true, updatedAt: new Date(), version: sql`${billingOfflinePayments.version} + 1` })
            .where(and(eq(billingOfflinePayments.id, req.id), eq(billingOfflinePayments.status, "pending")))
            .returning();
          if (decided[0] && (await settle(tx, c, decided[0]))) {
            await audit(tx, c, "offline_payment.approve", "offline_payment", req.id, "success", { auto: true, invoiceId: p.invoiceId });
          } else {
            throw new Error("OFFLINE_PAYMENT_SETTLE_FAILED");
          }
        }
      });
      await cache.invalidateResource(c.tenantId, "invoices");
    },
  );

  // ── offline payment: approve / reject (a DIFFERENT administrator) ─────────────────────
  queue.subscribe<{ requestId: string; invoiceId: string; approve: boolean; reason?: string }>(
    OPS_COMMANDS.offlineDecide,
    async (msg: Msg<{ requestId: string; invoiceId: string; approve: boolean; reason?: string }>) => {
      const c: Ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
      const p = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inv = await lockInvoice(tx, c.tenantId, p.invoiceId);
        const found = await tx.select().from(billingOfflinePayments)
          .where(and(eq(billingOfflinePayments.id, p.requestId), eq(billingOfflinePayments.tenantId, c.tenantId), eq(billingOfflinePayments.invoiceId, p.invoiceId)));
        const req = found[0];
        if (!req || req.status !== "pending") {
          await audit(tx, c, "offline_payment.decide", "offline_payment", p.requestId, "denied", { reason: "NOT_PENDING" });
          return;
        }
        if (req.requestedBy === c.actorId) {
          await audit(tx, c, "offline_payment.decide", "offline_payment", p.requestId, "denied", { reason: "MAKER_CHECKER_VIOLATION" });
          return;
        }
        const finish = (status: "approved" | "rejected", why: string | undefined) => tx.update(billingOfflinePayments)
          .set({ status, decidedBy: c.actorId, decidedAt: new Date(), decisionReason: why ?? null, updatedAt: new Date(), version: sql`${billingOfflinePayments.version} + 1` })
          .where(and(eq(billingOfflinePayments.id, req.id), eq(billingOfflinePayments.status, "pending"), sql`${billingOfflinePayments.requestedBy} <> ${c.actorId}`))
          .returning();
        if (!p.approve) {
          const done = await finish("rejected", p.reason);
          if (done.length === 1) await audit(tx, c, "offline_payment.reject", "offline_payment", req.id, "success", { invoiceId: p.invoiceId, reason: p.reason });
          return;
        }
        // Approve: the invoice must STILL be unpaid for exactly the requested amount (a webhook, a cancel or a
        // partial payment may have landed since); otherwise the request is closed as rejected and nothing changes.
        if (!inv || !isSettleable(inv.status) || amountProblem(inv.totalMinor, inv.paidMinor, req.amountMinor)) {
          const done = await finish("rejected", "invoice changed since the request: it is no longer unpaid for the requested amount");
          if (done.length === 1) await audit(tx, c, "offline_payment.approve", "offline_payment", req.id, "denied", { reason: "INVOICE_CHANGED", invoiceId: p.invoiceId });
          return;
        }
        const done = await finish("approved", p.reason);
        if (done.length !== 1) {
          await audit(tx, c, "offline_payment.approve", "offline_payment", req.id, "denied", { reason: "NOT_PENDING_OR_SAME_ACTOR" });
          return;
        }
        if (!(await settle(tx, c, done[0]!))) throw new Error("OFFLINE_PAYMENT_SETTLE_FAILED"); // rolls the approval back
        await audit(tx, c, "offline_payment.approve", "offline_payment", req.id, "success", { invoiceId: p.invoiceId, amountMinor: req.amountMinor.toString(), reference: req.referenceNorm });
      });
      await cache.invalidateResource(c.tenantId, "invoices");
    },
  );

  // ── maker-checker setting: ON is immediate, OFF is a request ──────────────────────────
  queue.subscribe<{ requestId: string; enabled: boolean; reason: string }>(
    OPS_COMMANDS.makerCheckerSet,
    async (msg: Msg<{ requestId: string; enabled: boolean; reason: string }>) => {
      const c: Ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
      const p = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        if (p.enabled) {
          await upsertSettings(tx, c, { offlineMakerChecker: true });
          await tx.update(billingSettingRequests)
            .set({ status: "rejected", decidedBy: c.actorId, decidedAt: new Date(), decisionReason: "superseded: maker-checker switched back on" })
            .where(and(eq(billingSettingRequests.tenantId, c.tenantId), eq(billingSettingRequests.status, "pending")));
          await audit(tx, c, "settings.maker_checker.enable", "billing_settings", c.tenantId, "success", { reason: p.reason });
          return;
        }
        const inserted = await tx.insert(billingSettingRequests).values({
          id: p.requestId, tenantId: c.tenantId, settingKey: "offline_maker_checker", requestedValue: false, reason: p.reason, requestedBy: c.actorId,
        }).onConflictDoNothing().returning({ id: billingSettingRequests.id });
        if (inserted.length !== 1) {
          // lost the race to another pending request: keep a visible refused row
          await tx.insert(billingSettingRequests).values({
            id: p.requestId, tenantId: c.tenantId, settingKey: "offline_maker_checker", requestedValue: false, reason: p.reason, requestedBy: c.actorId,
            status: "rejected", decisionReason: "Refused: another request to switch it off is already pending.", decidedAt: new Date(),
          }).onConflictDoNothing();
        }
        await audit(tx, c, "settings.maker_checker.disable_request", "billing_setting_request", p.requestId, inserted.length === 1 ? "success" : "denied",
          { reason: p.reason, ...(inserted.length === 1 ? {} : { denial: "A request to switch it off is already pending" }) });
      });
    },
  );

  queue.subscribe<{ requestId: string; approve: boolean; reason?: string }>(
    OPS_COMMANDS.makerCheckerDecide,
    async (msg: Msg<{ requestId: string; approve: boolean; reason?: string }>) => {
      const c: Ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
      const p = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Conditional: still pending AND decided by someone other than the requester.
        const done = await tx.update(billingSettingRequests)
          .set({ status: p.approve ? "approved" : "rejected", decidedBy: c.actorId, decidedAt: new Date(), decisionReason: p.reason ?? null, version: sql`${billingSettingRequests.version} + 1` })
          .where(and(eq(billingSettingRequests.id, p.requestId), eq(billingSettingRequests.tenantId, c.tenantId), eq(billingSettingRequests.status, "pending"), sql`${billingSettingRequests.requestedBy} <> ${c.actorId}`))
          .returning();
        if (done.length !== 1) {
          await audit(tx, c, "settings.maker_checker.decide", "billing_setting_request", p.requestId, "denied", { reason: "NOT_PENDING_OR_SAME_ACTOR" });
          return;
        }
        if (p.approve) await upsertSettings(tx, c, { offlineMakerChecker: done[0]!.requestedValue });
        await audit(tx, c, p.approve ? "settings.maker_checker.disable_approve" : "settings.maker_checker.disable_reject", "billing_setting_request", p.requestId, "success", { reason: p.reason });
      });
    },
  );

  queue.subscribe<{ days: number | null }>(
    OPS_COMMANDS.reminderDays,
    async (msg: Msg<{ days: number | null }>) => {
      const c: Ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await upsertSettings(tx, c, { reminderOverdueDays: msg.payload.days });
        await audit(tx, c, "settings.reminder_days", "billing_settings", c.tenantId, "success", { days: msg.payload.days });
      });
    },
  );

  // ── reminders ──────────────────────────────────────────────────────────────────────────
  queue.subscribe<{ reminderId: string; invoiceId: string; trigger: "manual" | "scheduled"; recipients: Recipient[] }>(
    OPS_COMMANDS.reminderSend,
    async (msg: Msg<{ reminderId: string; invoiceId: string; trigger: "manual" | "scheduled"; recipients: Recipient[] }>) => {
      const c: Ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
      const p = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inv = await lockInvoice(tx, c.tenantId, p.invoiceId);
        if (!inv || !isSettleable(inv.status) || inv.totalMinor - inv.paidMinor <= 0n || p.recipients.length === 0) {
          await audit(tx, c, "invoice.reminder", "invoice", p.invoiceId, "denied", { reason: "NOTHING_DUE_OR_NO_RECIPIENTS", trigger: p.trigger });
          return;
        }
        // Rate limit, enforced under the invoice lock so two parallel requests cannot both send.
        const windowMs = p.trigger === "manual" ? MANUAL_REMINDER_WINDOW_MS : SCHEDULED_REMINDER_WINDOW_MS;
        const recent = await tx.select({ id: billingInvoiceReminders.id }).from(billingInvoiceReminders)
          .where(and(eq(billingInvoiceReminders.invoiceId, p.invoiceId), eq(billingInvoiceReminders.tenantId, c.tenantId), gt(billingInvoiceReminders.sentAt, new Date(Date.now() - windowMs))))
          .limit(1);
        if (recent.length > 0) {
          await audit(tx, c, "invoice.reminder", "invoice", p.invoiceId, "denied", { reason: "RATE_LIMITED", trigger: p.trigger });
          return;
        }
        await tx.insert(billingInvoiceReminders).values({
          id: p.reminderId, tenantId: c.tenantId, invoiceId: p.invoiceId, triggerKind: p.trigger,
          requestedBy: p.trigger === "manual" ? c.actorId : null, recipientCount: p.recipients.length,
        });
        const outstanding = formatPaise(inv.totalMinor - inv.paidMinor);
        for (const r of p.recipients) {
          const payload = buildNotificationPayload({
            eventType: "billing.invoice.reminder", recipient: r.email, recipientId: r.id, channel: "email",
            variables: { name: r.name, period: inv.periodMonth, outstanding },
          });
          await enqueue(tx as never, { topic: NOTIFY_TOPIC, eventType: NOTIFY_TOPIC, tenantId: c.tenantId, actorId: c.actorId, correlationId: c.correlationId, payload });
        }
        await audit(tx, c, "invoice.reminder", "invoice", p.invoiceId, "success", { trigger: p.trigger, recipientCount: p.recipients.length });
      });
    },
  );
}

async function upsertSettings(tx: Tx, c: Ctx, patch: { offlineMakerChecker?: boolean; reminderOverdueDays?: number | null }): Promise<void> {
  await tx.insert(billingSettings).values({ tenantId: c.tenantId, updatedBy: c.actorId, ...patch })
    .onConflictDoUpdate({ target: billingSettings.tenantId, set: { ...patch, updatedBy: c.actorId, updatedAt: new Date(), version: sql`${billingSettings.version} + 1` } });
}
