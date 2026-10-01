import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["payroll_admin", "super_admin"];

const upsertBodySchema = z.object({
  sponsorCode: z.string().length(4, "sponsor_code must be exactly 4 characters"),
  sponsorIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "invalid IFSC format"),
  // Optional on update: the web form says "Leave blank to keep existing
  // account" and omits it, which this schema used to reject with a 400 --
  // the update path never worked without retyping the account number.
  // Still required when no config exists yet (checked in the handler).
  sponsorAccount: z.string().trim().min(1, "sponsor_account is required").optional(),
  utilityCode: z.string().max(18, "utility_code must be at most 18 characters").optional(),
  userNumber: z.string().max(20, "user_number must be at most 20 characters").optional(),
  settlementOffsetDays: z.number().int().min(0).default(1),
  nachEnabled: z.boolean().default(true),
  apbsEnabled: z.boolean().default(false),
  maxRecordsPerFile: z.number().int().min(1).default(100000),
  maxAmountPerFileMinor: z.union([z.bigint(), z.number().int(), z.string()])
    .transform((v) => BigInt(v))
    .default(1000000000),
  /**
   * GAP-PAYROLL-DISBURSEMENT-04: why the sponsor bank details are changing --
   * recorded on the audit event. Optional for non-UI callers; the web
   * ConfirmDialog always requires it (min 10 chars).
   */
  reason: z.string().trim().min(10).max(500).optional(),
});

export async function sponsorConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/sponsor-bank-config", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const config = await repo.findByTenantId(ctx.tenantId);
    if (!config) {
      throw new HttpError(404, "NOT_FOUND", "sponsor bank config not found for this tenant");
    }
    return config;
  });

  app.put("/v1/payroll/sponsor-bank-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const body = upsertBodySchema.parse(req.body);

    let sponsorAccount = body.sponsorAccount;
    if (!sponsorAccount) {
      const existing = await repo.findByTenantId(ctx.tenantId);
      if (!existing) {
        throw new HttpError(400, "VALIDATION_FAILED", "sponsorAccount is required when no sponsor bank config exists");
      }
      sponsorAccount = existing.sponsorAccount;
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertSponsorConfig(ctx, {
      sponsorCode: body.sponsorCode,
      sponsorIfsc: body.sponsorIfsc,
      sponsorAccount,
      utilityCode: body.utilityCode ?? null,
      userNumber: body.userNumber ?? null,
      settlementOffsetDays: body.settlementOffsetDays,
      nachEnabled: body.nachEnabled,
      apbsEnabled: body.apbsEnabled,
      maxRecordsPerFile: body.maxRecordsPerFile,
      maxAmountPerFileMinor: body.maxAmountPerFileMinor.toString(),
      reason: body.reason ?? null,
    }));
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
