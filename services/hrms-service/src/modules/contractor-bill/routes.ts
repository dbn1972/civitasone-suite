import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Third-Party / Agency module (DIC Phase 3). DIC is the CLRA principal employer;
 * it pays the licensed contractor/agency (not the deployed worker) under §194C.
 *
 * Contractor master:
 *   POST /v1/hrms/contractors                    register an agency
 *   GET  /v1/hrms/contractors                    list
 *   GET  /v1/hrms/contractors/:id                read
 *   PATCH /v1/hrms/contractors/:id               update (licence renewal / blacklist)
 *
 * Bills (submit -> verify -> approve[194C TDS + GST + CLRA gates] -> mark-paid):
 *   POST /v1/hrms/contractors/:id/bills          submit a bill
 *   GET  /v1/hrms/contractors/:id/bills          list a contractor's bills
 *   GET  /v1/hrms/contractor-bills?status=..      AP queue
 *   GET  /v1/hrms/contractor-bills/:billId        read
 *   POST /v1/hrms/contractor-bills/:billId/verify | /approve | /reject | /mark-paid
 *
 * CLRA gates at approval: contractor not blacklisted; a valid labour licence
 * covering the bill date when 20+ workers are deployed; and the principal-employer
 * attestation that statutory wages were disbursed to the workers. §194C rate is
 * derived from the contractor kind (1% individual/HUF, 2% other) — NOT submitter
 * input — so a submitter cannot suppress TDS. Money in paise (bigint).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { computeContractTax, type ContractorKind } from "./domain.js";
import * as repo from "./repo.js";
import type { ContractorRow, ContractorBillRow } from "./schema.js";

const FINANCE_ROLES = ["hr_admin", "super_admin", "finance_officer", "payroll_admin"];
const SUBMIT_ROLES = [...FINANCE_ROLES, "hr_officer", "manager"];

const TDS_194C_SINGLE_MINOR = 3_000_000n;   // ₹30,000
const TDS_194C_ANNUAL_MINOR = 10_000_000n;  // ₹1,00,000
const CLRA_WORKER_THRESHOLD = 20;           // CLRA applicability

const idParam = z.object({ id: z.string().uuid() });
const billParam = z.object({ billId: z.string().uuid() });

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

function financialYearWindow(isoDate: string): { from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export async function contractorBillRoutes(app: FastifyInstance): Promise<void> {
  // ══════════════════ contractor master ══════════════════
  app.post("/v1/hrms/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = z.object({
      name: z.string().min(1).max(200),
      contractorKind: z.enum(["individual_huf", "other"]).default("other"),
      clraLicenseNo: z.string().max(64).optional(),
      clraLicenseValidTill: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      pan: z.string().max(10).optional(),
      gstin: z.string().max(15).optional(),
      contactEmail: z.string().email().max(120).optional(),
      contactPhone: z.string().max(20).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "contractor_bill_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, name: body.name, status: "active" });
  });

  app.get("/v1/hrms/contractors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    return reply.send(jsonSafe({ data: await repo.listContractors(ctx.tenantId) }));
  });

  app.get("/v1/hrms/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe(await mustContractor(ctx.tenantId, id)));
  });

  app.patch("/v1/hrms/contractors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      clraLicenseNo: z.string().max(64).optional(),
      clraLicenseValidTill: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      contactEmail: z.string().email().max(120).optional(),
      contactPhone: z.string().max(20).optional(),
      status: z.enum(["active", "blacklisted"]).optional(),
    }).parse(req.body ?? {});
    const c = await mustContractor(ctx.tenantId, id);
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.clraLicenseNo !== undefined) patch.clraLicenseNo = body.clraLicenseNo;
    if (body.clraLicenseValidTill !== undefined) patch.clraLicenseValidTill = body.clraLicenseValidTill;
    if (body.contactEmail !== undefined) patch.contactEmail = body.contactEmail;
    if (body.contactPhone !== undefined) patch.contactPhone = body.contactPhone;
    if (body.status !== undefined) patch.status = body.status;
    await publishF3Write(ctx, "contractor_bill_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: body.status ?? c.status });
  });

  // ══════════════════ bills ══════════════════
  app.post("/v1/hrms/contractors/:id/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      billNo: z.string().min(1).max(64),
      billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      description: z.string().max(2000).optional(),
      workersCount: z.coerce.number().int().min(0).default(0),
      grossMinor: z.coerce.number().int().positive(),
      gstApplicable: z.boolean().default(false),
      gstRateBps: z.coerce.number().int().min(0).max(10000).default(0),
      wagesDisbursedVerified: z.boolean().default(false),
      remarks: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustContractor(ctx.tenantId, id);
    if (c.status === "blacklisted") throw new HttpError(409, "CONTRACTOR_BLACKLISTED", "contractor is blacklisted; no new bills accepted");

    const billId = randomUUID();
    try {
      await publishF3Write(ctx, "contractor_bill_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "DUPLICATE_BILL", `bill '${body.billNo}' already exists for this contractor`);
      }
      throw err;
    }
    return reply.code(201).send(jsonSafe({ id: billId, contractorId: id, billNo: body.billNo, grossMinor: BigInt(body.grossMinor), status: "submitted" }));
  });

  app.get("/v1/hrms/contractors/:id/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listBillsByContractor(ctx.tenantId, id) }));
  });

  app.get("/v1/hrms/contractor-bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({ status: z.enum(["submitted", "verified", "approved", "rejected", "paid"]).default("submitted") }).parse(req.query);
    return reply.send(jsonSafe({ data: await repo.listBillsByStatus(ctx.tenantId, q.status) }));
  });

  app.get("/v1/hrms/contractor-bills/:billId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUBMIT_ROLES);
    const { billId } = billParam.parse(req.params);
    return reply.send(jsonSafe(await mustBill(ctx.tenantId, billId)));
  });

  app.post("/v1/hrms/contractor-bills/:billId/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { billId } = billParam.parse(req.params);
    const bill = await mustBill(ctx.tenantId, billId);
    if (bill.status !== "submitted") throw new HttpError(409, "WRONG_STATE", `bill is '${bill.status}', not submitted`);
    await publishF3Write(ctx, "contractor_bill_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: billId, status: "verified" }));
  });

  app.post("/v1/hrms/contractor-bills/:billId/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { billId } = billParam.parse(req.params);
    const body = z.object({
      approverRemarks: z.string().max(2000).optional(),
      gstRateBps: z.coerce.number().int().min(0).max(10000).optional(),
    }).parse(req.body ?? {});
    const bill = await mustBill(ctx.tenantId, billId);
    if (bill.status !== "verified") throw new HttpError(409, "WRONG_STATE", `bill is '${bill.status}', not verified`);
    if (bill.verifiedBy && bill.verifiedBy === ctx.actorId) {
      throw new HttpError(409, "SOD_VIOLATION", "approver must differ from the verifier (two-person control)");
    }
    const contractor = await mustContractor(ctx.tenantId, bill.contractorId);
    // ── CLRA principal-employer gates ──
    if (contractor.status === "blacklisted") throw new HttpError(409, "CONTRACTOR_BLACKLISTED", "contractor is blacklisted");
    if (!bill.wagesDisbursedVerified) {
      throw new HttpError(409, "CLRA_WAGES_UNVERIFIED",
        "wage disbursement to workers is not verified — the principal employer cannot approve payment (CLRA s.21)");
    }
    if (bill.workersCount >= CLRA_WORKER_THRESHOLD) {
      const validTill = contractor.clraLicenseValidTill as unknown as string | null;
      const billDate = bill.billDate as unknown as string;
      if (!contractor.clraLicenseNo || !validTill || validTill < billDate) {
        throw new HttpError(409, "CLRA_LICENSE_INVALID",
          `contractor deploys ${bill.workersCount} workers but has no valid CLRA licence covering the bill date`);
      }
    }

    const gstRateBps = body.gstRateBps ?? bill.gstRateBps;
    const fy = financialYearWindow(bill.billDate as unknown as string);
    let tax = { gstMinor: 0n, tdsRateBps: 0, tdsMinor: 0n, netPayableMinor: bill.grossMinor, tdsApplied: false };
    await publishF3Write(ctx, "contractor_bill_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({
      id: billId, status: "approved",
      grossMinor: bill.grossMinor, gstMinor: tax.gstMinor,
      tdsSection: bill.tdsSection, tdsRateBps: tax.tdsRateBps, tdsMinor: tax.tdsMinor,
      tdsApplied: tax.tdsApplied, netPayableMinor: tax.netPayableMinor,
    }));
  });

  app.post("/v1/hrms/contractor-bills/:billId/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { billId } = billParam.parse(req.params);
    const body = z.object({ approverRemarks: z.string().max(2000).optional() }).parse(req.body ?? {});
    const bill = await mustBill(ctx.tenantId, billId);
    if (bill.status !== "submitted" && bill.status !== "verified") {
      throw new HttpError(409, "WRONG_STATE", `bill is '${bill.status}', cannot reject`);
    }
    await publishF3Write(ctx, "contractor_bill_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: billId, status: "rejected" }));
  });

  app.post("/v1/hrms/contractor-bills/:billId/mark-paid", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { billId } = billParam.parse(req.params);
    const body = z.object({ paymentRef: z.string().min(1).max(64) }).parse(req.body ?? {});
    const bill = await mustBill(ctx.tenantId, billId);
    if (bill.status !== "approved") throw new HttpError(409, "WRONG_STATE", `bill is '${bill.status}', not approved`);
    await publishF3Write(ctx, "contractor_bill_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send(jsonSafe({ id: billId, status: "paid", paymentRef: body.paymentRef }));
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

  async function mustContractor(tenantId: string, id: string): Promise<ContractorRow> {
    const c = await repo.findContractor(tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "contractor not found");
    return c;
  }
  async function mustBill(tenantId: string, billId: string): Promise<ContractorBillRow> {
    const b = await repo.findBill(tenantId, billId);
    if (!b) throw new HttpError(404, "NOT_FOUND", "contractor bill not found");
    return b;
  }
}
