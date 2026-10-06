/**
 * Pure mapping helpers for the AI guardrails screen
 * (GAP-AI-GUARDRAILS-02 / GAP-AI-GUARDRAILS-03).
 *
 * The generic ModuleListPage mapper guesses Detail/Meta from whichever field
 * exists first, so the same column could show a status word on one row and a
 * timestamp on the next, and the 8-char id truncation lost the full id. These
 * typed rules map the REAL fields ai-agent-service returns for a guardrail
 * rule (name, ruleType, severity, status, pattern) into stable columns.
 *
 * NOTE on "action"/"scope": the service's guardrail_rules table has no
 * dedicated action (block/redact) or scope column — the behaviour is implied
 * by `ruleType` (pii | profanity | prompt_injection | topic_block |
 * max_length). Rather than invent columns the backend does not provide, this
 * surfaces the rule *type* (what it checks) and keeps the honest field set.
 */

export type GuardrailRuleType =
  | "pii"
  | "profanity"
  | "prompt_injection"
  | "topic_block"
  | "max_length";

export type GuardrailSeverity = "low" | "medium" | "high" | "critical";

export interface GuardrailRule {
  id: string;
  name: string;
  ruleType: string;
  pattern: string | null;
  severity: string;
  status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return null;
}

/** Map the guardrails/rules response into typed rows; null if not a list. */
export function mapGuardrailRules(payload: unknown): GuardrailRule[] | null {
  const list = rows(payload);
  if (!list) return null;
  const mapped: GuardrailRule[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    const ruleType = toText(row.ruleType);
    if (!id || !name || !ruleType) continue;
    mapped.push({
      id,
      name,
      ruleType,
      pattern: toText(row.pattern),
      severity: toText(row.severity) ?? "medium",
      status: toText(row.status) ?? "active",
    });
  }
  return mapped;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  pii: "PII redaction",
  profanity: "Profanity filter",
  prompt_injection: "Prompt-injection block",
  topic_block: "Topic block",
  max_length: "Length limit",
};

/** Human label for a rule type; falls back to a readable form of the raw value. */
export function ruleTypeLabel(ruleType: string): string {
  return (
    RULE_TYPE_LABELS[ruleType] ??
    ruleType
      .split(/[\s_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}
