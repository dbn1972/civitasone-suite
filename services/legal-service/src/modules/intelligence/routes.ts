/**
 * Document Intelligence routes — AI-powered clause extraction, obligation parsing,
 * and court order metadata extraction from legal documents.
 *
 * POST /v1/contract/documents/:id/extract
 *
 * Gated behind FEATURE_ML_ENABLED env var.
 * Returns 503 ML_UNAVAILABLE when circuit breaker is open or feature disabled.
 * Returns 413 DOCUMENT_TOO_LARGE when extracted text exceeds 100KB.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendPrompt, isEnabled, LlmAdapterError, CircuitBreakerOpenError } from "./adapter.js";
import { redactPii } from "./pii-redact.js";
import {
  EXTRACTION_SYSTEM_PROMPT,
  MAX_DOCUMENT_SIZE_BYTES,
  parseExtractionResponse,
} from "./domain.js";
import * as documentQueries from "../documents/queries.js";

// ── Validators ────────────────────────────────────────────────────

const extractParams = z.object({
  id: z.string().uuid(),
});

// ── Constants ─────────────────────────────────────────────────────

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

// ── Routes ────────────────────────────────────────────────────────

export async function intelligenceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/contract/documents/:id/extract
   *
   * Extract clauses, obligations, and deadlines from a legal document using LLM.
   * Applies PII redaction before sending text to the LLM.
   *
   * Returns 200 with { data: { clauses[], obligations[], deadlines[] } }
   * Returns 413 when document text exceeds 100KB
   * Returns 503 when feature disabled or circuit breaker open
   */
  app.post("/v1/contract/documents/:id/extract", async (req, reply) => {
    const correlationId = req.id;

    // Check feature flag first — return 503 ML_UNAVAILABLE when disabled
    if (!isEnabled()) {
      return reply.code(503).send({
        error: {
          code: "ML_UNAVAILABLE",
          message: "ML intelligence feature is not available",
          correlationId,
        },
      });
    }

    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);

    const { id } = extractParams.parse(req.params);

    // Fetch the document
    const doc = await documentQueries.getDocument(id, ctx.tenantId);
    if (!doc) {
      throw new HttpError(404, "NOT_FOUND", "document not found");
    }

    // Get document text content
    const documentText = doc.body ?? "";
    if (!documentText) {
      throw new HttpError(422, "NO_CONTENT", "document has no extractable text content");
    }

    // Check document size limit (100KB)
    const textSizeBytes = Buffer.byteLength(documentText, "utf-8");
    if (textSizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
      return reply.code(413).send({
        error: {
          code: "DOCUMENT_TOO_LARGE",
          message: `Document text exceeds maximum size of ${MAX_DOCUMENT_SIZE_BYTES} bytes (${textSizeBytes} bytes)`,
          correlationId,
        },
      });
    }

    // Apply PII redaction before sending to LLM
    const { redactedText } = redactPii(documentText);

    // Send to LLM for extraction
    try {
      const rawResponse = await sendPrompt(
        EXTRACTION_SYSTEM_PROMPT,
        `Please analyze the following legal document and extract all relevant clauses, obligations, and deadlines:\n\n${redactedText}`,
        { maxTokens: 4096 },
      );

      const result = parseExtractionResponse(rawResponse);

      return reply.code(200).send({ data: result });
    } catch (err: unknown) {
      if (err instanceof CircuitBreakerOpenError) {
        return reply.code(503).send({
          error: {
            code: "ML_UNAVAILABLE",
            message: "ML intelligence service is temporarily unavailable",
            correlationId,
          },
        });
      }

      if (err instanceof LlmAdapterError) {
        if (err.code === "ML_DISABLED") {
          return reply.code(503).send({
            error: {
              code: "ML_UNAVAILABLE",
              message: "ML intelligence feature is not available",
              correlationId,
            },
          });
        }

        req.log.error({ code: err.code, correlationId }, "LLM adapter error during document extraction");
        return reply.code(503).send({
          error: {
            code: "ML_UNAVAILABLE",
            message: "ML intelligence service encountered an error",
            correlationId,
          },
        });
      }

      throw err;
    }
  });
}
