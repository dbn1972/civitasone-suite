/**
 * GAP-ADMIN-SCHEDULED-JOBS-02: which commands a scheduled job may target.
 *
 * A job stores (targetService, targetCommand, payload); without a policy any
 * platform admin could schedule an arbitrary command against any service. The
 * default policy is deliberately conservative and configurable:
 *
 *   - targetService must be one of SCHEDULABLE_SERVICES;
 *   - targetCommand must be dotted lower-case (`service.entity.action`) and its
 *     first segment must be that service's own command namespace, so a job for
 *     report-service can never name a finance command;
 *   - destructive verbs (delete/purge/erase/truncate/drop/wipe/revoke/destroy, matched
 *     case-insensitively anywhere in the command) are refused outright;
 *   - SENSITIVE_SERVICES (finance/hrms/audit) can be scheduled only once an operator has
 *     configured an explicit allow-list for them (no allow-list = nothing is schedulable);
 *   - the payload is a JSON object of bounded size.
 *
 * ADMIN_SCHEDULED_JOB_TARGETS (JSON: {"finance-service": ["finance\\.report\\..+"]})
 * narrows a service to an explicit regex allow-list when an operator wants one.
 */
export const SCHEDULABLE_SERVICES: Record<string, string> = {
  "admin-service": "admin",
  "finance-service": "finance",
  "hrms-service": "hrms",
  "report-service": "report",
  "audit-service": "audit",
  "notification-service": "notification",
};

/** Targets whose scheduled or manual execution touches money, people or the audit trail. */
export const SENSITIVE_SERVICES = new Set(["finance-service", "hrms-service", "audit-service"]);

const COMMAND_SHAPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
// Case-insensitive SUBSTRING match: "purgeall", "PurgeAll" and "bulk_wipe" are all destructive.
const DESTRUCTIVE = /(delete|purge|erase|truncate|drop|wipe|revoke|destroy)/i;
export const PAYLOAD_MAX_CHARS = 10_000;

function configured(): Record<string, string[]> | null {
  const raw = process.env.ADMIN_SCHEDULED_JOB_TARGETS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, string[]>;
  } catch {
    /* a malformed override must not silently widen the policy: fall through to the default */
  }
  return null;
}

export type TargetCheck = { ok: true } | { ok: false; field: "targetService" | "targetCommand" | "payload"; message: string };

export function checkTarget(targetService: string, targetCommand: string, payload?: unknown): TargetCheck {
  const ns = SCHEDULABLE_SERVICES[targetService];
  if (!ns) return { ok: false, field: "targetService", message: `must be one of: ${Object.keys(SCHEDULABLE_SERVICES).join(", ")}` };
  if (!COMMAND_SHAPE.test(targetCommand)) {
    return { ok: false, field: "targetCommand", message: "must look like service.entity.action (lower-case, dot separated)" };
  }
  if (targetCommand.split(".")[0] !== ns) {
    return { ok: false, field: "targetCommand", message: `must start with "${ns}." for ${targetService}` };
  }
  if (DESTRUCTIVE.test(targetCommand)) {
    return { ok: false, field: "targetCommand", message: "destructive commands cannot be scheduled" };
  }
  const override = configured()?.[targetService];
  // Money, people and the audit trail: namespace-only is not enough, an explicit allow-list is mandatory.
  if (SENSITIVE_SERVICES.has(targetService) && !(Array.isArray(override) && override.length > 0)) {
    return { ok: false, field: "targetService", message: `${targetService} jobs need an explicit allow-list (ADMIN_SCHEDULED_JOB_TARGETS) before any command can be scheduled` };
  }
  if (override && !override.some((re) => new RegExp(`^(?:${re})$`).test(targetCommand))) {
    return { ok: false, field: "targetCommand", message: `is not on the allow-list configured for ${targetService}` };
  }
  if (payload !== undefined && JSON.stringify(payload).length > PAYLOAD_MAX_CHARS) {
    return { ok: false, field: "payload", message: `must be at most ${PAYLOAD_MAX_CHARS} characters of JSON` };
  }
  return { ok: true };
}

export function describeTargets() {
  const override = configured();
  return {
    services: Object.entries(SCHEDULABLE_SERVICES).map(([service, namespace]) => ({
      service,
      commandPrefix: `${namespace}.`,
      sensitive: SENSITIVE_SERVICES.has(service),
      allowList: override?.[service] ?? null,
      /** False for a sensitive service with no configured allow-list: the create form disables it. */
      schedulable: !SENSITIVE_SERVICES.has(service) || (Array.isArray(override?.[service]) && (override?.[service]?.length ?? 0) > 0),
    })),
    commandFormat: "service.entity.action",
    payloadMaxChars: PAYLOAD_MAX_CHARS,
  };
}
