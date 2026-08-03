/**
 * CR-MKT-06 — keyword auto-responses on inbound SMS / WhatsApp (pure).
 *
 * Inbound SMS text is whatever the sender typed: mixed case, stray whitespace,
 * smart punctuation, a trailing full stop. Normalisation happens once, here, so
 * every rule is matched against the same canonical form.
 */

export type MatchType = "exact" | "prefix" | "contains";

export type KeywordRule = {
  id: string;
  keyword: string;
  matchType: MatchType;
  /** Lower number = higher precedence. */
  priority: number;
  /** null = applies to every inbound channel. */
  channel: string | null;
  enabled: boolean;
  /** Auto-reply body; null when the rule only triggers an action. */
  responseBody: string | null;
  /** Named side effect, e.g. "opt_out", "escalate_to_human"; null for reply-only. */
  action: string | null;
};

/**
 * Canonical form of an inbound message or a configured keyword:
 *   - trimmed
 *   - lowercased
 *   - internal whitespace runs collapsed to one space
 *   - leading/trailing punctuation stripped (STOP. and "STOP" both match STOP)
 *
 * Unicode letters/digits are preserved, so Hindi keywords normalise correctly.
 */
export function normalizeKeyword(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/** Does a single rule match the normalised message? */
export function ruleMatches(rule: KeywordRule, normalizedMessage: string): boolean {
  if (!rule.enabled) return false;
  const keyword = normalizeKeyword(rule.keyword);
  if (keyword.length === 0) return false;
  switch (rule.matchType) {
    case "exact":
      return normalizedMessage === keyword;
    case "prefix":
      // Word-boundary aware: "stop" must not match "stopwatch reminder".
      return normalizedMessage === keyword || normalizedMessage.startsWith(`${keyword} `);
    case "contains":
      return normalizedMessage.includes(keyword);
  }
}

/**
 * Precedence, most significant first:
 *
 *   1. Channel-specific rules beat channel-agnostic ones (channel = null).
 *   2. Match type: exact > prefix > contains. A rule that matched the whole
 *      message is a stronger signal than one that found the word somewhere.
 *   3. Explicit `priority` ascending (lower wins) — the operator's override.
 *   4. Longer keyword wins. "stop all" is more specific than "stop".
 *   5. Rule id ascending, purely so the result is deterministic when everything
 *      else ties. Never a coin flip.
 */
const MATCH_TYPE_RANK: Record<MatchType, number> = { exact: 0, prefix: 1, contains: 2 };

export function compareRules(a: KeywordRule, b: KeywordRule): number {
  const channelRank = (r: KeywordRule): number => (r.channel === null ? 1 : 0);
  const byChannel = channelRank(a) - channelRank(b);
  if (byChannel !== 0) return byChannel;

  const byType = MATCH_TYPE_RANK[a.matchType] - MATCH_TYPE_RANK[b.matchType];
  if (byType !== 0) return byType;

  const byPriority = a.priority - b.priority;
  if (byPriority !== 0) return byPriority;

  const byLength = normalizeKeyword(b.keyword).length - normalizeKeyword(a.keyword).length;
  if (byLength !== 0) return byLength;

  return a.id.localeCompare(b.id);
}

export type KeywordMatch = {
  rule: KeywordRule;
  normalizedMessage: string;
};

/**
 * Find the single winning rule for an inbound message on a channel.
 * Rules for other channels are excluded outright; channel-agnostic rules apply.
 */
export function matchKeywordRule(
  rules: KeywordRule[], message: string, channel: string,
): KeywordMatch | null {
  const normalized = normalizeKeyword(message);
  if (normalized.length === 0) return null;
  const candidates = rules
    .filter((r) => r.channel === null || r.channel === channel)
    .filter((r) => ruleMatches(r, normalized));
  if (candidates.length === 0) return null;
  const winner = [...candidates].sort(compareRules)[0];
  return winner ? { rule: winner, normalizedMessage: normalized } : null;
}

export type AutoResponsePlan =
  | { kind: "none" }
  | { kind: "reply"; ruleId: string; body: string }
  | { kind: "action"; ruleId: string; action: string }
  | { kind: "reply_and_action"; ruleId: string; body: string; action: string };

/** Turn a match into the concrete plan the consumer executes. */
export function planAutoResponse(match: KeywordMatch | null): AutoResponsePlan {
  if (!match) return { kind: "none" };
  const { rule } = match;
  const hasBody = rule.responseBody !== null && rule.responseBody.trim().length > 0;
  const hasAction = rule.action !== null && rule.action.trim().length > 0;
  if (hasBody && hasAction) {
    return {
      kind: "reply_and_action",
      ruleId: rule.id,
      body: rule.responseBody as string,
      action: rule.action as string,
    };
  }
  if (hasBody) return { kind: "reply", ruleId: rule.id, body: rule.responseBody as string };
  if (hasAction) return { kind: "action", ruleId: rule.id, action: rule.action as string };
  // A rule with neither a body nor an action does nothing — treated as no match
  // so we never record an auto-response that had no effect.
  return { kind: "none" };
}

/**
 * P1-6 — recognising the action that WITHDRAWS consent.
 *
 * `keyword_rules.action` is free-form operator text (varchar(40), no CHECK), so
 * matching it by `===` would make the opt-out depend on the exact spelling an
 * operator happened to type. A rule configured as "OPT-OUT" or "Unsubscribe"
 * expresses the same decision as "opt_out" and must not silently degrade into a
 * reply-only rule — a missed opt-out is the one failure mode this path exists to
 * prevent.
 *
 * The alias list is deliberately short and explicit rather than fuzzy: it holds
 * only unambiguous spellings of "stop messaging me". "escalate_to_human" and any
 * other action must NOT match, or a handoff request would suppress the sender.
 */
const OPT_OUT_ACTION_ALIASES = new Set(["opt_out", "optout", "unsubscribe"]);

/**
 * Canonical form of a rule action: lowercased, with every run of non-alphanumeric
 * characters folded to a single `_` and the ends trimmed. "OPT-OUT", "opt out"
 * and "opt_out" all normalise to "opt_out".
 */
export function normalizeAction(action: string): string {
  return action
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Does this rule action mean "record a consent withdrawal for the sender"? */
export function isOptOutAction(action: string | null | undefined): boolean {
  if (typeof action !== "string") return false;
  return OPT_OUT_ACTION_ALIASES.has(normalizeAction(action));
}
