/**
 * Per-strategy assignment-rule criteria schemas (GAP-CRM-ASSIGNMENT-RULES-01).
 *
 * The editor used to accept ANY JSON object as `criteria` ("is an object" was
 * the only check), so a Territory rule saved with `{"foo":1}` was persisted and
 * started (silently) routing nothing — the crm-service engine skips a rule whose
 * criteria is malformed, degrading to "no match" rather than erroring, so a typo
 * was invisible until leads stopped routing.
 *
 * The shapes below are derived DIRECTLY from the backend rule engine
 * (services/crm-service/src/modules/leads/assignment.ts — TerritoryCriteria,
 * AttributeCriteria, ScoreThresholdCriteria, RoundRobinCriteria,
 * CapacityCriteria). They are intentionally strict on the fields the engine
 * reads, but tolerant of extra keys (`.passthrough()`), because the backend
 * stores an opaque jsonb blob and may carry additional metadata we must not drop.
 *
 * Enforcement policy: validate only a NON-empty criteria object on edit. An
 * empty `{}` is always allowed (the backend defaults criteria to {} and the rule
 * then routes everything to its fallback owner), so legacy rows with empty
 * criteria load and re-save without being blocked.
 */
import { z } from "zod";
import { RULE_TYPES, type RuleType } from "./assignment";

const ownerId = z.string({ required_error: "ownerId is required" }).min(1, "ownerId is required");
const roster = z
  .array(z.string().min(1), { required_error: "roster is required" })
  .min(1, "roster needs at least one owner id");

const territoryCriteria = z
  .object({
    territory: z.string({ required_error: "territory is required" }).min(1, "territory is required"),
    ownerId,
  })
  .passthrough();

const attributeCriteria = z
  .object({ value: z.string({ required_error: "value is required" }).min(1, "value is required"), ownerId })
  .passthrough();

const scoreThresholdCriteria = z
  .object({
    threshold: z.number({
      required_error: "threshold is required",
      invalid_type_error: "threshold must be a number",
    }),
    ownerId,
  })
  .passthrough();

const roundRobinCriteria = z
  .object({
    roster,
    currentIndex: z
      .number({ required_error: "currentIndex is required", invalid_type_error: "currentIndex must be a number" })
      .int()
      .min(0),
  })
  .passthrough();

const capacityCriteria = z.object({ roster }).passthrough();

const SCHEMAS: Record<RuleType, z.ZodTypeAny> = {
  territory: territoryCriteria,
  round_robin: roundRobinCriteria,
  score_threshold: scoreThresholdCriteria,
  product: attributeCriteria,
  segment: attributeCriteria,
  language: attributeCriteria,
  capacity: capacityCriteria,
};

/** The zod schema that governs the criteria blob for a given rule strategy. */
export function schemaFor(ruleType: RuleType): z.ZodTypeAny {
  return SCHEMAS[ruleType] ?? z.record(z.string(), z.unknown());
}

export interface CriteriaValidation {
  ok: boolean;
  /** First human-readable problem, suitable for an inline field error. */
  error?: string;
}

/**
 * Validate a parsed criteria object against its strategy. An empty object is
 * always valid (see policy above). Returns the first zod message on failure.
 */
export function validateCriteria(
  ruleType: RuleType,
  criteria: Record<string, unknown>,
): CriteriaValidation {
  if (Object.keys(criteria).length === 0) return { ok: true };
  const result = schemaFor(ruleType).safeParse(criteria);
  if (result.success) return { ok: true };
  const first = result.error.issues[0];
  return { ok: false, error: first ? first.message : "Invalid criteria for this strategy." };
}

/** A one-line, plain-language summary of a parsed, valid criteria object. */
export function summariseCriteria(ruleType: RuleType, criteria: Record<string, unknown>): string {
  if (Object.keys(criteria).length === 0) return "Routes every lead to the fallback owner.";
  switch (ruleType) {
    case "territory":
      return `Route leads in territory “${String(criteria.territory ?? "")}” to owner ${String(criteria.ownerId ?? "")}.`;
    case "product":
    case "segment":
    case "language":
      return `Route leads where ${ruleType} = “${String(criteria.value ?? "")}” to owner ${String(criteria.ownerId ?? "")}.`;
    case "score_threshold":
      return `Route leads scoring ≥ ${String(criteria.threshold ?? "")} to owner ${String(criteria.ownerId ?? "")}.`;
    case "round_robin":
      return `Cycle leads across ${Array.isArray(criteria.roster) ? criteria.roster.length : 0} owner(s) in turn.`;
    case "capacity":
      return `Route each lead to the least-loaded of ${Array.isArray(criteria.roster) ? criteria.roster.length : 0} owner(s).`;
    default:
      return "Custom criteria.";
  }
}

export { RULE_TYPES };
