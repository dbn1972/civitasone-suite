/**
 * profiles/template-domain.ts — CR-CDP-01 vertical profile templates + conflict
 * resolution (PURE, no I/O).
 *
 * Two tenants in different verticals do not describe a customer with the same
 * attributes, and two source systems routinely disagree about the ones they share.
 * A template answers both questions as configuration rather than code:
 *
 *   attributesSpec  — which attributes the golden profile carries, and their types
 *   conflictRules   — per attribute, which source wins a disagreement
 *
 * Every strategy here is total and deterministic: given the same candidate set, the
 * same value is chosen on every run, including when timestamps or priorities tie.
 * A survivorship rule that resolves ties arbitrarily produces a golden profile that
 * changes under replay, which is indistinguishable from data corruption.
 */

export const CONFLICT_STRATEGIES = [
  /** Latest observedAt wins. The usual default: recency is the cheapest proxy for truth. */
  "most_recent",
  /** The source appearing earliest in sourcePriority wins, regardless of recency. */
  "highest_source_priority",
  /** The earliest observed non-null value wins; later sources cannot overwrite it. */
  "first_non_null",
] as const;
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

export const ATTRIBUTE_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
  /**
   * Money is a string of integer minor units (paise/cents), never a float and never a
   * JSON number: a JSON number above 2^53 loses precision in transit, and the suite
   * stores money as bigint minor units everywhere else.
   */
  "money",
] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export interface AttributeSpec {
  name: string;
  type: AttributeType;
  required: boolean;
  /** Marks an attribute as personal data so callers can keep it out of logs/exports. */
  pii: boolean;
}

export interface ConflictRule {
  strategy: ConflictStrategy;
  sourcePriority: string[];
}

export interface TemplateSpec {
  attributes: AttributeSpec[];
  conflictRules: Record<string, ConflictRule>;
  defaultStrategy: ConflictStrategy;
  sourcePriority: string[];
}

/** One observation of one attribute from one source. */
export interface SourceValue {
  attribute: string;
  value: unknown;
  source: string;
  /** ISO-8601. An unparseable stamp is ranked last rather than throwing. */
  observedAt: string;
}

export interface ConflictDecision {
  attribute: string;
  value: unknown;
  source: string;
  strategy: ConflictStrategy;
  /** How many non-null candidates competed. 1 means there was no conflict. */
  contenders: number;
  conflicted: boolean;
}

/** Attribute names are the JSON keys of a golden profile, so camelCase is enforced. */
const ATTRIBUTE_NAME_RE = /^[a-z][a-zA-Z0-9_]{0,62}$/;

const MINOR_UNITS_RE = /^-?\d{1,19}$/;

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

/** Milliseconds, or null when the stamp cannot be parsed. */
function parseStamp(observedAt: string): number | null {
  const ms = Date.parse(observedAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Position of `source` in a priority list. Unlisted sources sort after every listed one
 * (Number.MAX_SAFE_INTEGER) instead of being dropped: an unknown source is still
 * evidence, just the weakest kind.
 */
function priorityIndex(source: string, sourcePriority: string[]): number {
  const idx = sourcePriority.indexOf(source);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

/** Validate the raw `attributesSpec` array. Returns null when valid. */
export function validateAttributeSpecs(raw: unknown): string | null {
  if (!Array.isArray(raw)) return "attributes must be an array";
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return `attributes[${i}] must be an object`;
    }
    const spec = entry as Record<string, unknown>;
    const name = spec.name;
    if (typeof name !== "string" || !ATTRIBUTE_NAME_RE.test(name)) {
      return `attributes[${i}].name must be camelCase, 1-63 chars`;
    }
    if (seen.has(name)) return `attributes[${i}].name "${name}" is declared twice`;
    seen.add(name);
    if (typeof spec.type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(spec.type)) {
      return `attributes[${i}].type must be one of ${ATTRIBUTE_TYPES.join(", ")}`;
    }
    if (spec.required !== undefined && typeof spec.required !== "boolean") {
      return `attributes[${i}].required must be a boolean`;
    }
    if (spec.pii !== undefined && typeof spec.pii !== "boolean") {
      return `attributes[${i}].pii must be a boolean`;
    }
  }
  return null;
}

/**
 * Validate conflict rules against the declared attribute names.
 *
 * A rule for an undeclared attribute is rejected rather than ignored: silently dropping
 * it means a tenant believes a survivorship policy is in force when it is not.
 */
export function validateConflictRules(raw: unknown, attributeNames: string[]): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "conflictRules must be an object";
  }
  const declared = new Set(attributeNames);
  for (const [attribute, rule] of Object.entries(raw as Record<string, unknown>)) {
    if (!declared.has(attribute)) {
      return `conflictRules has a rule for undeclared attribute "${attribute}"`;
    }
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      return `conflictRules["${attribute}"] must be an object`;
    }
    const r = rule as Record<string, unknown>;
    if (typeof r.strategy !== "string" || !(CONFLICT_STRATEGIES as readonly string[]).includes(r.strategy)) {
      return `conflictRules["${attribute}"].strategy must be one of ${CONFLICT_STRATEGIES.join(", ")}`;
    }
    if (r.sourcePriority !== undefined) {
      if (!Array.isArray(r.sourcePriority) || r.sourcePriority.some((s) => typeof s !== "string" || s.trim() === "")) {
        return `conflictRules["${attribute}"].sourcePriority must be an array of non-empty strings`;
      }
    }
    if (r.strategy === "highest_source_priority") {
      const listed = Array.isArray(r.sourcePriority) ? r.sourcePriority.length : 0;
      if (listed === 0) {
        // Without an order this strategy would degenerate to "any source", which is a
        // silent behaviour change rather than the policy the tenant asked for.
        return `conflictRules["${attribute}"] uses highest_source_priority but declares no sourcePriority`;
      }
    }
  }
  return null;
}

/** Normalise a stored attribute spec array into typed specs, dropping malformed rows. */
export function toAttributeSpecs(raw: Array<Record<string, unknown>>): AttributeSpec[] {
  const specs: AttributeSpec[] = [];
  for (const entry of raw) {
    const name = entry.name;
    const type = entry.type;
    if (typeof name !== "string") continue;
    if (typeof type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(type)) continue;
    specs.push({
      name,
      type: type as AttributeType,
      required: entry.required === true,
      pii: entry.pii === true,
    });
  }
  return specs;
}

/** Normalise stored conflict rules, filling the template defaults where absent. */
export function toConflictRules(
  raw: Record<string, Record<string, unknown>>,
  defaultStrategy: ConflictStrategy,
  defaultSourcePriority: string[],
): Record<string, ConflictRule> {
  const rules: Record<string, ConflictRule> = {};
  for (const [attribute, rule] of Object.entries(raw)) {
    const strategy = typeof rule.strategy === "string"
      && (CONFLICT_STRATEGIES as readonly string[]).includes(rule.strategy)
      ? (rule.strategy as ConflictStrategy)
      : defaultStrategy;
    const sourcePriority = Array.isArray(rule.sourcePriority)
      ? rule.sourcePriority.filter((s): s is string => typeof s === "string")
      : defaultSourcePriority;
    rules[attribute] = { strategy, sourcePriority };
  }
  return rules;
}

/** The rule in force for an attribute: its own rule, else the template default. */
export function ruleFor(template: TemplateSpec, attribute: string): ConflictRule {
  const own = template.conflictRules[attribute];
  if (own !== undefined) return own;
  return { strategy: template.defaultStrategy, sourcePriority: template.sourcePriority };
}

/**
 * Choose the surviving value for one attribute.
 *
 * Null/blank candidates are discarded first, so "first_non_null" and the other
 * strategies all operate on evidence rather than on gaps. Returns null when nothing
 * survives — the attribute simply has no value, which is different from having a null.
 */
export function resolveConflict(
  attribute: string,
  candidates: SourceValue[],
  rule: ConflictRule,
): ConflictDecision | null {
  const present = candidates.filter((c) => c.attribute === attribute && isPresent(c.value));
  if (present.length === 0) return null;

  const ranked = [...present].sort((a, b) => compareCandidates(a, b, rule));
  const winner = ranked[0];
  if (winner === undefined) return null;

  return {
    attribute,
    value: winner.value,
    source: winner.source,
    strategy: rule.strategy,
    contenders: present.length,
    // Two candidates that agree on the value are not a conflict worth reporting.
    conflicted: new Set(present.map((c) => JSON.stringify(c.value))).size > 1,
  };
}

/**
 * Total ordering of candidates: best first. Every strategy falls through to source
 * priority and then to the source name, so the winner never depends on input order.
 */
function compareCandidates(a: SourceValue, b: SourceValue, rule: ConflictRule): number {
  const ta = parseStamp(a.observedAt);
  const tb = parseStamp(b.observedAt);

  if (rule.strategy === "highest_source_priority") {
    const pa = priorityIndex(a.source, rule.sourcePriority);
    const pb = priorityIndex(b.source, rule.sourcePriority);
    if (pa !== pb) return pa - pb;
    return byRecency(ta, tb) || a.source.localeCompare(b.source);
  }

  if (rule.strategy === "first_non_null") {
    const byOldest = byAge(ta, tb);
    if (byOldest !== 0) return byOldest;
    const pa = priorityIndex(a.source, rule.sourcePriority);
    const pb = priorityIndex(b.source, rule.sourcePriority);
    return (pa - pb) || a.source.localeCompare(b.source);
  }

  // most_recent
  const recency = byRecency(ta, tb);
  if (recency !== 0) return recency;
  const pa = priorityIndex(a.source, rule.sourcePriority);
  const pb = priorityIndex(b.source, rule.sourcePriority);
  return (pa - pb) || a.source.localeCompare(b.source);
}

/** Newest first. An unparseable stamp is always the loser. */
function byRecency(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Oldest first. An unparseable stamp is always the loser. */
function byAge(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Does a resolved value satisfy the declared type? */
export function matchesType(value: unknown, type: AttributeType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "money":
      // Minor units as a decimal string. A JSON number is rejected on purpose.
      return typeof value === "string" && MINOR_UNITS_RE.test(value.trim());
  }
}

export interface TemplateApplication {
  attributes: Record<string, unknown>;
  decisions: ConflictDecision[];
  /** Required attributes the candidate set could not supply. */
  missingRequired: string[];
  /** Candidate attributes the template does not declare; they are not written. */
  ignoredAttributes: string[];
  /** Resolved values whose type contradicts the template. Also not written. */
  typeViolations: Array<{ attribute: string; expected: AttributeType }>;
}

/**
 * Apply a template to a bag of source observations.
 *
 * The template is a whitelist: an attribute it does not declare is reported as ignored
 * rather than written, which is the point of having a per-vertical contract. A resolved
 * value of the wrong type is likewise withheld — writing it would put the golden
 * profile permanently out of contract with its own template.
 */
export function applyTemplate(template: TemplateSpec, candidates: SourceValue[]): TemplateApplication {
  const declared = new Map(template.attributes.map((a) => [a.name, a]));
  const attributes: Record<string, unknown> = {};
  const decisions: ConflictDecision[] = [];
  const missingRequired: string[] = [];
  const typeViolations: Array<{ attribute: string; expected: AttributeType }> = [];

  for (const spec of template.attributes) {
    const decision = resolveConflict(spec.name, candidates, ruleFor(template, spec.name));
    if (decision === null) {
      if (spec.required) missingRequired.push(spec.name);
      continue;
    }
    if (!matchesType(decision.value, spec.type)) {
      typeViolations.push({ attribute: spec.name, expected: spec.type });
      if (spec.required) missingRequired.push(spec.name);
      continue;
    }
    attributes[spec.name] = decision.value;
    decisions.push(decision);
  }

  const ignoredAttributes = [...new Set(
    candidates.filter((c) => !declared.has(c.attribute)).map((c) => c.attribute),
  )].sort();

  return { attributes, decisions, missingRequired, ignoredAttributes, typeViolations };
}
