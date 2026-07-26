/**
 * AI Assistant routes — env-gated behind FEATURE_AI_ASSISTANT_ENABLED.
 *
 * When disabled: all routes return 404 (hide functionality completely).
 * When circuit breaker is open: returns 503.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import {
  sendPrompt,
  isEnabled,
  AiAdapterError,
  CircuitBreakerOpenError,
} from "./adapter.js";
import { translateAndSearch } from "./nl-search.js";
import { summarizeDocument, DocumentNotFoundError } from "./summarize.js";
import { classifyDocument } from "./classify.js";

// ── Request schemas ───────────────────────────────────────────────

const promptBodySchema = z.object({
  system: z.string().min(1).max(2000),
  userMessage: z.string().min(1).max(5000),
  maxTokens: z.number().int().min(1).max(4096).optional(),
});

const nlSearchBodySchema = z.object({
  query: z.string().min(1).max(500),
});

const summarizeBodySchema = z.object({
  documentId: z.string().uuid(),
});

const classifyBodySchema = z.object({
  text: z.string().min(1).max(50000),
  categories: z.record(z.array(z.string().min(1).max(64)).min(1)).optional(),
});

// ── Route registration ────────────────────────────────────────────

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/knowledge/ai/prompt
   *
   * Send a prompt to the AI assistant.
   * Returns 404 when FEATURE_AI_ASSISTANT_ENABLED !== 'true'.
   * Returns 503 when circuit breaker is open.
   * Returns 200 with { data: { response: string } } on success.
   */
  app.post("/v1/knowledge/ai/prompt", async (req, reply) => {
    // Gate check: return 404 to completely hide AI functionality
    if (!isEnabled()) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Not found",
          correlationId: req.id,
        },
      });
    }

    const ctx = resolveContext(req);

    const parseResult = promptBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    const { system, userMessage, maxTokens } = parseResult.data;

    try {
      const response = await sendPrompt(system, userMessage, maxTokens !== undefined ? { maxTokens } : undefined);
      return reply.code(200).send({ data: { response } });
    } catch (err) {
      if (err instanceof AiAdapterError && err.code === "AI_DISABLED") {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Not found",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "AI service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError && err.code === "AI_TIMEOUT") {
        req.log.warn({ code: err.code }, "Anthropic API timeout");
        return reply.code(503).send({
          error: {
            code: "AI_TIMEOUT",
            message: "AI service request timed out",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError) {
        req.log.error({ code: err.code, httpStatus: err.httpStatus }, "Anthropic API error");
        return reply.code(503).send({
          error: {
            code: "AI_UNAVAILABLE",
            message: "AI features are temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });

  /**
   * POST /v1/knowledge/ai/search
   *
   * Natural-language search translation.
   * Accepts a NL query (≤500 chars), translates to structured search via Claude,
   * then executes against @civitasone/search and returns module-scoped results.
   *
   * Returns 404 when FEATURE_AI_ASSISTANT_ENABLED !== 'true'.
   * Returns 400 when query exceeds 500 chars or is empty.
   * Returns 503 when circuit breaker is open or AI times out.
   * Returns 504 when total operation exceeds 5s deadline.
   * Returns 200 with { data: { intent, results } } on success.
   *
   * Validates: Requirements 20.3
   */
  app.post("/v1/knowledge/ai/search", async (req, reply) => {
    // Gate check: return 404 to completely hide AI functionality
    if (!isEnabled()) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Not found",
          correlationId: req.id,
        },
      });
    }

    const ctx = resolveContext(req);

    const parseResult = nlSearchBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Query must be between 1 and 500 characters",
          details: parseResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    const { query } = parseResult.data;

    // 5-second deadline for the entire operation
    const deadline = AbortSignal.timeout(5000);

    try {
      const resultPromise = translateAndSearch(query, ctx.tenantId);

      // Race the search against the 5s deadline
      const result = await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) => {
          deadline.addEventListener("abort", () => {
            reject(new Error("DEADLINE_EXCEEDED"));
          });
        }),
      ]);

      return reply.code(200).send({ data: result });
    } catch (err) {
      if (err instanceof Error && err.message === "DEADLINE_EXCEEDED") {
        return reply.code(504).send({
          error: {
            code: "TIMEOUT",
            message: "Search operation exceeded 5 second deadline",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError && err.code === "AI_DISABLED") {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Not found",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "AI service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError && err.code === "AI_TIMEOUT") {
        req.log.warn({ code: err.code }, "NL search: Anthropic API timeout");
        return reply.code(503).send({
          error: {
            code: "AI_TIMEOUT",
            message: "AI service request timed out",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError) {
        req.log.error({ code: err.code, httpStatus: err.httpStatus }, "NL search: Anthropic API error");
        return reply.code(503).send({
          error: {
            code: "AI_UNAVAILABLE",
            message: "AI features are temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });

  /**
   * POST /v1/knowledge/ai/summarize
   *
   * Document summarization with PII redaction.
   * Accepts a document ID, fetches content, strips PII, and generates ≤300 word summary.
   *
   * Returns 404 when FEATURE_AI_ASSISTANT_ENABLED !== 'true'.
   * Returns 404 when document not found or user lacks permission.
   * Returns 400 when documentId is not a valid UUID.
   * Returns 503 when circuit breaker is open or AI times out.
   * Returns 200 with { data: { documentId, summary } } on success.
   *
   * Validates: Requirements 20.4, 20.5, 20.7
   */
  app.post("/v1/knowledge/ai/summarize", async (req, reply) => {
    // Gate check: return 404 to completely hide AI functionality
    if (!isEnabled()) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Not found",
          correlationId: req.id,
        },
      });
    }

    const ctx = resolveContext(req);

    const parseResult = summarizeBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    const { documentId } = parseResult.data;

    try {
      const result = await summarizeDocument(documentId, ctx.tenantId);
      return reply.code(200).send({ data: result });
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Document not found",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError && err.code === "AI_DISABLED") {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Not found",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof CircuitBreakerOpenError) {
        return reply.code(503).send({
          error: {
            code: "CIRCUIT_OPEN",
            message: "AI service is temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError && err.code === "AI_TIMEOUT") {
        req.log.warn({ code: err.code }, "Summarize: Anthropic API timeout");
        return reply.code(503).send({
          error: {
            code: "AI_TIMEOUT",
            message: "AI service request timed out",
            correlationId: req.id,
          },
        });
      }

      if (err instanceof AiAdapterError) {
        req.log.error({ code: err.code, httpStatus: err.httpStatus }, "Summarize: Anthropic API error");
        return reply.code(503).send({
          error: {
            code: "AI_UNAVAILABLE",
            message: "AI features are temporarily unavailable",
            correlationId: req.id,
          },
        });
      }

      throw err;
    }
  });

  /**
   * POST /v1/knowledge/ai/classify
   *
   * Document intelligence — classify document text into a governance category.
   * Uses the LLM when enabled, and a deterministic keyword classifier otherwise
   * or on any LLM failure, so classification is ALWAYS available and honest.
   *
   * Returns 400 on invalid body. Returns 200 with { data: { category, confidence,
   * method, scores } } on success.
   *
   * Validates: CAP-119 (document intelligence / classification).
   */
  app.post("/v1/knowledge/ai/classify", async (req, reply) => {
    resolveContext(req);

    const parseResult = classifyBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.flatten(),
          correlationId: req.id,
        },
      });
    }

    const { text, categories } = parseResult.data;
    const result = await classifyDocument(text, categories ? { categories } : undefined);
    return reply.code(200).send({ data: result });
  });
}
