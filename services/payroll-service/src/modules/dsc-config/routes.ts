/**
 * DSC Config Routes — manage per-tenant digital signature certificate configuration.
 *
 * - GET  /v1/payroll/dsc-config — returns cert metadata (CN, expiry, fingerprint), NO key material
 * - PUT  /v1/payroll/dsc-config — multipart: P12 file (base64) + passphrase → CQRS 202
 * - DELETE /v1/payroll/dsc-config — remove S3 object + enqueue DB delete → CQRS 202
 *
 * Auth: payroll_admin / super_admin
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateDscCertificate, DscValidationError } from "@civitasone/render";
import { putObject, deleteObject } from "@civitasone/storage";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["payroll_admin", "super_admin"];
const MAX_P12_SIZE = 10 * 1024; // 10 KB limit per requirement

const putBodySchema = z.object({
  /** Base64-encoded P12 file content */
  p12Base64: z.string().min(1, "p12Base64 is required"),
  /** Passphrase for the P12 keystore */
  passphrase: z.string().min(1, "passphrase is required"),
});

export async function dscConfigRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/payroll/dsc-config
   * Returns cert metadata for the tenant. NO key material exposed.
   */
  app.get("/v1/payroll/dsc-config", async (req) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const row = await repo.findByTenantId(ctx.tenantId);
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "no DSC configured for this tenant");
    }

    return {
      data: {
        subjectCn: row.subjectCn,
        serialNumber: row.serialNumber,
        notBefore: row.notBefore,
        notAfter: row.notAfter,
        sha256Fingerprint: row.sha256Fingerprint,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  });

  /**
   * PUT /v1/payroll/dsc-config
   * Validate + upload P12 to S3, then publish DB upsert command → 202.
   */
  app.put("/v1/payroll/dsc-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const body = putBodySchema.parse(req.body);

    // Decode P12 from base64
    const p12Buffer = Buffer.from(body.p12Base64, "base64");

    // Validate file size
    if (p12Buffer.length > MAX_P12_SIZE) {
      throw new HttpError(400, "VALIDATION_FAILED", `P12 file exceeds maximum size of ${MAX_P12_SIZE} bytes`);
    }

    if (p12Buffer.length === 0) {
      throw new HttpError(400, "VALIDATION_FAILED", "P12 file is empty");
    }

    // Validate P12 is parseable with given passphrase and cert is valid
    let certInfo;
    try {
      certInfo = validateDscCertificate(p12Buffer, body.passphrase);
    } catch (err: unknown) {
      if (err instanceof DscValidationError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw new HttpError(400, "DSC_INVALID", "failed to parse P12 keystore — check file and passphrase");
    }

    // Upload P12 to S3 (object store side-effect; durable DB write is via consumer)
    const storageRef = `dsc/${ctx.tenantId}/signing.p12`;
    await putObject(storageRef, p12Buffer, "application/x-pkcs12");

    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertDscConfig(ctx, {
      storageRef,
      passphrase: body.passphrase,
      subjectCn: certInfo.subjectCN,
      serialNumber: certInfo.serialNumber,
      notBefore: certInfo.notBefore.toISOString(),
      notAfter: certInfo.notAfter.toISOString(),
      sha256Fingerprint: certInfo.sha256Fingerprint,
    }));
  });

  /**
   * DELETE /v1/payroll/dsc-config
   * Remove S3 object, then publish DB delete command → 202.
   */
  app.delete("/v1/payroll/dsc-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const row = await repo.findByTenantId(ctx.tenantId);
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "no DSC configured for this tenant");
    }

    // Remove S3 object
    await deleteObject(row.storageRef);

    return sendAccepted(reply, acceptedResponseSchema, await commands.removeDscConfig(ctx));
  });

  // ── Error handler ──────────────────────────────────────────────────────────

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
    req.log.error({ err }, "unhandled error in dsc-config routes");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
