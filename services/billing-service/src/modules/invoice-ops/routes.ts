/**
 * GAP-ADMIN-INVOICES-06: offline payments (maker-checker), billing settings and invoice reminders.
 * Reads: the register's roles (BILLING_ROLES). Every write: super_admin / platform_admin only.
 * Writes publish commands (202); the consumers do the database work.
 */
import type { FastifyInstance } from "fastify";
import { ZodError, type z } from "zod";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { billingInvoices } from "../invoices/schema.js";
import { billingInvoiceReminders, billingOfflinePayments, billingSettingRequests, billingSettings } from "./schema.js";
import * as commands from "./commands.js";
import { fetchTenantAdminRecipients } from "./identity-client.js";
import {
  MANUAL_REMINDER_WINDOW_MS, amountProblem, isSettleable, normaliseReference, paidOnProblem, referenceProblem, todayIst,
} from "./domain.js";
import { decisionBody, invoiceIdParam, makerCheckerBody, offlinePaymentBody, reminderDaysBody, requestParam, settingsRequestParam } from "./validators.js";

const READ_ROLES = ["billing_admin", "tenant_admin", "super_admin", "platform_admin"];
// Every write is PLATFORM staff only, like the existing invoice writes (requireSuperAdmin in invoices/routes.ts):
// billing_admin is a tenant-side module role, and two of them in one tenant must not be able to settle their own bill.
const OPS_ROLES = ["super_admin", "platform_admin"];

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, "VALIDATION_FAILED", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data;
}

async function loadInvoice(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(billingInvoices).where(and(eq(billingInvoices.id, id), eq(billingInvoices.tenantId, tenantId))).limit(1));
  const inv = rows[0];
  if (!inv) throw new HttpError(404, "NOT_FOUND", "invoice not found");
  return inv;
}

export async function invoiceOpsRoutes(app: FastifyInstance): Promise<void> {
  // ── offline payments ─────────────────────────────────────────────────────────────────
  app.post("/v1/billing/invoices/:id/offline-payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const { id } = parse(invoiceIdParam, req.params);
    const body = parse(offlinePaymentBody, req.body);
    const inv = await loadInvoice(ctx.tenantId, id);
    if (!isSettleable(inv.status)) {
      throw new HttpError(409, "INVOICE_NOT_PAYABLE", `an invoice that is ${inv.status} cannot take an offline payment (gateway-paid, cancelled, waived and draft invoices are never altered)`);
    }
    const referenceNorm = normaliseReference(body.reference);
    const refProblem = referenceProblem(body.mode, referenceNorm);
    if (refProblem) throw new HttpError(422, "VALIDATION_FAILED", `reference: ${refProblem}`);
    const invoiceDate = todayIst(inv.issuedAt ?? inv.createdAt);
    const dateProblem = paidOnProblem(body.paidOn, todayIst(), invoiceDate);
    if (dateProblem) throw new HttpError(422, "VALIDATION_FAILED", `paidOn: ${dateProblem}`);
    const amtProblem = amountProblem(inv.totalMinor, inv.paidMinor, body.amountMinor);
    if (amtProblem) throw new HttpError(422, "VALIDATION_FAILED", `amountMinor: ${amtProblem}`);
    // Two single indexed lookups (uq_offline_payments_reference, uq_offline_payments_pending_invoice), not a table scan.
    const [dup, pendingForInvoice] = await scopedRead(async (tx) => [
      (await tx.select({ id: billingOfflinePayments.id }).from(billingOfflinePayments)
        .where(and(eq(billingOfflinePayments.tenantId, ctx.tenantId), eq(billingOfflinePayments.mode, body.mode), eq(billingOfflinePayments.referenceNorm, referenceNorm), inArray(billingOfflinePayments.status, ["pending", "approved"]))).limit(1))[0],
      (await tx.select({ id: billingOfflinePayments.id }).from(billingOfflinePayments)
        .where(and(eq(billingOfflinePayments.invoiceId, id), eq(billingOfflinePayments.tenantId, ctx.tenantId), eq(billingOfflinePayments.status, "pending"))).limit(1))[0],
    ] as const);
    if (dup) throw new HttpError(409, "DUPLICATE_REFERENCE", "this UTR / instrument number has already been recorded for this organisation");
    if (pendingForInvoice) throw new HttpError(409, "PENDING_EXISTS", "an offline payment for this invoice is already waiting for approval");
    return reply.code(202).send(await commands.requestOfflinePayment(ctx, { invoiceId: id, mode: body.mode, reference: body.reference, referenceNorm, paidOn: body.paidOn, amountMinor: body.amountMinor, reason: body.reason }));
  });

  app.get("/v1/billing/invoices/:id/offline-payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = parse(invoiceIdParam, req.params);
    await loadInvoice(ctx.tenantId, id);
    const rows = await scopedRead((tx) => tx.select().from(billingOfflinePayments)
      .where(and(eq(billingOfflinePayments.invoiceId, id), eq(billingOfflinePayments.tenantId, ctx.tenantId)))
      .orderBy(desc(billingOfflinePayments.createdAt)).limit(20));
    const canOperate = OPS_ROLES.some((r) => ctx.roles.includes(r));
    // Actor ids are never returned: "requested by you" / "another administrator" is all a screen needs.
    return reply.send({
      data: rows.map((r) => ({
        id: r.id, mode: r.mode, reference: r.referenceNorm, paidOn: r.paidOn, amountMinor: r.amountMinor.toString(), reason: r.reason,
        status: r.status, decisionReason: r.decisionReason, autoApproved: r.autoApproved,
        requestedByMe: r.requestedBy === ctx.actorId,
        canDecide: canOperate && r.status === "pending" && r.requestedBy !== ctx.actorId,
        createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post("/v1/billing/invoices/:id/offline-payments/:reqId/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const { id, reqId } = parse(requestParam, req.params);
    const body = parse(decisionBody, req.body);
    if (!body.approve && !body.reason) throw new HttpError(400, "VALIDATION_FAILED", "reason: a reason is required to reject");
    const rows = await scopedRead((tx) => tx.select().from(billingOfflinePayments)
      .where(and(eq(billingOfflinePayments.id, reqId), eq(billingOfflinePayments.invoiceId, id), eq(billingOfflinePayments.tenantId, ctx.tenantId))).limit(1));
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "offline payment request not found");
    if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `this request is already ${row.status}`);
    if (row.requestedBy === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "a different administrator must approve or reject your request");
    return reply.code(202).send(await commands.decideOfflinePayment(ctx, { requestId: reqId, invoiceId: id, approve: body.approve, reason: body.reason }));
  });

  // ── billing settings ─────────────────────────────────────────────────────────────────
  app.get("/v1/billing/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const [settings, pending] = await scopedRead(async (tx) => [
      (await tx.select().from(billingSettings).where(eq(billingSettings.tenantId, ctx.tenantId)))[0],
      (await tx.select().from(billingSettingRequests).where(and(eq(billingSettingRequests.tenantId, ctx.tenantId), eq(billingSettingRequests.status, "pending"))))[0],
    ] as const);
    return reply.send({
      data: {
        offlineMakerChecker: settings?.offlineMakerChecker ?? true,
        reminderOverdueDays: settings?.reminderOverdueDays ?? null,
        pendingMakerCheckerRequest: pending ? { id: pending.id, reason: pending.reason, requestedByMe: pending.requestedBy === ctx.actorId, createdAt: pending.createdAt.toISOString() } : null,
      },
    });
  });

  app.put("/v1/billing/settings/reminder-days", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const { days } = parse(reminderDaysBody, req.body);
    return reply.code(202).send(await commands.setReminderDays(ctx, days));
  });

  app.post("/v1/billing/settings/maker-checker", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const body = parse(makerCheckerBody, req.body);
    if (!body.enabled) {
      // A refused request must be visible to the caller, not a silent 202.
      const [current, pending] = await scopedRead(async (tx) => [
        (await tx.select().from(billingSettings).where(eq(billingSettings.tenantId, ctx.tenantId)))[0],
        (await tx.select({ id: billingSettingRequests.id }).from(billingSettingRequests).where(and(eq(billingSettingRequests.tenantId, ctx.tenantId), eq(billingSettingRequests.status, "pending"))).limit(1))[0],
      ] as const);
      if (current && current.offlineMakerChecker === false) throw new HttpError(409, "ALREADY_OFF", "two-person approval is already switched off for this organisation");
      if (pending) throw new HttpError(409, "PENDING_EXISTS", "a request to switch off two-person approval is already waiting for a second administrator");
    }
    return reply.code(202).send(await commands.setMakerChecker(ctx, body));
  });

  app.post("/v1/billing/settings/maker-checker/requests/:reqId/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const { reqId } = parse(settingsRequestParam, req.params);
    const body = parse(decisionBody, req.body);
    const rows = await scopedRead((tx) => tx.select().from(billingSettingRequests).where(and(eq(billingSettingRequests.id, reqId), eq(billingSettingRequests.tenantId, ctx.tenantId))).limit(1));
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "request not found");
    if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `this request is already ${row.status}`);
    if (row.requestedBy === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "a different administrator must decide this request");
    return reply.code(202).send(await commands.decideMakerChecker(ctx, { requestId: reqId, approve: body.approve, reason: body.reason }));
  });

  // ── reminders ──────────────────────────────────────────────────────────────────────────
  app.get("/v1/billing/invoices/:id/reminders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = parse(invoiceIdParam, req.params);
    await loadInvoice(ctx.tenantId, id);
    const rows = await scopedRead((tx) => tx.select().from(billingInvoiceReminders)
      .where(and(eq(billingInvoiceReminders.invoiceId, id), eq(billingInvoiceReminders.tenantId, ctx.tenantId)))
      .orderBy(desc(billingInvoiceReminders.sentAt)).limit(50));
    const last = rows[0]?.sentAt ?? null;
    const nextAllowed = last && last.getTime() + MANUAL_REMINDER_WINDOW_MS > Date.now() ? new Date(last.getTime() + MANUAL_REMINDER_WINDOW_MS) : null;
    return reply.send({ data: { lastSentAt: last?.toISOString() ?? null, nextAllowedAt: nextAllowed?.toISOString() ?? null, count: rows.length } });
  });

  app.post("/v1/billing/invoices/:id/reminders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OPS_ROLES);
    const { id } = parse(invoiceIdParam, req.params);
    const inv = await loadInvoice(ctx.tenantId, id);
    if (!isSettleable(inv.status) || inv.totalMinor - inv.paidMinor <= 0n) throw new HttpError(409, "NOTHING_DUE", "this invoice has nothing outstanding, so there is nobody to remind");
    const recent = await scopedRead((tx) => tx.select({ sentAt: billingInvoiceReminders.sentAt }).from(billingInvoiceReminders)
      // Counts scheduled sends too, exactly like the consumer's own check.
      .where(and(eq(billingInvoiceReminders.invoiceId, id), eq(billingInvoiceReminders.tenantId, ctx.tenantId), gt(billingInvoiceReminders.sentAt, new Date(Date.now() - MANUAL_REMINDER_WINDOW_MS))))
      .orderBy(desc(billingInvoiceReminders.sentAt)).limit(1));
    if (recent[0]) {
      const nextAllowedAt = new Date(recent[0].sentAt.getTime() + MANUAL_REMINDER_WINDOW_MS).toISOString();
      throw new HttpError(429, "REMINDER_RATE_LIMITED", `a reminder was already sent for this invoice; the next one can be sent after ${nextAllowedAt}`).withExtra({ nextAllowedAt });
    }
    const lookup = await fetchTenantAdminRecipients(ctx.tenantId);
    if (!lookup.ok) throw new HttpError(503, "RECIPIENTS_UNAVAILABLE", "the tenant administrators could not be looked up right now; nothing was sent");
    if (lookup.recipients.length === 0) throw new HttpError(422, "NO_RECIPIENTS", "this organisation has no active tenant administrator with an email address; nothing was sent");
    return reply.code(202).send({ ...(await commands.sendReminder(ctx, { invoiceId: id, trigger: "manual", recipients: lookup.recipients })), recipientCount: lookup.recipients.length });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false, ...((err as HttpError & { extra?: object }).extra ?? {}) });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
