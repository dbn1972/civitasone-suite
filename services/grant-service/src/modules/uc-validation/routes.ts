import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as ucRepo from "../utilisation/repo.js";
import * as commands from "../utilisation/commands.js";

const GRANT_ROLES = ["grant_officer", "grant_admin", "finance_admin", "super_admin"];

const validateBody = z.object({
  status: z.enum(["validated", "rejected"]),
  remarks: z.string().max(1000).optional(),
});

export async function ucValidationRoutes(app: FastifyInstance): Promise<void> {
  // P0-1/P0-2: enqueue UC validation decision — consumer persists to
  // utilisation.grant_uc_validations and flips grant_uc_statements.validation_status.
  app.post("/v1/grants/utilization-certs/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: ucId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = validateBody.parse(req.body);

    // UC must exist within this tenant before it can be validated (read path).
    const uc = await ucRepo.findUcById(ucId, ctx.tenantId);
    if (!uc) {
      throw new HttpError(404, "NOT_FOUND", "utilisation certificate not found");
    }

    // P0-4 SoD: the validator must be distinct from whoever submitted the UC.
    // Without this, the same grant_officer who files a (possibly fabricated)
    // utilisation certificate could self-validate it, which is exactly the
    // signal the PFMS next-tranche gate (hasSubmittedUcForApplication) trusts
    // before releasing the next real disbursement.
    if (uc.createdBy && uc.createdBy === ctx.actorId) {
      throw new HttpError(403, "SOD_VIOLATION", "UC validation must be performed by someone other than the submitter (separation of duties)");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.validateUc(ctx, ucId, body, {
        applicationId: uc.applicationId,
        installmentNo: uc.installmentNo,
      }),
    );
  });

  app.get("/v1/grants/utilization-certs/:id/validation-status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: ucId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uc = await ucRepo.findUcById(ucId, ctx.tenantId);
    if (!uc) {
      return reply.send({ data: { ucId, status: "pending", validatedBy: null, validatedAt: null } });
    }
    return reply.send({
      data: {
        ucId,
        status: uc.validationStatus,
        validatedBy: uc.validatedBy,
        validatedAt: uc.validatedAt ? uc.validatedAt.toISOString() : null,
        remarks: uc.validationRemarks,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
