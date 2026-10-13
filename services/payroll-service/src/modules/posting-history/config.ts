/**
 * ST-M01-11 — payroll posting consumer flag (SmartTransfer OS).
 *
 * The posting consumer is OPTIONAL per the M01 PR row: it is active only when a
 * tenant actually has payroll. There is no reliable in-service per-tenant
 * payroll-entitlement signal available to payroll-service today (the gateway
 * module guard enforces entitlement at the edge; payroll-service does not re-
 * read the admin composition projection, and the only cross-service read it has
 * — the hrms-client — is for employee pay input, not module entitlement). So,
 * exactly as the row allows ("if no reliable signal exists, gate on an env flag
 * default off and say so"), the consumer is gated on this flag.
 *
 * When the flag is OFF (the default) the consumer is NOT subscribed at all
 * (worker.ts gates registration): a tenant without the payroll consequence
 * wired is a true fleet-wide no-op — nothing is written and no `hrms.posting.*`
 * topic is pulled into a void. This also keeps the frozen `hrms.posting.changed`
 * contract ratchet-safe: its declared payroll consumer is OPEN D-ST-13
 * (PROPOSED), so lighting it up unconditionally would be a publish-into-void
 * subscription tripping the cross-service-events ratchet (D-101). Same deferral
 * precedent as ST-M01-03 / ST-M01-09 / ST-M01-12.
 *
 * When the flag is ON, the consumer subscribes and, per message, still no-ops
 * (markProcessed, nothing else) for any tenant the operator has not opted in
 * via PAYROLL_POSTING_TENANTS (a comma-separated allow-list; empty = every
 * tenant on this deployment). This is the per-tenant "no-op when the tenant
 * lacks payroll" behaviour the row asks for, expressed with the only reliable
 * signal available in-service.
 *
 * Both values are parsed strictly (no z.coerce.boolean — house rule 8): only
 * the exact string "true" (case-insensitive, trimmed) enables the flag; the
 * tenant list is split on commas and trimmed.
 */

export const POSTING_CONSUMER_FLAG = "PAYROLL_POSTING_CONSUMER_ENABLED" as const;
export const POSTING_TENANTS_ENV = "PAYROLL_POSTING_TENANTS" as const;

/** True only when PAYROLL_POSTING_CONSUMER_ENABLED is explicitly "true". */
export function isPostingConsumerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[POSTING_CONSUMER_FLAG];
  if (typeof raw !== "string") return false;
  return raw.trim().toLowerCase() === "true";
}

/**
 * The explicit per-tenant allow-list. An empty/absent value means "every tenant
 * on this deployment is a payroll tenant" (the common single-profile case); a
 * non-empty list restricts the consumer's writes to exactly those tenant ids.
 */
export function postingTenantAllowList(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const raw = env[POSTING_TENANTS_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Whether this tenant has payroll (i.e. the consumer should write), given the
 * allow-list. An empty allow-list ⇒ true for every tenant; a non-empty list ⇒
 * only its members. Called inside the consumer so a non-payroll tenant's
 * posting event is a clean markProcessed-only no-op.
 */
export function tenantHasPayroll(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const allow = postingTenantAllowList(env);
  if (allow.size === 0) return true;
  return allow.has(tenantId);
}
