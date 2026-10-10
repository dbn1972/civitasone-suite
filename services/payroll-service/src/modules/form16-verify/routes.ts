/**
 * Form 16 PDF Signature Verification Route.
 *
 * POST /v1/payroll/tax/form16/verify — accepts a PDF upload (raw body or base64 JSON),
 * extracts the PKCS#7 signature, validates against the embedded certificate chain.
 * Returns: { data: { valid, signerCN, signedAt, certificateExpiry, issues } }
 *
 * Auth: STAFF_ROLES only (citizen / external principals get 403) + a per-user
 * rate limit (FORM16_VERIFY_MAX per minute, default 10) - the verifier parses
 * attacker-supplied PDF bytes, so it must not be open to every token.
 * Max body size: 2 MB
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { STAFF_ROLES } from "../../shared/roles.js";
import { verifyPdfSignature } from "@civitasone/render";

/** 2 MB limit for uploaded PDF */
const MAX_PDF_SIZE = 2 * 1024 * 1024;

/** Minimal PDF magic bytes: %PDF */
const PDF_MAGIC = Buffer.from("%PDF");

const jsonBodySchema = z.object({
  /** Base64-encoded PDF content */
  pdfBase64: z.string().min(1, "pdfBase64 is required"),
});

export async function form16VerifyRoutes(app: FastifyInstance): Promise<void> {
  // Register a raw content-type parser for application/pdf so Fastify passes
  // the raw buffer through without trying to parse it as JSON
  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  /**
   * POST /v1/payroll/tax/form16/verify
   *
   * Accepts either:
   * 1. Raw PDF body (Content-Type: application/pdf)
   * 2. JSON body with { pdfBase64: "<base64 encoded PDF>" }
   *
   * Returns verification result with signer metadata.
   */
  app.post("/v1/payroll/tax/form16/verify", {
    config: {
      rawBody: true,
      // Per-user bucket (own key prefix, NOT the shared 300/min actor bucket).
      rateLimit: {
        max: Number(process.env.FORM16_VERIFY_MAX ?? 10),
        timeWindow: "1 minute",
        allowList: [],
        keyGenerator: (req: { ip: string; ctx?: { actorId?: string } }) => `form16-verify:${req.ctx?.actorId ?? req.ip}`,
      },
    },
    bodyLimit: MAX_PDF_SIZE,
  }, async (req) => {
    // Auth: staff only - a citizen token is tenant-valid but must not reach the PDF verifier.
    const ctx = resolveContext(req);
    requireRole(ctx, STAFF_ROLES);

    let pdfBuffer: Buffer;

    const contentType = req.headers["content-type"] ?? "";

    if (contentType.startsWith("application/pdf")) {
      // Raw PDF body
      const rawBody = req.body;
      if (rawBody instanceof Buffer) {
        pdfBuffer = rawBody;
      } else if (typeof rawBody === "string") {
        pdfBuffer = Buffer.from(rawBody, "binary");
      } else {
        throw new HttpError(400, "INVALID_FORMAT", "expected raw PDF body when Content-Type is application/pdf");
      }
    } else {
      // JSON body with base64-encoded PDF
      const body = jsonBodySchema.parse(req.body);
      pdfBuffer = Buffer.from(body.pdfBase64, "base64");
    }

    // Validate size
    if (pdfBuffer.length === 0) {
      throw new HttpError(400, "INVALID_FORMAT", "empty PDF body");
    }

    if (pdfBuffer.length > MAX_PDF_SIZE) {
      throw new HttpError(400, "INVALID_FORMAT", "PDF exceeds maximum size of 2 MB");
    }

    // Validate PDF magic bytes
    if (!pdfBuffer.subarray(0, 4).equals(PDF_MAGIC)) {
      throw new HttpError(400, "INVALID_FORMAT", "uploaded file is not a valid PDF");
    }

    // Verify the signature
    const result = verifyPdfSignature(pdfBuffer);

    return {
      data: {
        valid: result.valid,
        signerCN: result.signerCN ?? null,
        signedAt: result.signedAt ?? null,
        certificateExpiry: result.certificateExpiry ?? null,
        issues: result.issues,
      },
    };
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
    // @fastify/rate-limit (registerRateLimit's errorResponseBuilder) throws a plain object
    // carrying statusCode 429; this plugin-scoped handler would otherwise turn it into a 500.
    if ((err as { statusCode?: number } | null)?.statusCode === 429) {
      const rl = err as { message?: string; retryAfter?: number };
      void reply.code(429).send({ code: "TOO_MANY_REQUESTS", message: rl.message ?? "rate limit exceeded", correlationId, retryable: true, ...(rl.retryAfter ? { retryAfter: rl.retryAfter } : {}) });
      return;
    }
    req.log.error({ err }, "unhandled error in form16-verify routes");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
