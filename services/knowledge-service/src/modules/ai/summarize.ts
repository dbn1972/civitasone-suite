/**
 * Document Summarization — fetches document content and generates an LLM summary.
 *
 * Flow:
 *   1. Verify document exists and user has access (tenant-scoped)
 *   2. Fetch latest version content from S3 via @civitasone/storage
 *   3. Strip PII from content before sending to LLM
 *   4. Send sanitized content to Claude with summarization prompt (≤300 words)
 *   5. Return summary
 *
 * Returns 404 if document not found or user lacks permission
 * (same response for both to avoid revealing document existence).
 *
 * Validates: Requirements 20.4, 20.5, 20.7
 */

import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { documents } from "../documents/schema.js";
import { documentVersions } from "../versions/schema.js";
import { getObject } from "@civitasone/storage";
import { sendPrompt, AiAdapterError, CircuitBreakerOpenError } from "./adapter.js";
import { redactPii } from "./pii-redact.js";

// ── Types ─────────────────────────────────────────────────────────

export interface SummarizeResult {
  documentId: string;
  summary: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "DocumentNotFoundError";
  }
}

// ── System prompt ─────────────────────────────────────────────────

const SUMMARIZE_SYSTEM_PROMPT = `You are a document summarization assistant for CivitasOne, an enterprise ERP system used by government departments.

Summarize the following document content in 300 words or fewer. Focus on:
- Key facts and decisions
- Action items or obligations
- Important dates or deadlines
- Relevant entities or departments mentioned

Rules:
- Be concise and factual
- Do not hallucinate information not present in the document
- Do not include any personal information in the summary
- Use professional language appropriate for government documentation
- Keep the summary under 300 words`;

// ── Public API ────────────────────────────────────────────────────

/**
 * Summarize a document by ID.
 *
 * @param documentId - Document UUID
 * @param tenantId - Tenant UUID for scoping
 * @returns Summary result
 * @throws DocumentNotFoundError if document not found or user lacks access
 * @throws AiAdapterError on LLM failures
 * @throws CircuitBreakerOpenError when breaker is open
 */
export async function summarizeDocument(
  documentId: string,
  tenantId: string,
): Promise<SummarizeResult> {
  // Step 1: Verify document exists and belongs to tenant
  const docRows = await scopedRead((tx) =>
    tx.select().from(documents)
      .where(and(
        eq(documents.id, documentId),
        eq(documents.tenantId, tenantId),
      ))
      .limit(1)
  );

  if (docRows.length === 0) {
    throw new DocumentNotFoundError();
  }

  const doc = docRows[0]!;

  // Step 2: Get the latest version to find S3 key
  const versionRows = await scopedRead((tx) =>
    tx.select().from(documentVersions)
      .where(and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.tenantId, tenantId),
      ))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1)
  );

  if (versionRows.length === 0) {
    throw new DocumentNotFoundError();
  }

  const latestVersion = versionRows[0]!;

  // Step 3: Fetch content from S3
  let contentBuffer: Buffer;
  try {
    contentBuffer = await getObject(latestVersion.s3Key);
  } catch {
    // If content cannot be retrieved, treat as not found
    throw new DocumentNotFoundError();
  }

  const rawContent = contentBuffer.toString("utf-8");

  // Step 4: Strip PII before sending to LLM
  // Use document author as a known name for redaction
  const knownNames: string[] = [];
  if (doc.author) {
    knownNames.push(doc.author);
  }

  const { redactedText } = redactPii(rawContent, { names: knownNames });

  // Step 5: Send sanitized content to Claude for summarization
  // Truncate to reasonable size for LLM context (first 10K chars)
  const truncatedContent = redactedText.length > 10_000
    ? redactedText.slice(0, 10_000) + "\n\n[Content truncated for summarization]"
    : redactedText;

  const summary = await sendPrompt(
    SUMMARIZE_SYSTEM_PROMPT,
    `Please summarize the following document titled "${doc.title}":\n\n${truncatedContent}`,
    { maxTokens: 512 },
  );

  return { documentId, summary };
}
