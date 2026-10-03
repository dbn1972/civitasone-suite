/**
 * fin-payroll-03 gap batch: routes added on top of the DDO / pay-group /
 * pensioner / reimbursement / salary-revision modules. Every mutation is
 * zod-validated, runs read-only guards here, publishes a command and returns
 * 202; the writes (transaction + audit outbox event) live in
 * fin03-consumer.ts. Sensitive READS (PII reveal, receipt view) publish an
 * audit command BEFORE the value is returned.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { sql, eq, and } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { presignedPutUrl, presignedGetUrl, StorageNotConfiguredError } from "@civitasone/storage";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { maskLast4, maskPan } from "../../shared/pii-mask.js";
import { payrollPensioners } from "./schema.js";
import * as commands from "./fin03-commands.js";
import { scopeReimbursementEmployee } from "./adjustment-guards.js";
import {
  validatePaySchedule, canTransitionPensioner, maskPpoNo,
  buildReimbursementAttachmentKey, REIMBURSEMENT_ATTACHMENT_MAX_BYTES, REIMBURSEMENT_ATTACHMENT_TYPES,
  type PayFrequency,
} from "./fin03-domain.js";
import { isValidIanaTimeZone } from "./validators.js";
import { PAY_GROUP_BILL_TYPES } from "./pay-group-domain.js";
import { assertActiveDdo, payGroupDeactivationBlockers } from "./pay-group-guards.js";

const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
const READER_ROLES = [...PAYROLL_ROLES, "hr_admin", "finance_officer"];
const REIMBURSEMENT_ROLES = [...PAYROLL_ROLES, "hr_admin"];
const idParam = z.object({ id: z.string().uuid() });
const reason = z.string().trim().min(10).max(500);

const payGroupPatchBody = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  frequency: z.enum(["monthly", "bi_weekly", "weekly"]).optional(),
  payDayOfMonth: z.number().int().min(1).max(31).optional(),
  payWeekday: z.number().int().min(1).max(7).nullable().optional(),
  payLastDay: z.boolean().optional(),
  payWeekParity: z.number().int().min(0).max(1).nullable().optional(),
  timezone: z.string().max(64).refine(isValidIanaTimeZone, "must be an IANA timezone name, e.g. Asia/Kolkata").optional(),
  // GAP-PAYROLL-PAY-GROUPS-03
  ddoCode: z.string().trim().min(1).max(32).nullable().optional(),
  billType: z.enum(PAY_GROUP_BILL_TYPES).optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "nothing to update" });

export async function fin03Routes(app: FastifyInstance): Promise<void> {
  // ─── GAP-PAYROLL-DDOS-03 ──────────────────────────────────────────────────
  app.patch("/v1/payroll/ddos/:ddoCode/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { ddoCode } = z.object({ ddoCode: z.string().min(1).max(32) }).parse(req.params);
    const body = z.object({ active: z.boolean(), reason }).parse(req.body);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT is_active FROM payroll.payroll_ddos
       WHERE tenant_id = ${ctx.tenantId}::uuid AND ddo_code = ${ddoCode} LIMIT 1
    `))) as unknown as Array<{ is_active: boolean }>;
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "DDO not found");
    if (rows[0].is_active === body.active) {
      throw new HttpError(409, "INVALID_STATE", `DDO is already ${body.active ? "active" : "inactive"}`);
    }
    if (!body.active) {
      const use = (await scopedRead((tx) => tx.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM payroll.payroll_pensioners
            WHERE tenant_id = ${ctx.tenantId}::uuid AND ddo_code = ${ddoCode} AND status = 'active')::int AS pensioners,
          (SELECT COUNT(*) FROM payroll.payroll_runs
            WHERE tenant_id = ${ctx.tenantId}::uuid AND ddo_code = ${ddoCode} AND status IN ('draft', 'processing'))::int AS runs
      `))) as unknown as Array<{ pensioners: number; runs: number }>;
      const u = use[0];
      if (u && (u.pensioners > 0 || u.runs > 0)) {
        throw new HttpError(409, "DDO_IN_USE",
          `DDO ${ddoCode} still has ${u.pensioners} active pensioner(s) and ${u.runs} run(s) in progress; move or finish them first`);
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.setDdoActive(ctx, ddoCode, body.active, body.reason));
  });

  // ─── GAP-PAYROLL-PAY-GROUPS-01/03 ─────────────────────────────────────────
  app.patch("/v1/payroll/pay-groups/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    const b = payGroupPatchBody.parse(req.body);
    const cur = (await scopedRead((tx) => tx.execute(sql`
      SELECT name, frequency, pay_day_of_month, timezone, pay_weekday, pay_last_day, pay_week_parity, status, ddo_code, bill_type
        FROM payroll.pay_groups WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{
      name: string; frequency: PayFrequency; pay_day_of_month: number; timezone: string;
      pay_weekday: number | null; pay_last_day: boolean; pay_week_parity: number | null; status: string;
      ddo_code: string | null; bill_type: string;
    }>;
    const g = cur[0];
    if (!g) throw new HttpError(404, "NOT_FOUND", "pay group not found");
    if (g.status !== "active") throw new HttpError(409, "INVALID_STATE", "reactivate the pay group before editing it");
    const frequency = b.frequency ?? g.frequency;
    // Changing the frequency clears the fields that no longer apply unless the
    // caller sets them explicitly in the same request.
    const switched = b.frequency !== undefined && b.frequency !== g.frequency;
    const merged = {
      name: b.name ?? g.name,
      frequency,
      payDayOfMonth: b.payDayOfMonth ?? g.pay_day_of_month,
      timezone: b.timezone ?? g.timezone,
      payWeekday: b.payWeekday !== undefined ? b.payWeekday : (switched && frequency === "monthly" ? null : g.pay_weekday),
      payLastDay: b.payLastDay !== undefined ? b.payLastDay : (switched && frequency !== "monthly" ? false : g.pay_last_day),
      payWeekParity: b.payWeekParity !== undefined ? b.payWeekParity : (switched && frequency !== "bi_weekly" ? null : g.pay_week_parity),
      ddoCode: b.ddoCode !== undefined ? b.ddoCode : g.ddo_code,
      billType: b.billType ?? g.bill_type,
    };
    // A DDO already on the group may stay even if it was deactivated since; a NEW one must be active.
    if (b.ddoCode !== undefined && b.ddoCode !== g.ddo_code) await assertActiveDdo(ctx.tenantId, b.ddoCode);
    const problem = validatePaySchedule({ ...merged });
    if (problem) throw new HttpError(400, "VALIDATION_FAILED", problem);
    if (merged.name !== g.name) {
      const dup = (await scopedRead((tx) => tx.execute(sql`
        SELECT 1 FROM payroll.pay_groups
         WHERE tenant_id = ${ctx.tenantId}::uuid AND name = ${merged.name} AND id <> ${id}::uuid LIMIT 1
      `))) as unknown as unknown[];
      if (dup.length > 0) throw new HttpError(409, "DUPLICATE_NAME", "another pay group already uses this name");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.updatePayGroup(ctx, id, merged));
  });

  app.patch("/v1/payroll/pay-groups/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ active: z.boolean(), reason }).parse(req.body);
    const cur = (await scopedRead((tx) => tx.execute(sql`
      SELECT status FROM payroll.pay_groups WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ status: string }>;
    if (!cur[0]) throw new HttpError(404, "NOT_FOUND", "pay group not found");
    if ((cur[0].status === "active") === body.active) {
      throw new HttpError(409, "INVALID_STATE", `pay group is already ${body.active ? "active" : "inactive"}`);
    }
    // Members and in-flight runs reference a pay group; deactivating it would
    // strand them. Checked here for a clear 409 and re-checked, under a row
    // lock, by the consumer (a member added meanwhile cannot be stranded).
    if (!body.active) {
      const blockers = await payGroupDeactivationBlockers(ctx.tenantId, id);
      if (blockers.members > 0) {
        throw new HttpError(409, "PAY_GROUP_HAS_MEMBERS", `the pay group still has ${blockers.members} current or scheduled member(s); end or move them first`);
      }
      if (blockers.activeRuns > 0) {
        throw new HttpError(409, "PAY_GROUP_HAS_ACTIVE_RUN", `the pay group has ${blockers.activeRuns} draft or processing run(s); finish or fail them first`);
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.setPayGroupActive(ctx, id, body.active, body.reason));
  });

  // ─── GAP-PAYROLL-PENSIONERS-03/04 ─────────────────────────────────────────
  app.get("/v1/payroll/pensioners/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    // Drizzle select so the encryptedText columns decrypt; only MASKED forms
    // of the identifiers leave this handler (reveal is a separate audited call).
    const rows = await scopedRead((tx) => tx.select().from(payrollPensioners)
      .where(and(eq(payrollPensioners.id, id), eq(payrollPensioners.tenantId, ctx.tenantId))).limit(1));
    const r = rows[0];
    if (!r) throw new HttpError(404, "NOT_FOUND", "pensioner not found");
    const extra = (await scopedRead((tx) => tx.execute(sql`
      SELECT status_reason, status_changed_at, date_of_death::text AS date_of_death
        FROM payroll.payroll_pensioners WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `))) as unknown as Array<{ status_reason: string | null; status_changed_at: string | null; date_of_death: string | null }>;
    return reply.send({
      id: r.id, ppoNo: maskPpoNo(r.ppoNo), ppoNoMasked: true, fullName: r.fullName, dateOfBirth: r.dateOfBirth,
      // precision-ok: JSON-number paise, same shape as the register list (GET /pensioners)
      basicPensionMinor: Number(r.basicPensionMinor), commutedPensionMinor: Number(r.commutedPensionMinor), // precision-ok
      commutationDate: r.commutationDate, medicalAllowanceMinor: Number(r.medicalAllowanceMinor), // precision-ok
      ddoCode: r.ddoCode, taxRegime: r.taxRegime, status: r.status,
      bankAccountMasked: r.bankAccountNo ? maskLast4(r.bankAccountNo) : null,
      bankIfsc: r.bankIfsc ?? null,
      panMasked: r.pan ? maskPan(r.pan) : null,
      statusReason: extra[0]?.status_reason ?? null,
      statusChangedAt: extra[0]?.status_changed_at ?? null,
      dateOfDeath: extra[0]?.date_of_death ?? null,
    });
  });

  app.patch("/v1/payroll/pensioners/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    // "Today" on the statutory (IST) calendar, so a date of death entered early in the
    // Indian morning is not rejected as "in the future" by a UTC clock.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const body = z.object({
      status: z.enum(["stopped", "deceased"]),
      reason,
      dateOfDeath: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).superRefine((b, c) => {
      if (b.status === "deceased" && !b.dateOfDeath) {
        c.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOfDeath"], message: "date of death is required" });
      }
      if (b.dateOfDeath && b.dateOfDeath > today) {
        c.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOfDeath"], message: "date of death cannot be in the future" });
      }
      if (b.status !== "deceased" && b.dateOfDeath) {
        c.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOfDeath"], message: "only for a deceased pensioner" });
      }
    }).parse(req.body);
    const cur = (await scopedRead((tx) => tx.execute(sql`
      SELECT status FROM payroll.payroll_pensioners WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ status: string }>;
    if (!cur[0]) throw new HttpError(404, "NOT_FOUND", "pensioner not found");
    if (!canTransitionPensioner(cur[0].status, body.status)) {
      throw new HttpError(409, "INVALID_STATE", `a ${cur[0].status} pensioner cannot be marked ${body.status}`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.setPensionerStatus(ctx, id, {
      from: cur[0].status, to: body.status, reason: body.reason, dateOfDeath: body.dateOfDeath ?? null,
    }));
  });

  // Audited reveal of one identifier. Role-gated to the payroll officers (NOT
  // hr_admin / finance_officer, who may only see the masked forms); the audit
  // command is published first, so an unrecordable reveal is never served.
  app.post("/v1/payroll/pensioners/:id/reveal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ field: z.enum(["ppoNo", "pan", "bankAccountNo"]), reason }).parse(req.body);
    const rows = await scopedRead((tx) => tx.select().from(payrollPensioners)
      .where(and(eq(payrollPensioners.id, id), eq(payrollPensioners.tenantId, ctx.tenantId))).limit(1));
    const r = rows[0];
    if (!r) throw new HttpError(404, "NOT_FOUND", "pensioner not found");
    const value = body.field === "ppoNo" ? r.ppoNo : body.field === "pan" ? r.pan : r.bankAccountNo;
    if (!value) throw new HttpError(404, "NOT_FOUND", `no ${body.field} on record`);
    await commands.recordAudit(ctx, {
      action: "reveal_pii", resourceType: "payroll_pensioner", resourceId: id,
      details: { field: body.field, reason: body.reason },
    });
    // Never cache a revealed identifier.
    return reply.header("Cache-Control", "no-store").send({ field: body.field, value });
  });

  // ─── GAP-PAYROLL-REIMBURSEMENTS-03: receipts ──────────────────────────────
  app.post("/v1/payroll/reimbursements/attachments/presign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...REIMBURSEMENT_ROLES, "employee"]);
    const b = z.object({
      filename: z.string().trim().min(1).max(200),
      contentType: z.enum(REIMBURSEMENT_ATTACHMENT_TYPES),
      sizeBytes: z.number().int().positive().max(REIMBURSEMENT_ATTACHMENT_MAX_BYTES),
    }).parse(req.body);
    const key = buildReimbursementAttachmentKey(ctx.tenantId, ctx.actorId, randomUUID(), b.filename);
    try {
      const uploadUrl = await presignedPutUrl({ key, contentType: b.contentType, contentLength: b.sizeBytes, expiresIn: 300 });
      return reply.send({ storageKey: key, uploadUrl, expiresInSeconds: 300, maxBytes: REIMBURSEMENT_ATTACHMENT_MAX_BYTES });
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) {
        throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "receipt storage is not configured for this environment");
      }
      throw err;
    }
  });

  // Short-lived download links; staff or the claimant only; every view audited
  // (a receipt can hold health information -- DPDP).
  app.get("/v1/payroll/reimbursements/:id/attachments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...REIMBURSEMENT_ROLES, "employee"]);
    const { id } = idParam.parse(req.params);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT employee_id::text AS employee_id, attachment_keys
        FROM payroll.payroll_reimbursements WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ employee_id: string; attachment_keys: string[] | null }>;
    const claim = rows[0];
    if (!claim) throw new HttpError(404, "NOT_FOUND", "reimbursement claim not found");
    await scopeReimbursementEmployee(ctx, claim.employee_id, "read", REIMBURSEMENT_ROLES);
    const keys = claim.attachment_keys ?? [];
    if (keys.length === 0) return reply.header("Cache-Control", "no-store").send({ data: [] });
    await commands.recordAudit(ctx, {
      action: "view_attachments", resourceType: "payroll_reimbursement", resourceId: id, details: { count: keys.length },
    });
    try {
      const data = await Promise.all(keys.map(async (key, index) => ({
        index,
        filename: key.split("/").pop() ?? "receipt",
        url: await presignedGetUrl({ key, expiresIn: 300 }),
      })));
      // Short-lived signed links: never cache.
      return reply.header("Cache-Control", "no-store").send({ data });
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) {
        throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "receipt storage is not configured for this environment");
      }
      throw err;
    }
  });

  // ─── GAP-PAYROLL-SALARY-REVISIONS-04: maker != checker ────────────────────
  const decideRevision = (decision: "approved" | "rejected") => async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = (decision === "rejected"
      ? z.object({ note: z.string().trim().min(10).max(500) })
      : z.object({ note: z.string().trim().max(500).optional() })).parse(req.body ?? {});
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT status, created_by::text AS created_by FROM payroll.payroll_salary_revisions
       WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ status: string; created_by: string | null }>;
    const rev = rows[0];
    if (!rev) throw new HttpError(404, "NOT_FOUND", "salary revision not found");
    if (rev.status !== "pending") throw new HttpError(409, "INVALID_STATE", `revision is ${rev.status}, only pending revisions can be decided`);
    if (rev.created_by === ctx.actorId) {
      throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "a salary revision must be decided by someone other than its creator");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideSalaryRevision(ctx, id, decision, body.note ?? null));
  };
  app.patch("/v1/payroll/salary-revisions/:id/approve", decideRevision("approved"));
  app.patch("/v1/payroll/salary-revisions/:id/reject", decideRevision("rejected"));

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
