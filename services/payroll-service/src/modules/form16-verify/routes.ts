/**
 * Form 16 PDF Signature Verification Route.
 *
 * POST /v1/payroll/tax/form16/verify — accepts a PDF upload (raw body or base64 JSON),
 * extracts the PKCS#7 signature, validates against the embedded certificate chain.
 * Returns: { data: { valid, signerCN, signedAt, certificateExpiry, issues } }
 *
 * Auth: any authenticated user (no role restriction beyond being authenticated)
 * Max body size: 2 MB
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
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
    config: { rawBody: true },
    bodyLimit: MAX_PDF_SIZE,
  }, async (req) => {
    // Auth: any authenticated user
    resolveContext(req);

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
    req.log.error({ err }, "unhandled error in form16-verify routes");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
