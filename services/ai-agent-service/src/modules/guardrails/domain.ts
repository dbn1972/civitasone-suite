/**
 * guardrails/domain.ts — deterministic, rule-based AI safety checks.
 *
 * Pure functions only: no IO, no network, no LLM calls. Every decision here is
 * reproducible, which is what makes the audit trail defensible.
 *
 * DPDP Act 2023: detected personal data must never be logged or persisted raw.
 * Callers persist `sanitizedInput` (see evaluateRules) — never the original text.
 */

export type PiiType = "email" | "phone" | "pan" | "aadhaar" | "ifsc" | "credit_card";

export interface PiiFinding {
  type: PiiType;
  match: string;
  start: number;
  end: number;
}

/**
 * Detection order matters: the widest/most specific patterns run first and
 * later overlapping matches are discarded, so a 16-digit card is not also
 * reported as an Aadhaar or a phone number.
 */
const PII_PATTERNS: ReadonlyArray<{ type: PiiType; regex: RegExp }> = [
  { type: "email", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { type: "pan", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { type: "ifsc", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { type: "credit_card", regex: /\b(?:\d{4}[ -]?){3}\d{1,4}\b/g },
  { type: "aadhaar", regex: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  { type: "phone", regex: /(?:\+91[ -]?)?\b[6-9]\d{9}\b/g },
];

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Find personal data in free text. Returns findings ordered by position. */
export function detectPii(text: string): PiiFinding[] {
  if (!text) return [];
  const findings: PiiFinding[] = [];

  for (const { type, regex } of PII_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0];
      if (raw.length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const candidate: PiiFinding = { type, match: raw, start: m.index, end: m.index + raw.length };
      if (!findings.some((f) => overlaps(f, candidate))) {
        findings.push(candidate);
      }
    }
  }

  return findings.sort((a, b) => a.start - b.start);
}

/** Replace each finding with `[REDACTED:TYPE]`. Non-destructive on the input. */
export function redactPii(text: string, findings: PiiFinding[]): string {
  if (findings.length === 0) return text;
  const ordered = [...findings].sort((a, b) => b.start - a.start);
  let out = text;
  for (const f of ordered) {
    if (f.start < 0 || f.end > out.length || f.start >= f.end) continue;
    out = `${out.slice(0, f.start)}[REDACTED:${f.type.toUpperCase()}]${out.slice(f.end)}`;
  }
  return out;
}

export interface PromptInjectionResult {
  detected: boolean;
  matches: string[];
}

const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+instructions?/gi,
  /disregard\s+(?:the\s+)?(?:above|previous|prior)(?:\s+instructions?)?/gi,
  /you\s+are\s+now\b/gi,
  /system\s+prompt/gi,
  /reveal\s+(?:your|the)\s+(?:instructions?|system\s+prompt)/gi,
];

/** Heuristic prompt-injection detector. Returns the phrases that matched. */
export function detectPromptInjection(text: string): PromptInjectionResult {
  if (!text) return { detected: false, matches: [] };
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push(m[0]);
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return { detected: matches.length > 0, matches };
}

export interface MaxLengthResult {
  passed: boolean;
  length: number;
  max: number;
}

/** Length gate. A non-positive `max` is treated as "no limit configured" → passes. */
export function checkMaxLength(text: string, max: number): MaxLengthResult {
  const length = text.length;
  if (!Number.isFinite(max) || max <= 0) return { passed: true, length, max };
  return { passed: length <= max, length, max };
}

export type RuleType = "pii" | "profanity" | "prompt_injection" | "topic_block" | "max_length";
export type Severity = "low" | "medium" | "high" | "critical";

export const RULE_TYPES: readonly RuleType[] = ["pii", "profanity", "prompt_injection", "topic_block", "max_length"];
export const SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"];
/** Rule types whose match is driven by a caller-supplied regex `pattern`. */
export const REGEX_RULE_TYPES: readonly RuleType[] = ["profanity", "topic_block"];

export interface GuardrailRule {
  id: string;
  name?: string;
  ruleType: string;
  pattern?: string | null;
  config?: Record<string, unknown> | null;
  severity: string;
}

export interface Violation {
  ruleId: string;
  ruleType: string;
  severity: string;
  message: string;
}

export interface EvaluationResult {
  passed: boolean;
  violations: Violation[];
  sanitizedInput: string;
}

function isBlocking(severity: string): boolean {
  return severity === "critical" || severity === "high";
}

function matchPattern(text: string, pattern: string | null | undefined): string[] {
  if (!pattern) return [];
  let re: RegExp;
  try {
    re = new RegExp(pattern, "gi");
  } catch {
    // An unparseable pattern can never match — surfaced by validateRule at write time.
    return [];
  }
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    hits.push(m[0]);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

/**
 * Evaluate `text` against active rules.
 *
 * - severity high/critical ⇒ `passed = false` (caller returns 422)
 * - severity low/medium ⇒ violation recorded, `passed` unchanged
 * - detected PII is ALWAYS redacted out of `sanitizedInput`, regardless of severity
 */
export function evaluateRules(text: string, rules: GuardrailRule[]): EvaluationResult {
  const violations: Violation[] = [];
  let passed = true;
  let sanitizedInput = text;

  for (const rule of rules) {
    switch (rule.ruleType) {
      case "pii": {
        const findings = detectPii(text);
        if (findings.length > 0) {
          const types = [...new Set(findings.map((f) => f.type))].join(", ");
          violations.push({
            ruleId: rule.id,
            ruleType: rule.ruleType,
            severity: rule.severity,
            message: `personal data detected: ${types}`,
          });
          if (isBlocking(rule.severity)) passed = false;
          sanitizedInput = redactPii(sanitizedInput, detectPii(sanitizedInput));
        }
        break;
      }
      case "prompt_injection": {
        const result = detectPromptInjection(text);
        if (result.detected) {
          violations.push({
            ruleId: rule.id,
            ruleType: rule.ruleType,
            severity: rule.severity,
            message: `prompt injection detected: ${result.matches.join("; ")}`,
          });
          if (isBlocking(rule.severity)) passed = false;
        }
        break;
      }
      case "profanity":
      case "topic_block": {
        const hits = matchPattern(text, rule.pattern ?? null);
        if (hits.length > 0) {
          const label = rule.ruleType === "profanity" ? "profanity" : "blocked topic";
          violations.push({
            ruleId: rule.id,
            ruleType: rule.ruleType,
            severity: rule.severity,
            message: `${label} matched: ${hits.length} occurrence(s)`,
          });
          if (isBlocking(rule.severity)) passed = false;
        }
        break;
      }
      case "max_length": {
        const max = Number(rule.config?.max ?? 0);
        const result = checkMaxLength(text, max);
        if (!result.passed) {
          violations.push({
            ruleId: rule.id,
            ruleType: rule.ruleType,
            severity: rule.severity,
            message: `input length ${result.length} exceeds max ${result.max}`,
          });
          if (isBlocking(rule.severity)) passed = false;
        }
        break;
      }
      default:
        // Unknown rule types are ignored rather than failing open on a 500.
        break;
    }
  }

  return { passed, violations, sanitizedInput };
}

/**
 * Validate a rule definition before it is persisted.
 * Returns null when valid, or a human-readable error message.
 */
export function validateRule(rule: {
  ruleType?: string;
  pattern?: string | null;
  config?: Record<string, unknown> | null;
  severity?: string;
}): string | null {
  if (!rule.ruleType || !RULE_TYPES.includes(rule.ruleType as RuleType)) {
    return `ruleType must be one of: ${RULE_TYPES.join(", ")}`;
  }
  if (rule.severity !== undefined && !SEVERITIES.includes(rule.severity as Severity)) {
    return `severity must be one of: ${SEVERITIES.join(", ")}`;
  }
  if (REGEX_RULE_TYPES.includes(rule.ruleType as RuleType)) {
    if (!rule.pattern || rule.pattern.trim().length === 0) {
      return `${rule.ruleType} rules require a non-empty pattern`;
    }
    try {
      new RegExp(rule.pattern);
    } catch {
      return `pattern is not a valid regular expression`;
    }
  }
  if (rule.ruleType === "max_length") {
    const max = rule.config?.max;
    if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) {
      return "max_length rules require numeric config.max greater than 0";
    }
  }
  return null;
}
