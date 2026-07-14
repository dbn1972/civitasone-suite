import {
  evaluate as evaluateAbac,
  type CompiledRule,
  type AccessRequest,
  type AttrBag,
  type Decision as AbacDecision,
} from "../abac/domain.js";

export type EvaluateInput = {
  permissionKey: string;
  actor: { userId: string; tenantId: string; roles: string[] };
  resource?: Record<string, unknown>;
};

export type EvaluateResult = {
  decision: "allow" | "deny";
  reason: string;
  cacheable: boolean;
  ttlSeconds: number;
};

export function parsePermissionKey(key: string): { resource: string; action: string } {
  const parts = key.split(".");
  if (parts.length < 3) {
    throw new Error(`invalid permission key: ${key}`);
  }
  const action = parts[parts.length - 1]!;
  const resource = parts.slice(0, -1).join(".");
  return { resource, action };
}

export function evaluateDecision(
  permissionKey: string,
  actorRoles: string[],
  granted: Array<{ resource: string; action: string; effect: string; roleName: string }>,
): EvaluateResult {
  if (actorRoles.includes("super_admin")) {
    return { decision: "allow", reason: "role:super_admin", cacheable: true, ttlSeconds: 60 };
  }

  const { resource, action } = parsePermissionKey(permissionKey);
  const match = granted.find(
    (p) => p.effect === "allow" && p.resource === resource && p.action === action,
  );

  if (match) {
    return {
      decision: "allow",
      reason: `role:${match.roleName}+${resource}.${action}`,
      cacheable: true,
      ttlSeconds: 60,
    };
  }

  return {
    decision: "deny",
    reason: `no permission for ${permissionKey}`,
    cacheable: true,
    ttlSeconds: 30,
  };
}

// ── ABAC integration (EPIC-2, G-09/G-10) ──────────────────────────────
// The RBAC decision above answers "may this ROLE perform this action?". It does
// not consider WHICH office/jurisdiction the subject holds — so `abac.rules` was
// a dead table and an SDM could read any subdivision's records. These functions
// wire the (already-built but orphaned) attribute engine in `../abac/domain.ts`
// into the decision path, giving jurisdiction/office/classification fencing.

/**
 * Combine the RBAC result with the ABAC engine's decision.
 * Precedence:
 *   1. ABAC DENY-OVERRIDES — an explicit matching deny rule fences the action
 *      even when the role grants it (this is how "SDM sees only own subdivision"
 *      is enforced).
 *   2. Otherwise the RBAC allow stands.
 *   3. An explicit ABAC allow rule can extend access where RBAC was silent.
 *   4. Default: the RBAC decision (deny).
 * Attribute-dependent decisions are NOT cacheable — they vary by resource.
 */
export function combineWithAbac(role: EvaluateResult, abac: AbacDecision): EvaluateResult {
  if (abac.decision === "deny" && abac.matchedRuleId) {
    return { decision: "deny", reason: `abac:deny:${abac.matchedRuleId}`, cacheable: false, ttlSeconds: 15 };
  }
  if (role.decision === "allow") {
    return abac.matchedRuleId
      ? { ...role, reason: `${role.reason}+abac:permit:${abac.matchedRuleId}`, cacheable: false, ttlSeconds: 15 }
      : role;
  }
  if (abac.decision === "permit" && abac.matchedRuleId) {
    return { decision: "allow", reason: `abac:permit:${abac.matchedRuleId}`, cacheable: false, ttlSeconds: 15 };
  }
  return role;
}

export type AbacEvaluateInput = {
  permissionKey: string;
  userId: string;
  tenantId: string;
  roles: string[];
  /** Subject role UUIDs (abac.rules key on role_id) — resolved from role names. */
  roleIds: string[];
  /** Subject org attributes (officeId, jurisdictionUnitIds, hierarchyDomain, …). */
  subjectAttrs: AttrBag;
  /** Resource attributes supplied by the caller (e.g. the record's subdivisionId). */
  resource?: AttrBag;
  granted: Array<{ resource: string; action: string; effect: string; roleName: string }>;
  compiledRules: CompiledRule[];
};

/** Full RBAC-then-ABAC evaluation. Pure — the route supplies granted + rules. */
export function evaluateWithAbac(input: AbacEvaluateInput): EvaluateResult {
  const roleResult = evaluateDecision(input.permissionKey, input.roles, input.granted);
  const { resource, action } = parsePermissionKey(input.permissionKey);
  const req: AccessRequest = {
    subject: { id: input.userId, roleIds: input.roleIds, attrs: { userId: input.userId, ...input.subjectAttrs } },
    action,
    resource: { type: resource, attrs: input.resource ?? {} },
    context: { tenantId: input.tenantId, ...input.subjectAttrs },
  };
  const abacDecision = evaluateAbac(input.compiledRules, req);
  return combineWithAbac(roleResult, abacDecision);
}
