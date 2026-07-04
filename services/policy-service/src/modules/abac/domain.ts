// ABAC evaluation engine — pure, unit-testable. No I/O.
//
// Semantics:
//   * Each stored rule carries an `effect` (allow|deny), a target (action +
//     resourceType) and a set of attribute predicates. A rule MATCHES an access
//     request when (a) the rule's roleId is held by the subject, (b) action and
//     resourceType target the request (wildcard "*" matches anything) and (c)
//     EVERY predicate evaluates true against the request.
//   * Precedence is DENY-OVERRIDES: if any matching rule is a deny, the decision
//     is deny regardless of allow matches. Otherwise a matching allow permits.
//   * DEFAULT-DENY: when no rule matches, the decision is deny.
//
// Predicate operators:
//   equals       — attribute at `path` strictly equals `value`
//   in           — attribute at `path` is one of `values`
//   exists       — attribute at `path` is present (not undefined/null)
//   owner-match  — subject attr (default subject.attrs.userId / subject id) equals
//                  resource attr (default resource.attrs.ownerId)
//   tenant-match — subject attr (default context.tenantId) equals resource
//                  attr (default resource.attrs.tenantId)

export type AttrBag = Record<string, unknown>;

export interface AccessSubject {
  id?: string;
  roleIds: string[];
  attrs: AttrBag;
}

export interface AccessResource {
  type: string;
  attrs: AttrBag;
}

export interface AccessRequest {
  subject: AccessSubject;
  action: string;
  resource: AccessResource;
  context: AttrBag;
}

export type Predicate =
  | { op: "equals"; path: string; value: unknown }
  | { op: "in"; path: string; values: unknown[] }
  | { op: "exists"; path: string }
  | { op: "not-equals"; path: string; value: unknown }
  | { op: "not-in"; path: string; values: unknown[] }
  | { op: "not-exists"; path: string }
  | { op: "owner-match"; subjectPath?: string; resourcePath?: string }
  | { op: "tenant-match"; subjectPath?: string; resourcePath?: string }
  | { op: "time-window"; after?: string; before?: string; timezone?: string }
  | { op: "or"; predicates: Predicate[] }
  | { op: "not"; predicate: Predicate };

export interface RuleExpression {
  effect: "allow" | "deny";
  action: string;        // "*" matches any action
  resourceType: string;  // "*" matches any resource type
  predicates: Predicate[];
}

// A rule as seen by the engine: the stored row's roleId + parsed expression.
export interface CompiledRule {
  id: string;
  roleId: string;
  enabled: boolean;
  expression: RuleExpression;
}

export interface Decision {
  decision: "permit" | "deny";
  reason: string;
  matchedRuleId?: string;
}

// ── attribute resolution ──────────────────────────────────────────────
// Dotted path lookup over a rooted view of the request. Roots: subject,
// resource, context, action.
export function resolvePath(req: AccessRequest, path: string): unknown {
  const parts = path.split(".");
  const [root, ...rest] = parts;
  let cur: unknown;
  switch (root) {
    case "subject":  cur = { id: req.subject.id, roleIds: req.subject.roleIds, attrs: req.subject.attrs, ...req.subject.attrs }; break;
    case "resource": cur = { type: req.resource.type, attrs: req.resource.attrs, ...req.resource.attrs }; break;
    case "context":  cur = req.context; break;
    case "action":   cur = req.action; break;
    default:         return undefined;
  }
  for (const key of rest) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as AttrBag)[key];
  }
  return cur;
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null;
}

export function evalPredicate(req: AccessRequest, p: Predicate): boolean {
  switch (p.op) {
    case "equals":
      return resolvePath(req, p.path) === p.value;
    case "not-equals":
      return resolvePath(req, p.path) !== p.value;
    case "in": {
      const v = resolvePath(req, p.path);
      return p.values.some((cand) => cand === v);
    }
    case "not-in": {
      const v = resolvePath(req, p.path);
      return !p.values.some((cand) => cand === v);
    }
    case "exists":
      return present(resolvePath(req, p.path));
    case "not-exists":
      return !present(resolvePath(req, p.path));
    case "owner-match": {
      const subj = resolvePath(req, p.subjectPath ?? "subject.attrs.userId");
      const sid = present(subj) ? subj : req.subject.id;
      const owner = resolvePath(req, p.resourcePath ?? "resource.attrs.ownerId");
      return present(sid) && present(owner) && sid === owner;
    }
    case "tenant-match": {
      const subjT = resolvePath(req, p.subjectPath ?? "context.tenantId");
      const resT = resolvePath(req, p.resourcePath ?? "resource.attrs.tenantId");
      return present(subjT) && present(resT) && subjT === resT;
    }
    case "time-window": {
      const now = new Date();
      if (p.after) {
        const afterTime = parseTimeOfDay(p.after);
        if (now < afterTime) return false;
      }
      if (p.before) {
        const beforeTime = parseTimeOfDay(p.before);
        if (now > beforeTime) return false;
      }
      return true;
    }
    case "or":
      return p.predicates.some((sub) => evalPredicate(req, sub));
    case "not":
      return !evalPredicate(req, p.predicate);
    default:
      return false;
  }
}

/** Parse a time string (HH:MM) into a Date for today. */
function parseTimeOfDay(time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

function targets(rule: RuleExpression, req: AccessRequest): boolean {
  const actionOk = rule.action === "*" || rule.action === req.action;
  const typeOk = rule.resourceType === "*" || rule.resourceType === req.resource.type;
  return actionOk && typeOk;
}

export function ruleMatches(rule: CompiledRule, req: AccessRequest): boolean {
  if (!rule.enabled) return false;
  if (!req.subject.roleIds.includes(rule.roleId)) return false;
  if (!targets(rule.expression, req)) return false;
  return rule.expression.predicates.every((p) => evalPredicate(req, p));
}

// Core evaluation: deny-overrides + default-deny.
export function evaluate(rules: CompiledRule[], req: AccessRequest): Decision {
  const matched = rules.filter((r) => ruleMatches(r, req));
  const deny = matched.find((r) => r.expression.effect === "deny");
  if (deny) {
    return { decision: "deny", reason: `deny rule matched (${deny.id})`, matchedRuleId: deny.id };
  }
  const allow = matched.find((r) => r.expression.effect === "allow");
  if (allow) {
    return { decision: "permit", reason: `allow rule matched (${allow.id})`, matchedRuleId: allow.id };
  }
  return { decision: "deny", reason: "default-deny: no matching rule" };
}

// ── expression parsing/validation (used by repo + validators) ─────────
export class ExpressionError extends Error {}

export function parseExpression(raw: string): RuleExpression {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ExpressionError("expression is not valid JSON");
  }
  return assertExpression(json);
}

function isPredicate(v: unknown): v is Predicate {
  if (typeof v !== "object" || v === null) return false;
  const op = (v as { op?: unknown }).op;
  return op === "equals" || op === "in" || op === "exists" || op === "owner-match" || op === "tenant-match";
}

export function assertExpression(v: unknown): RuleExpression {
  if (typeof v !== "object" || v === null) throw new ExpressionError("expression must be an object");
  const o = v as Record<string, unknown>;
  if (o.effect !== "allow" && o.effect !== "deny") throw new ExpressionError("effect must be allow|deny");
  if (typeof o.action !== "string" || o.action.length === 0) throw new ExpressionError("action must be a non-empty string");
  if (typeof o.resourceType !== "string" || o.resourceType.length === 0) throw new ExpressionError("resourceType must be a non-empty string");
  if (!Array.isArray(o.predicates)) throw new ExpressionError("predicates must be an array");
  for (const p of o.predicates) {
    if (!isPredicate(p)) throw new ExpressionError("invalid predicate");
  }
  return { effect: o.effect, action: o.action, resourceType: o.resourceType, predicates: o.predicates as Predicate[] };
}
