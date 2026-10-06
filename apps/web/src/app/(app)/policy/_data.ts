/**
 * policy route-group server loaders. Call policy-service through the gateway
 * (/api/v1/policy/*) using the shared cookie-aware fetchJson helper.
 * Kept inside the policy route group so the module stays self-contained.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

export type PolicyBindingRow = {
  id: string;
  userId: string;
  roleId: string;
  status: string;
  version?: number;
};

/**
 * GAP-POLICY-ABAC-01: predicate shape mirrors policy-service's engine union
 * (services/policy-service/src/modules/abac/domain.ts `Predicate`). Rules are
 * shown WITH their conditions so an admin can tell what a deny rule matches;
 * previously `predicates` was `unknown[]` and never rendered.
 */
export type AbacPredicate =
  | { op: "equals"; path: string; value: unknown }
  | { op: "in"; path: string; values: unknown[] }
  | { op: "exists"; path: string }
  | { op: "not-equals"; path: string; value: unknown }
  | { op: "not-in"; path: string; values: unknown[] }
  | { op: "not-exists"; path: string }
  | { op: "owner-match"; subjectPath?: string; resourcePath?: string }
  | { op: "tenant-match"; subjectPath?: string; resourcePath?: string }
  | { op: "time-window"; after?: string; before?: string; timezone?: string }
  | { op: "or"; predicates: AbacPredicate[] }
  | { op: "not"; predicate: AbacPredicate };

export type AbacRuleRow = {
  id: string;
  roleId: string;
  enabled: boolean;
  expression?: {
    effect?: string;
    action?: string;
    resourceType?: string;
    predicates?: AbacPredicate[];
  };
  version?: number;
};

/**
 * GAP-POLICY-ABAC-01: render a single predicate as a short, human
 * "attribute operator value" phrase for the ABAC Conditions column. Falls back
 * to a compact JSON for shapes it does not recognise, so an unknown predicate
 * is still shown (never silently dropped) rather than hidden.
 */
export function formatAbacPredicate(p: AbacPredicate): string {
  switch (p.op) {
    case "equals":
      return `${p.path} = ${JSON.stringify(p.value)}`;
    case "not-equals":
      return `${p.path} ≠ ${JSON.stringify(p.value)}`;
    case "in":
      return `${p.path} in [${p.values.map((v) => JSON.stringify(v)).join(", ")}]`;
    case "not-in":
      return `${p.path} not in [${p.values.map((v) => JSON.stringify(v)).join(", ")}]`;
    case "exists":
      return `${p.path} is present`;
    case "not-exists":
      return `${p.path} is absent`;
    case "owner-match":
      return `owner matches (${p.subjectPath ?? "subject"} = ${p.resourcePath ?? "resource.ownerId"})`;
    case "tenant-match":
      return `same tenant (${p.subjectPath ?? "context.tenantId"} = ${p.resourcePath ?? "resource.tenantId"})`;
    case "time-window":
      return `time between ${p.after ?? "−∞"} and ${p.before ?? "+∞"}${p.timezone ? ` (${p.timezone})` : ""}`;
    case "or":
      return `any of: ${p.predicates.map(formatAbacPredicate).join(" OR ")}`;
    case "not":
      return `not (${formatAbacPredicate(p.predicate)})`;
    default:
      return JSON.stringify(p);
  }
}

export type RoleFeatureGrantRow = {
  id: string;
  roleName: string;
  featureKey: string;
  granted: boolean;
  version?: number;
};

type Envelope<T> = { data?: T[] } | T[] | null | undefined;

function listOf<T>(payload: Envelope<T>): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

/** Role↔user bindings. Backend today exposes mutations; GET is attempted for F1 wiring. */
export function getPolicyBindings(): Promise<LoaderResult<PolicyBindingRow[]>> {
  return fetchJson<Envelope<PolicyBindingRow>, PolicyBindingRow[]>("/api/v1/policy/bindings", [], {
    revalidateSeconds: 30,
    telemetryKey: "policy.bindings",
    mapResponse: listOf,
  });
}

/** ABAC rules list. */
export function getAbacRules(): Promise<LoaderResult<AbacRuleRow[]>> {
  return fetchJson<Envelope<AbacRuleRow>, AbacRuleRow[]>("/api/v1/policy/abac/rules", [], {
    revalidateSeconds: 30,
    telemetryKey: "policy.abac",
    mapResponse: listOf,
  });
}

/** Role → feature visibility grants. */
export function getRoleFeatureGrants(): Promise<LoaderResult<RoleFeatureGrantRow[]>> {
  return fetchJson<Envelope<RoleFeatureGrantRow>, RoleFeatureGrantRow[]>(
    "/api/v1/policy/role-features",
    [],
    {
      revalidateSeconds: 30,
      telemetryKey: "policy.roleFeatures",
      mapResponse: listOf,
    },
  );
}
