/**
 * Document Intelligence — domain types and extraction logic.
 *
 * Defines the clause types, obligation structures, and response shapes
 * for AI-powered contract/legal document analysis.
 */

// ── Types ─────────────────────────────────────────────────────────

export type ClauseType =
  | "indemnity"
  | "termination"
  | "confidentiality"
  | "payment"
  | "liability"
  | "force_majeure"
  | "governing_law";

export interface ExtractedClause {
  type: ClauseType;
  text: string;
  confidence: number; // 0.0–1.0
}

export interface ExtractedObligation {
  description: string;
  responsibleParty: string;
  deadline: string | null; // ISO date or null if no explicit deadline
  confidence: number;
}

export interface ExtractedDeadline {
  description: string;
  date: string; // ISO date
  responsibleParty: string;
  confidence: number;
}

export interface CourtOrderMetadata {
  partyNames: string[];
  orderDate: string | null;
  nextHearingDate: string | null;
  directives: string[];
}

export interface ExtractionResult {
  clauses: ExtractedClause[];
  obligations: ExtractedObligation[];
  deadlines: ExtractedDeadline[];
  courtOrderMetadata?: CourtOrderMetadata;
}

// ── Constants ─────────────────────────────────────────────────────

/** Maximum document size in bytes for extracted text (100KB ≈ 50 pages) */
export const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024;

/** Valid clause types for classification */
export const VALID_CLAUSE_TYPES: ClauseType[] = [
  "indemnity",
  "termination",
  "confidentiality",
  "payment",
  "liability",
  "force_majeure",
  "governing_law",
];

// ── Prompts ───────────────────────────────────────────────────────

export const EXTRACTION_SYSTEM_PROMPT = `You are a legal document analysis assistant. Extract structured information from legal documents and contracts.

Your response MUST be valid JSON matching this schema:
{
  "clauses": [
    { "type": "<clause_type>", "text": "<clause text excerpt>", "confidence": <0.0-1.0> }
  ],
  "obligations": [
    { "description": "<obligation description>", "responsibleParty": "<party name>", "deadline": "<ISO date or null>", "confidence": <0.0-1.0> }
  ],
  "deadlines": [
    { "description": "<deadline description>", "date": "<ISO date>", "responsibleParty": "<party name>", "confidence": <0.0-1.0> }
  ],
  "courtOrderMetadata": {
    "partyNames": ["<party 1>", "<party 2>"],
    "orderDate": "<ISO date or null>",
    "nextHearingDate": "<ISO date or null>",
    "directives": ["<directive 1>", "<directive 2>"]
  }
}

Clause types MUST be one of: indemnity, termination, confidentiality, payment, liability, force_majeure, governing_law.

Rules:
- Extract ALL relevant clauses with their type classification
- For each obligation, identify the responsible party and any deadline
- For court orders, extract party names, order date, next hearing date, and directives
- Confidence scores reflect how certain you are about each extraction (0.0 = uncertain, 1.0 = certain)
- If the document is not a court order, omit courtOrderMetadata
- Return ONLY valid JSON, no markdown fences or explanation text`;

// ── Parsing ───────────────────────────────────────────────────────

/**
 * Parse the LLM response into a structured ExtractionResult.
 * Gracefully handles malformed responses with empty arrays.
 */
export function parseExtractionResponse(raw: string): ExtractionResult {
  try {
    // Strip potential markdown code fences
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const clauses = Array.isArray(parsed.clauses)
      ? (parsed.clauses as Array<Record<string, unknown>>)
          .filter((c) => isValidClause(c))
          .map((c) => ({
            type: c.type as ClauseType,
            text: String(c.text ?? ""),
            confidence: clampConfidence(Number(c.confidence ?? 0)),
          }))
      : [];

    const obligations = Array.isArray(parsed.obligations)
      ? (parsed.obligations as Array<Record<string, unknown>>)
          .filter((o) => typeof o.description === "string")
          .map((o) => ({
            description: String(o.description),
            responsibleParty: String(o.responsibleParty ?? "unknown"),
            deadline: typeof o.deadline === "string" ? o.deadline : null,
            confidence: clampConfidence(Number(o.confidence ?? 0)),
          }))
      : [];

    const deadlines = Array.isArray(parsed.deadlines)
      ? (parsed.deadlines as Array<Record<string, unknown>>)
          .filter((d) => typeof d.date === "string" && typeof d.description === "string")
          .map((d) => ({
            description: String(d.description),
            date: String(d.date),
            responsibleParty: String(d.responsibleParty ?? "unknown"),
            confidence: clampConfidence(Number(d.confidence ?? 0)),
          }))
      : [];

    const courtOrderMetadata = parseCourtOrderMetadata(parsed.courtOrderMetadata);

    return { clauses, obligations, deadlines, ...(courtOrderMetadata ? { courtOrderMetadata } : {}) };
  } catch {
    // Graceful fallback for unparseable LLM output
    return { clauses: [], obligations: [], deadlines: [] };
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function isValidClause(c: Record<string, unknown>): boolean {
  return (
    typeof c.type === "string" &&
    VALID_CLAUSE_TYPES.includes(c.type as ClauseType) &&
    typeof c.text === "string"
  );
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function parseCourtOrderMetadata(raw: unknown): CourtOrderMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const partyNames = Array.isArray(obj.partyNames)
    ? (obj.partyNames as unknown[]).filter((n): n is string => typeof n === "string")
    : [];

  if (partyNames.length === 0) return null;

  return {
    partyNames,
    orderDate: typeof obj.orderDate === "string" ? obj.orderDate : null,
    nextHearingDate: typeof obj.nextHearingDate === "string" ? obj.nextHearingDate : null,
    directives: Array.isArray(obj.directives)
      ? (obj.directives as unknown[]).filter((d): d is string => typeof d === "string")
      : [],
  };
}
