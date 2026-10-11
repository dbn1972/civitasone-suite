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
  // establishment / HR.
  //
  // ST-M01-04b (D-ST-23/24): the hrms-service is proxied under ONE gateway
  // route, but it serves a core (Workforce Core) surface plus many non-core
  // modules. The gateway module-guard is now PATH-AWARE for the HRMS surface
  // (services/gateway-service/src/hrms-subroute-map.ts) and resolves each
  // non-core prefix to its own `hrms-<module>` key, with the core prefixes
  // resolving to `workforce_core`. So each composition HR module must project
  // to the gateway key that its routes resolve to, NOT the old blanket `hrms`:
  //   • `employee` is the full HRIS employee master. Its own screens live on the
  //     core prefixes (employees / departments / service-book / …) which the
  //     guard resolves to `workforce_core`; it also surfaces establishment. The
  //     HRMS modules that are NOT separately licensable in the composition
  //     registry (training, social, disciplinary, deputation, contracts,
  //     assessment, id-cards, ai, rti, workforce-planning, board-intake,
  //     competency, and the payroll-FACING hrms routes pay-matrix/medical/*-claims)
  //     are part of the base HRIS, so `employee` also projects to each of their
  //     sub-keys. This keeps a full-HRMS tenant reaching its WHOLE surface after
  //     the split (no regression), while a standalone tenant — which has
  //     `workforce_core` but NOT `employee` — reaches only the core surface.
  //   • the separately-licensable HR modules (`attendance`, `leave`,
  //     `recruitment`, `appraisal`, `career`, `ess`) project to their matching
  //     sub-key, kept in lock-step with hrms-subroute-map.ts.
  // A tenant entitled to `employee` therefore keeps the core + base-HRIS surface;
  // a tenant entitled to `leave` keeps the leave surface; and the standalone SKU
  // (only workforce_core, no HR modules) reaches the core surface but is blocked
  // from every non-core sub-key — exactly M01 exit criterion 3.
  employee: [
    "workforce_core",
    "establishment",
    "hrms-payroll",
    "hrms-training",
    "hrms-social",
    "hrms-disciplinary",
    "hrms-deputation",
    "hrms-contracts",
    "hrms-assessment",
    "hrms-id-cards",
    "hrms-ai",
    "hrms-rti",
    "hrms-workforce-planning",
    "hrms-board-intake",
    "hrms-competency",
  ],
  attendance: ["hrms-attendance"],
  leave: ["hrms-leave"],
  recruitment: ["hrms-recruitment"],
  appraisal: ["hrms-appraisal"],
  // `career` (Transfer & Promotion) surfaces through the recruitment/careers
  // prefixes at the gateway; it is a non-core HR module, so it maps to the
  // recruitment sub-key rather than the core Workforce-Core transfer surface.
  career: ["hrms-recruitment"],
  ess: ["hrms-self-service", "reports"],
  // SmartTransfer OS (standalone SKU, D-ST-23). Workforce Core is served by the
  // Workforce-Core profile of hrms-service and now projects to its OWN gateway
  // key `workforce_core` (ST-M01-04b): the guard resolves the core HRMS prefixes
  // to this key, so a standalone tenant reaches the core surface and nothing
  // else. SmartTransfer is its own service/route.
  workforce_core: ["workforce_core"],
  smarttransfer: ["smarttransfer"],
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
  // Legacy gateway-gated services that had no registry module before 0050.
  telephony: ["telephony"],
  meeting: ["meeting"],
  court: ["court"],
  visitor: ["visitor"],
  billing: ["billing"],
  helpdesk: ["helpdesk"],
  knowledge: ["knowledge"],
  // governance
  legal: ["legal"],
  inspection: ["inspection"],
  // insight
  analytics: ["analytics", "reports"],
  // municipal Sec5 (17 services) - gateway route name == module key for all of
  // them (services/gateway-service/src/registry.ts), so this is a direct
  // self-mapping, same shape as citizen/crm/legal above.
  shop: ["shop"],
  trade: ["trade"],
  building: ["building"],
  fire: ["fire"],
  advertisement: ["advertisement"],
  vendor: ["vendor"],
  roadcut: ["roadcut"],
  event: ["event"],
  refund: ["refund"],
  sewerage: ["sewerage"],
  swm: ["swm"],
  drainage: ["drainage"],
  parks: ["parks"],
  animal: ["animal"],
  crematorium: ["crematorium"],
  parking: ["parking"],
  market: ["market"],
};

/** Project a set of composition module ids to distinct, sorted gateway route-keys. */
export function toGatewayKeys(moduleIds: Iterable<string>): string[] {
  const keys = new Set<string>();
  for (const id of moduleIds) for (const k of COMPOSITION_TO_GATEWAY_KEYS[id] ?? []) keys.add(k);
  return [...keys].sort();
}
