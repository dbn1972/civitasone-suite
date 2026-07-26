/**
 * Document intelligence — classification (CAP-119).
 *
 * Classifies a document's text into one of a fixed set of governance categories.
 * Uses the LLM when `FEATURE_AI_ASSISTANT_ENABLED === 'true'`, and otherwise
 * (or on ANY LLM failure) falls back to a deterministic keyword classifier.
 * The keyword classifier is a real, self-contained scorer — not a stub — so
 * classification is always honest and available.
 */

import { sendPrompt, isEnabled, AiAdapterError, CircuitBreakerOpenError } from "./adapter.js";

export type ClassifyMethod = "llm" | "keyword";

export interface ClassifyResult {
  category: string;
  confidence: number;          // 0..1
  method: ClassifyMethod;
  scores: Record<string, number>;
}

/** Default governance category lexicon. */
export const DEFAULT_CATEGORIES: Record<string, string[]> = {
  finance: ["budget", "invoice", "payment", "expenditure", "audit", "fiscal", "grant", "disbursement", "ledger", "gst", "tax"],
  hr: ["employee", "recruitment", "leave", "salary", "promotion", "transfer", "appraisal", "attendance", "posting", "cadre"],
  legal: ["court", "petition", "judgment", "affidavit", "contract", "litigation", "statute", "clause", "compliance", "notice"],
  procurement: ["tender", "vendor", "bid", "purchase", "supplier", "quotation", "contract award", "rfp", "procure"],
  it: ["server", "software", "network", "database", "deployment", "api", "cyber", "portal", "system", "integration"],
  operations: ["schedule", "logistics", "maintenance", "inspection", "facility", "workflow", "operations", "field"],
  policy: ["policy", "guideline", "circular", "regulation", "framework", "directive", "scheme", "mandate", "governance"],
};

const TOKEN_RE = /[a-z][a-z0-9]+/g;

/**
 * Deterministic keyword classifier. Scores each category by the frequency of its
 * lexicon terms in the text (normalized), and returns the top category.
 */
export function classifyByKeywords(
  text: string,
  categories: Record<string, string[]> = DEFAULT_CATEGORIES,
): ClassifyResult {
  const lower = text.toLowerCase();
  const tokens = lower.match(TOKEN_RE) ?? [];
  const totalTokens = Math.max(tokens.length, 1);

  const scores: Record<string, number> = {};
  for (const [category, terms] of Object.entries(categories)) {
    let hits = 0;
    for (const term of terms) {
      if (term.includes(" ")) {
        // multi-word term: count substring occurrences
        let idx = lower.indexOf(term);
        while (idx !== -1) { hits++; idx = lower.indexOf(term, idx + term.length); }
      } else {
        for (const tok of tokens) if (tok === term) hits++;
      }
    }
    scores[category] = hits / totalTokens;
  }

  let best = "general";
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) { best = category; bestScore = score; }
  }

  // Confidence: best score relative to the sum of all scores (0 when no hits).
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = sum > 0 ? Number((bestScore / sum).toFixed(4)) : 0;

  return { category: bestScore > 0 ? best : "general", confidence, method: "keyword", scores };
}

const CLASSIFY_SYSTEM_PROMPT = `You are a document classification assistant for CivitasOne, a government ERP.
Classify the document into exactly ONE of these categories: {CATEGORIES}.
Respond with STRICT JSON only, no prose: {"category": "<one-of-the-categories>", "confidence": <0..1>}.
If none fit well, use "general".`;

/**
 * Classify a document. Prefers the LLM when enabled; deterministically falls
 * back to the keyword classifier on disablement or any LLM error.
 */
export async function classifyDocument(
  text: string,
  opts?: { categories?: Record<string, string[]> },
): Promise<ClassifyResult> {
  const categories = opts?.categories ?? DEFAULT_CATEGORIES;
  const names = [...Object.keys(categories), "general"];

  if (!isEnabled()) {
    return classifyByKeywords(text, categories);
  }

  try {
    const system = CLASSIFY_SYSTEM_PROMPT.replace("{CATEGORIES}", names.join(", "));
    const excerpt = text.length > 8000 ? text.slice(0, 8000) : text;
    const raw = await sendPrompt(system, `Classify this document:\n\n${excerpt}`, { maxTokens: 64 });
    const parsed = JSON.parse(extractJson(raw)) as { category?: string; confidence?: number };
    const category = parsed.category && names.includes(parsed.category) ? parsed.category : "general";
    const confidence = typeof parsed.confidence === "number" ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5;
    const scores = classifyByKeywords(text, categories).scores;
    return { category, confidence, method: "llm", scores };
  } catch (err) {
    // Circuit-open / disabled / API / parse errors → deterministic fallback.
    if (err instanceof CircuitBreakerOpenError || err instanceof AiAdapterError || err instanceof SyntaxError) {
      return classifyByKeywords(text, categories);
    }
    return classifyByKeywords(text, categories);
  }
}

/** Pull the first JSON object out of an LLM response that may wrap it in prose/fences. */
function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw;
}
