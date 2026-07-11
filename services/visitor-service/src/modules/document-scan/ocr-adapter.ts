/**
 * visitor-service: document-scan OCR adapter with circuit breaker.
 *
 * Provides a unified OCR interface that tries cloud OCR first (configurable
 * provider via OCR_PROVIDER env) and falls back to local Tesseract when the
 * circuit breaker opens. The circuit breaker follows @civitasone/circuit-breaker
 * pattern: 5 failures in 60s → open for 30s → fallback to Tesseract.
 *
 * Env-gated:
 *   - OCR_PROVIDER: "tesseract" | "cloud" (default: "tesseract")
 *   - OCR_CLOUD_URL: cloud OCR endpoint URL
 *   - OCR_CLOUD_API_KEY: API key for cloud OCR provider
 *
 * Requirements validated: 6.3, 6.4, 6.7
 */
import { pino } from "pino";

const log = pino({ name: "document-scan-ocr-adapter" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured output from OCR extraction. */
export interface OcrExtraction {
  fullName: string | null;
  dateOfBirth: string | null;
  idDocumentNumber: string | null;
  idDocumentType: string | null;
  address: string | null;
  photoRegionKey: string | null;
  confidenceScores: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Circuit Breaker (inline — mirrors @civitasone/circuit-breaker pattern)
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  failures: number;
  lastFailureAt: number;
  openedAt: number | null;
  state: "closed" | "open" | "half_open";
}

const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60_000;   // 60 seconds
const OPEN_DURATION_MS = 30_000;    // 30 seconds

const circuitState: CircuitBreakerState = {
  failures: 0,
  lastFailureAt: 0,
  openedAt: null,
  state: "closed",
};

/** Check if circuit breaker allows a call through. */
function isCircuitOpen(): boolean {
  if (circuitState.state === "closed") return false;

  if (circuitState.state === "open") {
    const elapsed = Date.now() - (circuitState.openedAt ?? 0);
    if (elapsed >= OPEN_DURATION_MS) {
      // Transition to half_open — allow one probe request
      circuitState.state = "half_open";
      return false;
    }
    return true;
  }

  // half_open — allow the probe
  return false;
}

/** Record a successful call (resets the breaker). */
function recordSuccess(): void {
  circuitState.failures = 0;
  circuitState.lastFailureAt = 0;
  circuitState.openedAt = null;
  circuitState.state = "closed";
}

/** Record a failed call (may trip the breaker). */
function recordFailure(): void {
  const now = Date.now();

  // Reset failure count if outside the window
  if (now - circuitState.lastFailureAt > FAILURE_WINDOW_MS) {
    circuitState.failures = 0;
  }

  circuitState.failures++;
  circuitState.lastFailureAt = now;

  if (circuitState.failures >= FAILURE_THRESHOLD) {
    circuitState.state = "open";
    circuitState.openedAt = now;
    log.warn({ failures: circuitState.failures, event: "circuit_breaker_opened" },
      "OCR circuit breaker opened — falling back to Tesseract");
  }
}

/** Reset circuit breaker state (for testing). */
export function resetCircuitBreaker(): void {
  circuitState.failures = 0;
  circuitState.lastFailureAt = 0;
  circuitState.openedAt = null;
  circuitState.state = "closed";
}

/** Get current circuit breaker state (for testing/monitoring). */
export function getCircuitState(): { state: string; failures: number } {
  return { state: circuitState.state, failures: circuitState.failures };
}

// ---------------------------------------------------------------------------
// Cloud OCR Provider
// ---------------------------------------------------------------------------

async function callCloudOcr(imageBuffer: Buffer): Promise<OcrExtraction> {
  const url = process.env.OCR_CLOUD_URL;
  const apiKey = process.env.OCR_CLOUD_API_KEY;

  if (!url || !apiKey) {
    throw new Error("OCR_CLOUD_URL and OCR_CLOUD_API_KEY must be set for cloud OCR");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Authorization": `Bearer ${apiKey}`,
      "X-Content-Length": String(imageBuffer.length),
    },
    body: imageBuffer,
    signal: AbortSignal.timeout(10_000), // 10s timeout per tech.md
  });

  if (!response.ok) {
    throw new Error(`cloud OCR request failed with status ${response.status}`);
  }

  const raw: unknown = await response.json();
  return mapRawCloudResponse(raw);
}

/** Map raw cloud OCR response to structured OcrExtraction. */
function mapRawCloudResponse(raw: unknown): OcrExtraction {
  if (!raw || typeof raw !== "object") {
    return emptyExtraction();
  }

  const data = raw as Record<string, unknown>;
  const fields = (data.fields ?? data.result ?? data) as Record<string, unknown>;
  const scores = (data.confidence_scores ?? data.confidenceScores ?? {}) as Record<string, number>;

  return {
    fullName: extractString(fields, ["full_name", "fullName", "name"]),
    dateOfBirth: extractString(fields, ["date_of_birth", "dateOfBirth", "dob"]),
    idDocumentNumber: extractString(fields, ["id_document_number", "idDocumentNumber", "document_number", "id_number"]),
    idDocumentType: extractString(fields, ["id_document_type", "idDocumentType", "document_type"]),
    address: extractString(fields, ["address", "addr"]),
    photoRegionKey: extractString(fields, ["photo_region_key", "photoRegionKey", "photo_region"]),
    confidenceScores: typeof scores === "object" ? scores : {},
  };
}

// ---------------------------------------------------------------------------
// Local Tesseract Fallback
// ---------------------------------------------------------------------------

async function callTesseract(imageBuffer: Buffer): Promise<OcrExtraction> {
  // Tesseract local processing — uses child_process or native bindings.
  // In production this would invoke tesseract CLI or a Node.js binding.
  // For now, we simulate the extraction interface.
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng+hin");
    const { data } = await worker.recognize(imageBuffer);
    await worker.terminate();

    // Parse Tesseract raw text output into structured fields
    return parseTesseractOutput(data.text);
  } catch (err) {
    log.warn({ err, event: "tesseract_unavailable" },
      "Tesseract.js not available — returning empty extraction");
    return emptyExtraction();
  }
}

/** Parse raw Tesseract text output into structured fields. */
function parseTesseractOutput(text: string): OcrExtraction {
  // Basic heuristic parsing for Indian ID documents
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const scores: Record<string, number> = {};

  let fullName: string | null = null;
  let dateOfBirth: string | null = null;
  let idDocumentNumber: string | null = null;
  let address: string | null = null;

  for (const line of lines) {
    // Date pattern (DD/MM/YYYY or DD-MM-YYYY)
    const dateMatch = line.match(/(\d{2}[/-]\d{2}[/-]\d{4})/);
    if (dateMatch && !dateOfBirth) {
      dateOfBirth = dateMatch[1] ?? null;
      scores["date_of_birth"] = 70;
      continue;
    }

    // Aadhaar pattern (12 digits, possibly with spaces)
    const aadhaarMatch = line.match(/(\d{4}\s?\d{4}\s?\d{4})/);
    if (aadhaarMatch && !idDocumentNumber) {
      idDocumentNumber = aadhaarMatch[1]?.replace(/\s/g, "") ?? null;
      scores["id_document_number"] = 65;
      continue;
    }

    // PAN pattern (XXXXX1234X)
    const panMatch = line.match(/([A-Z]{5}\d{4}[A-Z])/);
    if (panMatch && !idDocumentNumber) {
      idDocumentNumber = panMatch[1] ?? null;
      scores["id_document_number"] = 70;
      continue;
    }

    // Name heuristic: first line with mostly alpha characters
    if (!fullName && /^[A-Za-z\s]{3,}$/.test(line) && line.length > 3) {
      fullName = line;
      scores["full_name"] = 60;
    }
  }

  // Address: remaining lines after document number
  const addressLines = lines.slice(Math.max(lines.length - 3, 0));
  if (addressLines.length > 0) {
    address = addressLines.join(", ");
    scores["address"] = 50;
  }

  return {
    fullName,
    dateOfBirth,
    idDocumentNumber,
    idDocumentType: null,
    address,
    photoRegionKey: null,
    confidenceScores: scores,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyExtraction(): OcrExtraction {
  return {
    fullName: null,
    dateOfBirth: null,
    idDocumentNumber: null,
    idDocumentType: null,
    address: null,
    photoRegionKey: null,
    confidenceScores: {},
  };
}

function extractString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Perform OCR on a document image buffer.
 *
 * Strategy:
 *   - If OCR_PROVIDER=tesseract → always use local Tesseract
 *   - If OCR_PROVIDER=cloud → try cloud first, fall back to Tesseract
 *     when the circuit breaker is open
 *
 * Circuit breaker: 5 failures / 60s → open for 30s → fallback to Tesseract.
 */
export async function performOcr(imageBuffer: Buffer): Promise<OcrExtraction> {
  const provider = process.env.OCR_PROVIDER ?? "tesseract";

  // If configured for Tesseract only, skip cloud entirely
  if (provider === "tesseract") {
    return callTesseract(imageBuffer);
  }

  // Cloud provider with circuit breaker fallback
  if (isCircuitOpen()) {
    log.info({ event: "ocr_circuit_open_fallback" }, "circuit open — using Tesseract fallback");
    return callTesseract(imageBuffer);
  }

  try {
    const result = await callCloudOcr(imageBuffer);
    recordSuccess();
    return result;
  } catch (err) {
    recordFailure();
    log.warn({ err, event: "cloud_ocr_failed" }, "cloud OCR failed — falling back to Tesseract");
    return callTesseract(imageBuffer);
  }
}
