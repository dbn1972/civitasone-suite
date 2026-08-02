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

export type AbacRuleRow = {
  id: string;
  roleId: string;
  enabled: boolean;
  expression?: {
    effect?: string;
    action?: string;
    resourceType?: string;
    predicates?: unknown[];
  };
  version?: number;
};

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
