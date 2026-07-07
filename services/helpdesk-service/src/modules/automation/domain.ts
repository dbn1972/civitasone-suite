/**
 * Automation rules evaluation engine — pure domain logic.
 *
 * Evaluates rules in ascending ordinal order. Fires the FIRST matching rule only.
 * A rule matches if its trigger condition is satisfied by the ticket.
 */
import type {
  AutomationTrigger,
  AutomationAction,
  FieldMatchTrigger,
  TimeElapsedTrigger,
  KeywordMatchTrigger,
} from "./schema.js";

/** Minimal ticket shape needed for rule evaluation. */
export interface TicketForEvaluation {
  /** Key-value map of ticket fields (priority, status, category, etc.) */
  fields: Record<string, string | undefined>;
  /** Minutes elapsed since ticket creation. */
  elapsedMinutes: number;
  /** Ticket subject — searched for keyword triggers. */
  subject: string;
  /** Ticket description — searched for keyword triggers. */
  description?: string | undefined;
}

/** A rule as stored — the shape passed to the evaluator. */
export interface AutomationRule {
  id: string;
  name: string;
  ordinal: number;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

/** Result when a rule matches. */
export interface MatchedRule {
  ruleId: string;
  ruleName: string;
  ordinal: number;
  actions: AutomationAction[];
}

/**
 * Evaluate rules against a ticket. Rules MUST be pre-sorted by ascending ordinal.
 * Returns the first matching rule (fire-first-match semantics) or null if none match.
 */
export function evaluateRules(
  ticket: TicketForEvaluation,
  rules: AutomationRule[],
): MatchedRule | null {
  // Sort by ordinal ascending to guarantee evaluation order
  const sorted = [...rules].sort((a, b) => a.ordinal - b.ordinal);

  for (const rule of sorted) {
    if (!rule.enabled) continue;
    if (matchesTrigger(ticket, rule.trigger)) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ordinal: rule.ordinal,
        actions: rule.actions,
      };
    }
  }

  return null;
}

/**
 * Check if a ticket satisfies a trigger condition.
 */
function matchesTrigger(ticket: TicketForEvaluation, trigger: AutomationTrigger): boolean {
  switch (trigger.type) {
    case "field_match":
      return matchesFieldTrigger(ticket, trigger);
    case "time_elapsed":
      return matchesTimeElapsedTrigger(ticket, trigger);
    case "keyword_match":
      return matchesKeywordTrigger(ticket, trigger);
    default:
      return false;
  }
}

function matchesFieldTrigger(ticket: TicketForEvaluation, trigger: FieldMatchTrigger): boolean {
  const fieldValue = ticket.fields[trigger.field];
  if (fieldValue === undefined) return false;
  return fieldValue.toLowerCase() === trigger.value.toLowerCase();
}

function matchesTimeElapsedTrigger(ticket: TicketForEvaluation, trigger: TimeElapsedTrigger): boolean {
  return ticket.elapsedMinutes >= trigger.thresholdMinutes;
}

function matchesKeywordTrigger(ticket: TicketForEvaluation, trigger: KeywordMatchTrigger): boolean {
  if (!trigger.keywords || trigger.keywords.length === 0) return false;
  const searchText = `${ticket.subject} ${ticket.description ?? ""}`.toLowerCase();
  return trigger.keywords.some((kw) => searchText.includes(kw.toLowerCase()));
}
