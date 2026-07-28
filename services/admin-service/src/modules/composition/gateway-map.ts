/**
 * Projection from composition module ids to the gateway's ROUTE_TO_MODULE
 * vocabulary (services/gateway-service/src/module-guard.ts). One composition
 * module can map to several gateway route-keys — the whole HR cluster proxies
 * through the "hrms" route, ess also surfaces "reports", etc. Composition ids
 * with no mapping contribute nothing (the gateway allows unknown routes anyway).
 *
 * Kept deliberately close to the gateway's own key list so the two stay in
 * lock-step; see the guard's ROUTE_TO_MODULE for the authoritative key set.
 */
export const COMPOSITION_TO_GATEWAY_KEYS: Record<string, string[]> = {
  // kernel
  workflow: ["workflow"],
  // establishment / HR — all HR modules proxy through the hrms route
  employee: ["hrms", "establishment"],
  attendance: ["hrms"],
  leave: ["hrms"],
  recruitment: ["hrms"],
  appraisal: ["hrms"],
  career: ["hrms"],
  ess: ["hrms", "reports"],
  // payroll & benefits (one payroll-service)
  payroll: ["payroll"],
  loans: ["payroll"],
  benefits: ["payroll"],
  separation: ["payroll"],
  // finance backbone
  finance: ["finance"],
  budget: ["finance"],
  treasury: ["finance"],
  revenue: ["finance"],
  // procure-to-pay
  procurement: ["procurement"],
  contract: ["contracts"],
  inventory: ["inventory", "stock"],
  asset: ["assets"],
  // delivery
  works: ["projects"],
  project: ["projects"],
  grant: ["grants"],
  // citizen services
  citizen: ["citizen"],
  crm: ["crm"],
  helpdesk: ["helpdesk"],
  knowledge: ["knowledge"],
  // governance
  legal: ["legal"],
  inspection: ["inspection"],
  // insight
  analytics: ["analytics", "reports"],
};

/** Project a set of composition module ids to distinct, sorted gateway route-keys. */
export function toGatewayKeys(moduleIds: Iterable<string>): string[] {
  const keys = new Set<string>();
  for (const id of moduleIds) for (const k of COMPOSITION_TO_GATEWAY_KEYS[id] ?? []) keys.add(k);
  return [...keys].sort();
}
