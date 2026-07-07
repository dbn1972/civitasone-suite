/**
 * Grievance auto-triage domain logic.
 *
 * Sends redacted grievance text to the AI adapter and parses the response
 * into a structured triage recommendation (category, priority, department).
 *
 * The recommendation is NEVER auto-applied — it requires explicit user confirmation.
 *
 * Validates: Requirements 20.6
 */

import { sendPrompt } from "./adapter.js";
import { redactPii } from "./pii-redact.js";

// ── Types ─────────────────────────────────────────────────────────

export interface TriageRecommendation {
  category: string;
  priority: string;
  department: string;
  confidence: number;
}

// ── System Prompt ─────────────────────────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a grievance triage assistant for a government citizen services platform.

Given a citizen grievance text, analyze it and produce a JSON recommendation with:
- category: one of "water", "electricity", "roads", "sanitation", "health", "education", "revenue", "housing", "transport", "environment", "law_and_order", "general"
- priority: one of "low", "medium", "high", "critical"
- department: the department name best suited to handle this grievance
- confidence: a number between 0.0 and 1.0 indicating your confidence in the triage

Respond ONLY with valid JSON, no explanation or markdown. Example:
{"category":"water","priority":"high","department":"Water Supply Department","confidence":0.85}

Rules:
- If the grievance mentions life-threatening conditions, assign priority "critical"
- If it mentions immediate health/safety risk, assign priority "high"
- If it mentions infrastructure damage, assign priority "medium"
- Default to priority "medium" when unclear
- Default confidence to 0.5 when uncertain about the classification`;

// ── Public API ────────────────────────────────────────────────────

/**
 * Analyze grievance text and produce a triage recommendation.
 *
 * The text is PII-redacted before being sent to the LLM.
 * Returns a structured recommendation that must be confirmed by a user.
 */
export async function triageGrievance(text: string): Promise<TriageRecommendation> {
  // Redact PII before sending to the LLM
  const redactedText = redactPii(text);

  const response = await sendPrompt(
    TRIAGE_SYSTEM_PROMPT,
    redactedText,
    256,
  );

  return parseTriageResponse(response);
}

/**
 * Parse the LLM response into a structured triage recommendation.
 * Falls back to sensible defaults if the response is malformed.
 */
export function parseTriageResponse(response: string): TriageRecommendation {
  const VALID_CATEGORIES = [
    "water", "electricity", "roads", "sanitation", "health",
    "education", "revenue", "housing", "transport", "environment",
    "law_and_order", "general",
  ];
  const VALID_PRIORITIES = ["low", "medium", "high", "critical"];

  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const category = typeof parsed.category === "string" && VALID_CATEGORIES.includes(parsed.category)
      ? parsed.category
      : "general";

    const priority = typeof parsed.priority === "string" && VALID_PRIORITIES.includes(parsed.priority)
      ? parsed.priority
      : "medium";

    const department = typeof parsed.department === "string" && parsed.department.length > 0
      ? parsed.department.slice(0, 200)
      : "General Administration";

    const confidence = typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
      ? Math.round(parsed.confidence * 100) / 100
      : 0.5;

    return { category, priority, department, confidence };
  } catch {
    // Fallback when JSON parsing fails
    return {
      category: "general",
      priority: "medium",
      department: "General Administration",
      confidence: 0.3,
    };
  }
}
