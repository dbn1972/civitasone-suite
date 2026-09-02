import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Consultant / Invoice module (DIC Phase 3).
 *
 *   POST /v1/hrms/consultants/:id/invoices           submit an invoice
 *   GET  /v1/hrms/consultants/:id/invoices           list a consultant's invoices
 *   GET  /v1/hrms/consultant-invoices?status=..       AP queue by status
 *   GET  /v1/hrms/consultant-invoices/:invId          read
 *   POST /v1/hrms/consultant-invoices/:invId/verify   submitted -> verified (maker)
 *   POST /v1/hrms/consultant-invoices/:invId/approve  verified  -> approved (checker; 194J TDS + GST)
 *   POST /v1/hrms/consultant-invoices/:invId/reject   submitted|verified -> rejected
 *   POST /v1/hrms/consultant-invoices/:invId/mark-paid approved -> paid
 *
 * A consultant is a non-payroll engagement type paid by invoice (194J), so a
 * salaried employee cannot raise one (boundary guard). Approval computes GST +
 * Section-194J TDS (FY-aggregate threshold) and emits an outbox event for
 * Finance AP. Two-person control: the approver must differ from the verifier.
 * Money in paise (bigint).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { loadTypeResolver } from "../employee/engagement-policy.js";
import { computeInvoiceTax } from "./domain.js";
import * as repo from "./repo.js";
import type { ConsultantInvoiceRow } from "./schema.js";

const FINANCE_ROLES = ["hr_admin", "super_admin", "finance_officer", "payroll_admin"];
const SUBMIT_ROLES = [...FINANCE_ROLES, "hr_officer", "manager", "employee"];

// 194J FY threshold: ₹30,000 => 3,000,000 paise.
const TDS_194J_THRESHOLD_MINOR = 3_000_000n;

const idParam = z.object({ id: z.string().uuid() });
const invParam = z.object({ invId: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

/** Indian financial year window (Apr 1 – Mar 31) for a YYYY-MM-DD date. */
function financialYearWindow(isoDate: string): { from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7)); // 1-based
  const startYear = month >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export async function consultantInvoiceRoutes(app: FastifyInstance): Promise<void> {
  // ── submit ──────────────────────────────────────────────────────────────
  app.post("/v1/hrms/consultants/:id/invoices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      invoiceNo: z.string().min(1).max(64),
      invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      description: z.string().max(2000).optional(),
      grossMinor: z.coerce.number().int().positive(),
      gstApplicable: z.boolean().default(false),
      gstRateBps: z.coerce.number().int().min(0).max(10000).default(0),
      tdsRateBps: z.coerce.number().int().min(0).max(10000).default(1000),
      gstin: z.string().max(15).optional(),
      sacCode: z.string().max(6).optional(),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);

    const emp = await mustEmployee(ctx.tenantId, id);
    // Boundary guard: a salaried (payroll-eligible) employee is paid via payroll,
    // not by invoice. Fail-open on resolver error (never blocks on a transient DB
    // fault). Resolver is authoritative for categorised engagement types.
    const resolver = await loadTypeResolver(ctx.tenantId).catch((err: unknown) => {
      req.log.error({ err, event: "consultant.invoice.resolver_failed", tenantId: ctx.tenantId }, "engagement resolver failed — allowing");
      return null;
    });
    if (resolver && resolver(emp.employeeType ?? "").eligibleForPayroll) {
      throw new HttpError(409, "NOT_A_CONSULTANT",
        `employee '${id}' is a payroll-eligible engagement type — salaried staff are paid via payroll, not consultant invoices`);
    }

    // Synchronous pre-check for the (tenant, consultant, invoice_no) uniqueness
    // the DB enforces via hrms_consultant_invoices_no_uq. publishF3Write is
    // fire-and-forget and NEVER rejects (see shared/f3-publish.ts) — the
    // try/catch this replaced, wrapping the publish call for a 23505, was dead
    // code that could never run. Residual TOCTOU race: two concurrent submits
    // of the same invoice number can both pass this read before either
    // publishes; the DB unique constraint is the real backstop for that rare
    // case (the consumer's insert 23505s, logs "f3RouteWrite failed", and the
    // write is dropped — silently, from this client's point of view, since
    // fire-and-forget has no return channel). Closing that fully needs a
    // different mechanism (e.g. a client-supplied idempotency key) — out of
    // scope here.
    if (await repo.findInvoiceByNumber(ctx.tenantId, id, body.invoiceNo)) {
      throw new HttpError(409, "DUPLICATE_INVOICE", `invoice '${body.invoiceNo}' already exists for this consultant`);
    }

    const invId = randomUUID();
    // Wrap in a transaction so the tenant-GUC (app.tenant_id) is set for the
    // INSERT — RLS uses the USING clause as the WITH CHECK and would reject an
    // unscoped write. All the status-transition writes below do the same.
    await publishF3Write(ctx, "consultant_invoice_routes__0", invId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(201).send(jsonSafe({
      id: invId, consultantId: id, invoiceNo: body.invoiceNo,
      grossMinor: BigInt(body.grossMinor), status: "submitted",
    }));
  });

  app.get("/v1/hrms/consultants/:id/invoices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listByConsultant(ctx.tenantId, id) }));
  });

  app.get("/v1/hrms/consultant-invoices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ status: z.enum(["submitted", "verified", "approved", "rejected", "paid"]).default("submitted") }).parse(req.query);
    return reply.send(jsonSafe({ data: await repo.listByStatus(ctx.tenantId, q.status) }));
  });

  app.get("/v1/hrms/consultant-invoices/:invId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { invId } = invParam.parse(req.params);
    return reply.send(jsonSafe(await mustInvoice(ctx.tenantId, invId)));
  });

  // ── verify (maker) ──────────────────────────────────────────────────────
  app.post("/v1/hrms/consultant-invoices/:invId/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { invId } = invParam.parse(req.params);
    const inv = await mustInvoice(ctx.tenantId, invId);
    if (inv.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `invoice is '${inv.status}', not submitted`);
    await publishF3Write(ctx, "consultant_invoice_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: invId, status: "verified" })) as any;
  });

  // ── approve (checker; computes 194J TDS + GST, emits AP event) ────────────
  app.post("/v1/hrms/consultant-invoices/:invId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { invId } = invParam.parse(req.params);
    const body = z.object({
      approverRemarks: z.string().max(2000).optional(),
      // The checker (a finance role) is authoritative on the statutory rates —
      // this stops a low-privilege submitter from suppressing 194J TDS by
      // proposing tdsRateBps:0. Omitted => keep the submitted rate.
      gstRateBps: z.coerce.number().int().min(0).max(10000).optional(),
      tdsRateBps: z.coerce.number().int().min(0).max(10000).optional(),
    }).parse(req.body ?? {});
    const inv = await mustInvoice(ctx.tenantId, invId);
    if (inv.status !== "verified") throw new HttpError(409, "WRONG_STATE", `invoice is '${inv.status}', not verified`);
    // Two-person control: the approver must differ from the verifier.
    if (inv.verifiedBy && inv.verifiedBy === ctx.actorId) {
      throw new HttpError(409, "SOD_VIOLATION", "approver must differ from the verifier (two-person control)");
    }
    const gstRateBps = body.gstRateBps ?? inv.gstRateBps;
    const tdsRateBps = body.tdsRateBps ?? inv.tdsRateBps;
    const fy = financialYearWindow(inv.invoiceDate as unknown as string);

    // Was a literal placeholder (`gstMinor: 0n, tdsMinor: 0n, ...`) — computeInvoiceTax
    // was imported but never called, so every approval reported zero tax
    // regardless of what was actually withheld. Genuinely computable
    // synchronously: this is the exact same pure function
    // (computeInvoiceTax) and the exact same YTD query
    // (ytdApprovedGrossTx/ytdOn) the consumer uses to persist the real
    // numbers (consultant-invoice/f3-consumer.ts, op __2) — called here
    // through `db` (unlocked) rather than the consumer's transaction-scoped
    // `tx` (locked via lockConsultantForInvoicing). Residual TOCTOU race: two
    // concurrent approvals for the SAME consultant could each read a
    // pre-crossing YTD total here and both report tdsApplied:false, while the
    // consumer's advisory lock (lockConsultantForInvoicing) guarantees the
    // PERSISTED amounts are correct regardless — so a genuine race could make
    // this response's numbers stale relative to what actually gets withheld.
    // That is the same class of residual risk documented for the CPF/NPS
    // pre-checks in this PR, not a new one; not guessing to close it further.
    const ytd = await repo.ytdApprovedGrossTx(db, ctx.tenantId, inv.consultantId, fy.from, fy.to, invId);
    const tax = computeInvoiceTax({
      grossMinor: inv.grossMinor, gstApplicable: inv.gstApplicable, gstRateBps,
      tdsRateBps, tdsThresholdMinor: TDS_194J_THRESHOLD_MINOR, ytdGrossMinor: ytd,
    });
    await publishF3Write(ctx, "consultant_invoice_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({
      id: invId, status: "approved",
      grossMinor: inv.grossMinor, gstMinor: tax.gstMinor, tdsMinor: tax.tdsMinor,
      tdsApplied: tax.tdsApplied, netPayableMinor: tax.netPayableMinor,
    })) as any;
  });

  // ── reject ────────────────────────────────────────────────────────────────
  app.post("/v1/hrms/consultant-invoices/:invId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { invId } = invParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const inv = await mustInvoice(ctx.tenantId, invId);
    if (inv.status !== "submitted" && inv.status !== "verified") {
      throw new HttpError(409, "WRONG_STATE", `invoice is '${inv.status}', cannot reject`);
    }
    await publishF3Write(ctx, "consultant_invoice_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: invId, status: "rejected" })) as any;
  });

  // ── mark paid ───────────────────────────────────────────────────────────
  app.post("/v1/hrms/consultant-invoices/:invId/mark-paid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { invId } = invParam.parse(req.params);
    const body = z.object({ paymentRef: z.string().min(1).max(64) }).parse(req.body ?? {});
    const inv = await mustInvoice(ctx.tenantId, invId);
    if (inv.status !== "approved") throw new HttpError(409, "WRONG_STATE", `invoice is '${inv.status}', not approved`);
    await publishF3Write(ctx, "consultant_invoice_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: invId, status: "paid", paymentRef: body.paymentRef })) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustEmployee(tenantId: string, id: string) {
    const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
    const emp = rows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "consultant (employee) not found");
    return emp;
  }
  async function mustInvoice(tenantId: string, invId: string): Promise<ConsultantInvoiceRow> {
    const inv = await repo.findInvoice(tenantId, invId);
    if (!inv) throw new HttpError(404, "NOT_FOUND", "consultant invoice not found");
    return inv;
  }
}
