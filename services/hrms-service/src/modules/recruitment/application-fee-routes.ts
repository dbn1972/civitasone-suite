/**
 * Application fee — assess / exemption / payment (checklist R-RA-0099).
 *
 *   POST /v1/hrms/applications/:id/fee/assess   assess fee (exempt or pending) from the vacancy
 *   POST /v1/hrms/applications/:id/fee/pay      record a manual (offline) payment
 *   GET  /v1/hrms/applications/:id/fee          fee status
 *
 * Fee/exemption is derived from the vacancy fee + candidate category. Payment is
 * recorded manually (offline challan/DD/UTR reference — the government norm). The
 * ONLINE payment gateway is an external integration and is deferred behind a
 * feature flag/seam; when it is not enabled the online path is honestly 501, and
 * we never fake an online charge. Money is bigint paise (serialised as string).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { assessFee, gatewayEnabled, validateManualPayment } from "./application-fee.js";
import { emitAudit } from "./audit-emit.js";
import * as repo from "./application-fee-repo.js";
import * as screeningRepo from "./screening-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

function feeView(f: {
  id: string; applicationId: string; amountMinor: bigint; currency: string; status: string;
  exemptionReason: string | null; provider: string; paymentRef: string | null; paidAt: Date | null;
}) {
  return {
    id: f.id, applicationId: f.applicationId, amountMinor: f.amountMinor.toString(),
    currency: f.currency, status: f.status, exemptionReason: f.exemptionReason ?? undefined,
    provider: f.provider, paymentRef: f.paymentRef ?? undefined,
    paidAt: f.paidAt ? f.paidAt.toISOString() : undefined,
  };
}

export async function applicationFeeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/applications/:id/fee/assess", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);

    // HR asserts whether the candidate's reserved-category claim has been
    // VERIFIED (certificate checked). A self-declared category alone never
    // exempts — that would be a fee-bypass (adversarial review H2).
    const body = z.object({ categoryVerified: z.boolean().default(false) }).parse(req.body ?? {});

    const a = await screeningRepo.findApplication(ctx.tenantId, id);
    if (!a) throw new HttpError(404, "NOT_FOUND", "application not found");

    const existing = await repo.findFee(ctx.tenantId, id);
    if (existing) return reply.code(200).send({ data: feeView(existing), assessed: false });

    const vacancyFee = await repo.getVacancyFee(ctx.tenantId, a.jobOpeningId);
    const assessment = assessFee(vacancyFee, { category: a.category, categoryVerified: body.categoryVerified });
    const fid = randomUUID();
    try {
      await db.transaction((tx) => repo.insertFee(tx, {
        id: fid, tenantId: ctx.tenantId, applicationId: id, jobOpeningId: a.jobOpeningId,
        amountMinor: assessment.amountMinor, currency: "INR", status: assessment.status,
        exemptionReason: assessment.exemptionReason, provider: "none",
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      }));
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        const now = await repo.findFee(ctx.tenantId, id);
        if (now) return reply.code(200).send({ data: feeView(now), assessed: false });
      }
      throw err;
    }
    return reply.code(201).send({
      data: { id: fid, applicationId: id, amountMinor: assessment.amountMinor.toString(), currency: "INR", status: assessment.status, exemptionReason: assessment.exemptionReason ?? undefined, provider: "none" },
      assessed: true,
    });
  });

  app.post("/v1/hrms/applications/:id/fee/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES); // recording a payment is a financial action
    const { id } = idParam.parse(req.params);
    const body = z.object({
      mode: z.enum(["manual", "online"]).default("manual"),
      paymentRef: z.string().max(128).optional(),
    }).parse(req.body ?? {});

    const fee = await repo.findFee(ctx.tenantId, id);
    if (!fee) throw new HttpError(404, "NOT_FOUND", "no fee has been assessed for this application");
    if (fee.status === "exempt") throw new HttpError(409, "FEE_EXEMPT", "this application is fee-exempt; there is nothing to pay");
    // Only a PENDING fee is payable (guards paid AND refunded — allow-list, not
    // a deny-list, per adversarial review M2).
    if (fee.status !== "pending") throw new HttpError(409, "NOT_PAYABLE", `the fee is '${fee.status}', not pending`);

    if (body.mode === "online") {
      // The online payment gateway is an external integration, not yet wired.
      if (!gatewayEnabled(process.env)) {
        throw new HttpError(501, "GATEWAY_NOT_ENABLED", "online fee payment is not available; record a manual/offline payment instead");
      }
      // When enabled, this is where the gateway charge would be initiated. Until
      // that adapter exists we do NOT fabricate an online payment.
      throw new HttpError(501, "GATEWAY_NOT_IMPLEMENTED", "online payment gateway adapter is not implemented");
    }

    const errors = validateManualPayment(body);
    if (errors.length > 0) throw new HttpError(422, "INVALID_PAYMENT", errors.join("; "));
    const paymentRef = body.paymentRef!.trim();

    try {
      await db.transaction(async (tx) => {
        await repo.updateFee(tx, ctx.tenantId, fee.id, {
          status: "paid", provider: "manual", paymentRef, paidAt: new Date(), updatedBy: ctx.actorId,
        }, fee.version);
        await emitAudit(tx, ctx, "application_fee_paid", "application_fee", fee.id, {
          applicationId: id, amountMinor: fee.amountMinor.toString(), provider: "manual", paymentRef,
        });
      });
    } catch (err) {
      if ((err as Error).message === "VERSION_CONFLICT") throw new HttpError(409, "VERSION_CONFLICT", "the fee record changed; reload and retry");
      throw err;
    }
    return reply.send({ data: { id: fee.id, applicationId: id, status: "paid", provider: "manual", paymentRef } });
  });

  app.get("/v1/hrms/applications/:id/fee", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const fee = await repo.findFee(ctx.tenantId, id);
    if (!fee) throw new HttpError(404, "NOT_FOUND", "no fee has been assessed for this application");
    return reply.send({ data: feeView(fee) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
