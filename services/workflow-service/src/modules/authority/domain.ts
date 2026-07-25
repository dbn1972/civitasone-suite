/**
 * CAP-025 — Delegation-of-power + monetary authority matrix (pure domain).
 *
 * Resolves the financial/administrative authority available to an actor from a
 * set of effective-dated limits, decides whether a requested amount is within
 * that authority, and — when it is exceeded — walks the escalation chain to the
 * lowest office whose limit covers the amount (the approver the case must route
 * to). All functions are pure: no I/O, no clock; the caller supplies `onDate`.
 */

export type AuthorityScope = "role" | "designation" | "user";
export type AuthorityType = "financial" | "administrative";

export interface AuthorityLimit {
  id: string;
  scopeType: AuthorityScope;
  scopeRef: string;
  authorityType: AuthorityType;
  currency: string;
  /** Inclusive maximum amount the scope may authorise. */
  maxAmount: number;
  /** YYYY-MM-DD (inclusive). */
  effectiveFrom: string;
  /** YYYY-MM-DD (inclusive) or null = open-ended. */
  effectiveTo: string | null;
  /** Where a request exceeding this limit escalates to (null = terminal). */
  escalateToScopeType: AuthorityScope | null;
  escalateToRef: string | null;
  /** Only 'active' limits are considered by resolution. */
  status: string;
}

/** An actor's identity for authority resolution: their roles/designations/self. */
export interface ActorScopes {
  scopes: Array<{ scopeType: AuthorityScope; scopeRef: string }>;
}

export interface AuthorityDecision {
  /** The best (highest) limit the actor personally holds, or null if none. */
  actorLimit: AuthorityLimit | null;
  /** The actor's ceiling (0 when the actor holds no applicable limit). */
  actorMax: number;
  /** True when `amount` is within the actor's own authority. */
  withinActorAuthority: boolean;
  /** True when the amount exceeds the actor and must route upward. */
  requiresEscalation: boolean;
  /** Ordered chain of offices the request escalates through (excludes actor). */
  escalationChain: Array<{ scopeType: AuthorityScope; scopeRef: string; maxAmount: number }>;
  /** The final office whose limit covers the amount, or null if uncovered. */
  finalApprover: { scopeType: AuthorityScope; scopeRef: string; maxAmount: number } | null;
  /** True when SOME office in the chain covers the amount. */
  covered: boolean;
}

/** A limit is effective on `onDate` when active and the date is within bounds. */
export function isEffective(limit: AuthorityLimit, onDate: string): boolean {
  if (limit.status !== "active") return false;
  if (limit.effectiveFrom > onDate) return false;
  if (limit.effectiveTo !== null && limit.effectiveTo < onDate) return false;
  return true;
}

/** Effective limits matching an exact scope + authority type on a date. */
export function limitsForScope(
  limits: AuthorityLimit[],
  scopeType: AuthorityScope,
  scopeRef: string,
  authorityType: AuthorityType,
  onDate: string,
): AuthorityLimit[] {
  return limits.filter(
    (l) =>
      l.scopeType === scopeType &&
      l.scopeRef === scopeRef &&
      l.authorityType === authorityType &&
      isEffective(l, onDate),
  );
}

/** Highest-authority effective limit for a single scope (or null). */
export function bestLimitForScope(
  limits: AuthorityLimit[],
  scopeType: AuthorityScope,
  scopeRef: string,
  authorityType: AuthorityType,
  onDate: string,
): AuthorityLimit | null {
  const matches = limitsForScope(limits, scopeType, scopeRef, authorityType, onDate);
  if (matches.length === 0) return null;
  return matches.reduce((best, l) => (l.maxAmount > best.maxAmount ? l : best));
}

/**
 * The actor's own authority: across ALL their scopes (roles/designations/self),
 * the single effective limit with the greatest ceiling. Returns null when the
 * actor holds no applicable limit.
 */
export function resolveActorLimit(
  limits: AuthorityLimit[],
  actor: ActorScopes,
  authorityType: AuthorityType,
  onDate: string,
): AuthorityLimit | null {
  let best: AuthorityLimit | null = null;
  for (const s of actor.scopes) {
    const l = bestLimitForScope(limits, s.scopeType, s.scopeRef, authorityType, onDate);
    if (l && (best === null || l.maxAmount > best.maxAmount)) best = l;
  }
  return best;
}

/**
 * Walk the escalation chain upward from `start` until an office's limit covers
 * `amount`, the chain terminates, or a cycle is detected. The returned chain
 * lists each office visited (in order); `finalApprover` is the covering office
 * (or null). Guarded against cycles by tracking visited limit ids.
 */
export function resolveEscalation(
  limits: AuthorityLimit[],
  start: AuthorityLimit,
  amount: number,
  authorityType: AuthorityType,
  onDate: string,
): Pick<AuthorityDecision, "escalationChain" | "finalApprover" | "covered"> {
  const chain: AuthorityDecision["escalationChain"] = [];
  const visited = new Set<string>([start.id]);
  let cursor: AuthorityLimit | null = start;

  while (cursor && cursor.escalateToScopeType && cursor.escalateToRef) {
    const next: AuthorityLimit | null = bestLimitForScope(
      limits,
      cursor.escalateToScopeType,
      cursor.escalateToRef,
      authorityType,
      onDate,
    );
    if (!next || visited.has(next.id)) break; // dead end or cycle
    visited.add(next.id);
    const node = { scopeType: next.scopeType, scopeRef: next.scopeRef, maxAmount: next.maxAmount };
    chain.push(node);
    if (amount <= next.maxAmount) {
      return { escalationChain: chain, finalApprover: node, covered: true };
    }
    cursor = next;
  }
  return { escalationChain: chain, finalApprover: null, covered: false };
}

/**
 * Full authority evaluation for a request of `amount` by an actor on `onDate`.
 * If the actor's own limit covers the amount, no escalation is required; else
 * the escalation chain is resolved from the actor's best limit (or, when the
 * actor holds no limit at all, from the highest applicable limit of any scope
 * they hold — falling through to whatever escalation targets exist).
 */
export function evaluateAuthority(
  limits: AuthorityLimit[],
  actor: ActorScopes,
  authorityType: AuthorityType,
  amount: number,
  onDate: string,
): AuthorityDecision {
  const actorLimit = resolveActorLimit(limits, actor, authorityType, onDate);
  const actorMax = actorLimit?.maxAmount ?? 0;
  const withinActorAuthority = actorLimit !== null && amount <= actorMax;

  if (withinActorAuthority) {
    return {
      actorLimit,
      actorMax,
      withinActorAuthority: true,
      requiresEscalation: false,
      escalationChain: [],
      finalApprover: actorLimit
        ? { scopeType: actorLimit.scopeType, scopeRef: actorLimit.scopeRef, maxAmount: actorLimit.maxAmount }
        : null,
      covered: true,
    };
  }

  // Exceeds (or actor holds no limit): escalate from the actor's best limit.
  const esc = actorLimit
    ? resolveEscalation(limits, actorLimit, amount, authorityType, onDate)
    : { escalationChain: [], finalApprover: null, covered: false };

  return {
    actorLimit,
    actorMax,
    withinActorAuthority: false,
    requiresEscalation: true,
    escalationChain: esc.escalationChain,
    finalApprover: esc.finalApprover,
    covered: esc.covered,
  };
}
