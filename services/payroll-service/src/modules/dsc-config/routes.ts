/**
 * DSC Config Routes — manage per-tenant digital signature certificate configuration.
 *
 * - GET  /v1/payroll/dsc-config — returns cert metadata (CN, expiry, fingerprint), NO key material
 * - PUT  /v1/payroll/dsc-config — multipart: P12 file (base64) + passphrase
 * - DELETE /v1/payroll/dsc-config — remove S3 object + DB row
 *
 * Auth: payroll_admin / super_admin
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateDscCertificate, DscValidationError } from "@civitasone/render";
import { putObject, deleteObject } from "@civitasone/storage";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["payroll_admin", "super_admin"];
const MAX_P12_SIZE = 10 * 1024; // 10 KB limit per requirement
const AUDIT_TOPIC = "audit.event.record";

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
   * Upload a P12 keystore (base64-encoded) + passphrase.
   * Validates the certificate, uploads P12 to S3, stores metadata in DB.
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

    // Upload P12 to S3
    const storageRef = `dsc/${ctx.tenantId}/signing.p12`;
    await putObject(storageRef, p12Buffer, "application/x-pkcs12");

    // Store metadata + encrypted passphrase in DB
    await repo.upsert(ctx.tenantId, {
      tenantId: ctx.tenantId,
      storageRef,
      passphrase: body.passphrase, // encryptedText column handles encryption transparently
      subjectCn: certInfo.subjectCN,
      serialNumber: certInfo.serialNumber,
      notBefore: certInfo.notBefore,
      notAfter: certInfo.notAfter,
      sha256Fingerprint: certInfo.sha256Fingerprint,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    // Emit audit event: dsc_config_updated (no private key material)
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "payroll",
          action: "dsc_config_updated",
          resourceType: "dsc_config",
          resourceId: ctx.tenantId,
          outcome: "success",
          detail: {
            subjectCN: certInfo.subjectCN,
            serialNumber: certInfo.serialNumber,
            sha256Fingerprint: certInfo.sha256Fingerprint,
            notAfter: certInfo.notAfter.toISOString(),
          },
        },
      });
    });

    return reply.status(200).send({
      data: {
        subjectCn: certInfo.subjectCN,
        serialNumber: certInfo.serialNumber,
        notBefore: certInfo.notBefore,
        notAfter: certInfo.notAfter,
        sha256Fingerprint: certInfo.sha256Fingerprint,
      },
    });
  });

  /**
   * DELETE /v1/payroll/dsc-config
   * Remove S3 object + DB row. Reverts tenant to unsigned mode.
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

    // Remove DB row
    await repo.remove(ctx.tenantId);

    // Emit audit event: dsc_config_deleted (no private key material)
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "payroll",
          action: "dsc_config_deleted",
          resourceType: "dsc_config",
          resourceId: ctx.tenantId,
          outcome: "success",
          detail: {
            subjectCN: row.subjectCn,
            serialNumber: row.serialNumber,
          },
        },
      });
    });

    return reply.status(200).send({ status: "ok" });
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
