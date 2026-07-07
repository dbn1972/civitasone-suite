/**
 * Enhanced citizen request routing domain logic.
 *
 * Implements multi-label classification, sentiment detection, urgency scoring,
 * complaint clustering (text similarity > 0.80), and resolution template
 * recommendations from historically-resolved complaints.
 *
 * Uses the existing Anthropic Claude adapter with PII redaction.
 * Falls back to keyword-based triage logic when LLM is unavailable.
 *
 * All recommendations are ADVISORY-ONLY — never auto-applied.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
 */

import { sendPrompt, isEnabled, AiAdapterError, CircuitBreakerOpenError } from "../ai/adapter.js";
import { redactPii } from "../ai/pii-redact.js";

// ── Types ─────────────────────────────────────────────────────────

export type Sentiment = "positive" | "neutral" | "negative";
export type Urgency = "low" | "medium" | "high" | "critical";

export interface CategoryClassification {
  category: string;
  confidence: number;
}

export interface SimilarComplaint {
  requestId: string;
  similarity: number;
  summary: string;
}

export interface ResolutionSuggestion {
  templateId: string;
  title: string;
  confidence: number;
}

export interface RoutingResult {
  categories: CategoryClassification[];
  sentiment: Sentiment;
  urgency: Urgency;
  similarComplaints: SimilarComplaint[];
  resolutionSuggestions: ResolutionSuggestion[];
  advisory: true;
  isFallback: boolean;
}

// ── Constants ─────────────────────────────────────────────────────

export const VALID_CATEGORIES = [
  "water", "electricity", "roads", "sanitation", "health",
  "education", "revenue", "housing", "transport", "environment",
  "law_and_order", "general", "public_safety", "taxation",
  "infrastructure", "social_welfare",
] as const;

const VALID_SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
const VALID_URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];

/** Similarity threshold for linking complaints. */
const SIMILARITY_THRESHOLD = 0.80;

// ── System Prompts ────────────────────────────────────────────────

const ROUTING_SYSTEM_PROMPT = `You are a citizen request routing assistant for a government services platform.

Given a citizen request text, produce a JSON analysis with:
- categories: array of { category, confidence } — multi-label classification from this taxonomy: water, electricity, roads, sanitation, health, education, revenue, housing, transport, environment, law_and_order, general, public_safety, taxation, infrastructure, social_welfare. Include all relevant categories with confidence 0.0-1.0. Minimum 1, maximum 3 categories.
- sentiment: one of "positive", "neutral", "negative"
- urgency: one of "low", "medium", "high", "critical"

Classification rules:
- "critical" urgency: life-threatening, immediate danger, public safety emergency
- "high" urgency: health/safety risk, service outage affecting many, infrastructure failure
- "medium" urgency: standard complaints, routine service requests
- "low" urgency: suggestions, feedback, minor inconveniences
- Sentiment reflects the citizen's emotional tone (frustration = negative, gratitude = positive, neutral = factual)

Respond ONLY with valid JSON, no explanation or markdown. Example:
{"categories":[{"category":"water","confidence":0.92},{"category":"infrastructure","confidence":0.65}],"sentiment":"negative","urgency":"high"}`;

// ── Keyword Fallback ──────────────────────────────────────────────

const KEYWORD_MAP: Record<string, string[]> = {
  water: ["water", "pipe", "drainage", "sewage", "flood", "tap", "supply", "leak", "bore", "well"],
  electricity: ["electricity", "power", "outage", "blackout", "voltage", "transformer", "meter", "wiring", "electric"],
  roads: ["road", "pothole", "highway", "bridge", "traffic", "pavement", "footpath", "signal"],
  sanitation: ["garbage", "waste", "dump", "cleanliness", "sweeping", "toilet", "drain", "sanitation"],
  health: ["hospital", "clinic", "medicine", "doctor", "health", "ambulance", "disease", "infection", "epidemic"],
  education: ["school", "college", "teacher", "student", "education", "exam", "scholarship", "library"],
  revenue: ["tax", "property", "land", "revenue", "registration", "mutation", "encroachment"],
  housing: ["house", "building", "construction", "permit", "colony", "flat", "apartment", "shelter"],
  transport: ["bus", "train", "auto", "vehicle", "parking", "license", "permit", "metro"],
  environment: ["pollution", "noise", "air", "tree", "forest", "green", "environment", "smoke"],
  law_and_order: ["crime", "police", "theft", "assault", "harassment", "safety", "violence", "drug"],
  public_safety: ["fire", "accident", "emergency", "collapse", "danger", "hazard"],
  infrastructure: ["construction", "develop", "project", "repair", "maintenance", "infra"],
  social_welfare: ["pension", "benefit", "scheme", "subsidy", "ration", "welfare", "disability"],
};

const URGENCY_KEYWORDS: Record<Urgency, string[]> = {
  critical: ["death", "dying", "life-threatening", "emergency", "collapse", "fire", "explosion", "trapped"],
  high: ["danger", "flood", "outbreak", "outage", "blocked", "overflow", "health risk", "immediate"],
  medium: ["broken", "damaged", "complaint", "problem", "issue", "not working", "pending"],
  low: ["suggestion", "feedback", "request", "enquiry", "information", "minor"],
};

const NEGATIVE_KEYWORDS = ["angry", "frustrated", "upset", "terrible", "worst", "pathetic", "useless", "neglect", "ignored", "suffering", "harassed", "cheated"];
const POSITIVE_KEYWORDS = ["thank", "grateful", "appreciate", "good", "excellent", "helpful", "resolved", "satisfied"];

// ── Public API ────────────────────────────────────────────────────

/**
 * Compute routing recommendations for a citizen request.
 *
 * Uses LLM when available, falls back to keyword-based triage.
 * PII is redacted before sending to the LLM.
 * All results are advisory-only.
 */
export async function computeRouting(
  text: string,
  existingComplaints: Array<{ id: string; text: string; summary: string }>,
  resolvedTemplates: Array<{ id: string; title: string; text: string }>,
): Promise<RoutingResult> {
  const redactedText = redactPii(text);

  let categories: CategoryClassification[];
  let sentiment: Sentiment;
  let urgency: Urgency;
  let isFallback = false;

  // Attempt LLM classification; fall back to keywords if unavailable
  if (isEnabled()) {
    try {
      const llmResult = await classifyWithLlm(redactedText);
      categories = llmResult.categories;
      sentiment = llmResult.sentiment;
      urgency = llmResult.urgency;
    } catch (err) {
      if (
        err instanceof AiAdapterError ||
        err instanceof CircuitBreakerOpenError
      ) {
        // Graceful fallback to keyword-based triage
        const fallbackResult = classifyWithKeywords(redactedText);
        categories = fallbackResult.categories;
        sentiment = fallbackResult.sentiment;
        urgency = fallbackResult.urgency;
        isFallback = true;
      } else {
        throw err;
      }
    }
  } else {
    // Feature disabled — use keyword fallback
    const fallbackResult = classifyWithKeywords(redactedText);
    categories = fallbackResult.categories;
    sentiment = fallbackResult.sentiment;
    urgency = fallbackResult.urgency;
    isFallback = true;
  }

  // Compute complaint similarity clustering
  const similarComplaints = findSimilarComplaints(redactedText, existingComplaints);

  // Recommend resolution templates
  const resolutionSuggestions = recommendResolutions(redactedText, resolvedTemplates);

  return {
    categories,
    sentiment,
    urgency,
    similarComplaints,
    resolutionSuggestions,
    advisory: true,
    isFallback,
  };
}

// ── LLM Classification ────────────────────────────────────────────

interface LlmClassificationResult {
  categories: CategoryClassification[];
  sentiment: Sentiment;
  urgency: Urgency;
}

async function classifyWithLlm(redactedText: string): Promise<LlmClassificationResult> {
  const response = await sendPrompt(ROUTING_SYSTEM_PROMPT, redactedText, 512);
  return parseLlmRoutingResponse(response);
}

/**
 * Parse the LLM routing response into structured data.
 * Falls back to keyword-based classification if response is malformed.
 */
export function parseLlmRoutingResponse(response: string): LlmClassificationResult {
  try {
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    // Validate categories
    let categories: CategoryClassification[] = [];
    if (Array.isArray(parsed.categories)) {
      categories = (parsed.categories as Array<Record<string, unknown>>)
        .filter(
          (c) =>
            typeof c.category === "string" &&
            VALID_CATEGORIES.includes(c.category as typeof VALID_CATEGORIES[number]) &&
            typeof c.confidence === "number" &&
            c.confidence >= 0 &&
            c.confidence <= 1,
        )
        .map((c) => ({
          category: c.category as string,
          confidence: Math.round((c.confidence as number) * 100) / 100,
        }))
        .slice(0, 3);
    }

    if (categories.length === 0) {
      categories = [{ category: "general", confidence: 0.5 }];
    }

    // Validate sentiment
    const sentiment: Sentiment =
      typeof parsed.sentiment === "string" &&
      VALID_SENTIMENTS.includes(parsed.sentiment as Sentiment)
        ? (parsed.sentiment as Sentiment)
        : "neutral";

    // Validate urgency
    const urgency: Urgency =
      typeof parsed.urgency === "string" &&
      VALID_URGENCIES.includes(parsed.urgency as Urgency)
        ? (parsed.urgency as Urgency)
        : "medium";

    return { categories, sentiment, urgency };
  } catch {
    // Fallback: if LLM response is not parseable, return defaults
    return {
      categories: [{ category: "general", confidence: 0.3 }],
      sentiment: "neutral",
      urgency: "medium",
    };
  }
}

// ── Keyword-Based Fallback ────────────────────────────────────────

interface KeywordClassificationResult {
  categories: CategoryClassification[];
  sentiment: Sentiment;
  urgency: Urgency;
}

/**
 * Keyword-based triage logic — used when LLM adapter is unavailable.
 * Matches text against keyword dictionaries for classification.
 */
export function classifyWithKeywords(text: string): KeywordClassificationResult {
  const lower = text.toLowerCase();

  // Multi-label category classification via keyword matching
  const categoryScores: Array<{ category: string; score: number }> = [];
  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    const matchCount = keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount > 0) {
      const confidence = Math.min(0.4 + matchCount * 0.15, 0.85);
      categoryScores.push({ category, score: confidence });
    }
  }

  // Sort by score descending, take top 3
  categoryScores.sort((a, b) => b.score - a.score);
  const categories: CategoryClassification[] = categoryScores.length > 0
    ? categoryScores.slice(0, 3).map((c) => ({ category: c.category, confidence: c.score }))
    : [{ category: "general", confidence: 0.4 }];

  // Sentiment detection via keyword presence
  const negativeCount = NEGATIVE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  const positiveCount = POSITIVE_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  let sentiment: Sentiment = "neutral";
  if (negativeCount > positiveCount) sentiment = "negative";
  else if (positiveCount > negativeCount) sentiment = "positive";

  // Urgency scoring via keyword matching (highest match wins)
  let urgency: Urgency = "medium";
  for (const level of ["critical", "high", "medium", "low"] as Urgency[]) {
    const hasMatch = URGENCY_KEYWORDS[level].some((kw) => lower.includes(kw));
    if (hasMatch) {
      urgency = level;
      break;
    }
  }

  return { categories, sentiment, urgency };
}

// ── Text Similarity (Cosine via term frequency) ───────────────────

/**
 * Compute cosine similarity between two text strings using TF vectors.
 * Returns value in [0.0, 1.0].
 */
export function computeTextSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  // Build term frequency vectors
  const allTerms = new Set([...tokensA, ...tokensB]);
  const vecA: number[] = [];
  const vecB: number[] = [];

  const freqA = termFrequency(tokensA);
  const freqB = termFrequency(tokensB);

  for (const term of allTerms) {
    vecA.push(freqA.get(term) ?? 0);
    vecB.push(freqB.get(term) ?? 0);
  }

  // Cosine similarity
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i] ?? 0;
    const b = vecB[i] ?? 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

// ── Complaint Clustering ──────────────────────────────────────────

/**
 * Find similar complaints above the similarity threshold (0.80).
 * Returns at most 5 similar complaints, sorted by similarity descending.
 */
export function findSimilarComplaints(
  requestText: string,
  existingComplaints: Array<{ id: string; text: string; summary: string }>,
): SimilarComplaint[] {
  const results: SimilarComplaint[] = [];

  for (const complaint of existingComplaints) {
    const similarity = computeTextSimilarity(requestText, complaint.text);
    if (similarity > SIMILARITY_THRESHOLD) {
      results.push({
        requestId: complaint.id,
        similarity: Math.round(similarity * 100) / 100,
        summary: complaint.summary.slice(0, 200),
      });
    }
  }

  // Sort by similarity descending, cap at 5
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, 5);
}

// ── Resolution Template Recommendations ───────────────────────────

/**
 * Recommend resolution templates from historically-resolved complaints.
 * Returns top 3 by similarity with confidence scores.
 */
export function recommendResolutions(
  requestText: string,
  resolvedTemplates: Array<{ id: string; title: string; text: string }>,
): ResolutionSuggestion[] {
  const scored: Array<{ templateId: string; title: string; confidence: number }> = [];

  for (const template of resolvedTemplates) {
    const similarity = computeTextSimilarity(requestText, template.text);
    if (similarity > 0.3) {
      scored.push({
        templateId: template.id,
        title: template.title.slice(0, 200),
        confidence: Math.round(similarity * 100) / 100,
      });
    }
  }

  // Sort by confidence descending, return top 3
  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, 3);
}
