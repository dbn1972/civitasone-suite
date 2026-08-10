/**
 * Municipal Sec5 role catalog — canonical JWT role names referenced by route handlers.
 * Mirror pattern: {service}_user, {service}_admin, {service}_officer (+ service-specific extras).
 * Used by policy-service catalog endpoint and gateway search module mapping.
 */
export type MunicipalRoleStub = {
  name: string;
  description: string;
  service: string;
  /** Minimal permission keys for policy evaluate stubs (resource.action). */
  permissions: string[];
};

export type MunicipalServiceCatalog = {
  service: string;
  moduleKey: string;
  roles: MunicipalRoleStub[];
};

/** Shop-service pattern replicated across municipal services. */
function standardRoles(
  prefix: string,
  label: string,
  extras: Omit<MunicipalRoleStub, "service" | "permissions">[] = [],
): MunicipalRoleStub[] {
  const base = [
    {
      name: `${prefix}_user`,
      description: `${label} — citizen/applicant`,
      service: prefix,
      permissions: [`${prefix}.applications.read`, `${prefix}.applications.write`],
    },
    {
      name: `${prefix}_admin`,
      description: `${label} — module administrator`,
      service: prefix,
      permissions: [
        `${prefix}.applications.read`,
        `${prefix}.applications.write`,
        `${prefix}.approvals.approve`,
        `${prefix}.permits.issue`,
      ],
    },
    {
      name: `${prefix}_officer`,
      description: `${label} — licensing/scrutiny officer`,
      service: prefix,
      permissions: [`${prefix}.applications.read`, `${prefix}.approvals.approve`],
    },
  ];
  const extraRoles: MunicipalRoleStub[] = extras.map((e) => ({
    ...e,
    service: prefix,
    permissions: e.name.includes("enforcement")
      ? [`${prefix}.enforcement.read`, `${prefix}.enforcement.write`]
      : [`${prefix}.inspections.read`, `${prefix}.inspections.write`],
  }));
  return [...base, ...extraRoles];
}

export const MUNICIPAL_SERVICE_CATALOG: MunicipalServiceCatalog[] = [
  { service: "shop", moduleKey: "shop", roles: standardRoles("shop", "Shop & establishment") },
  { service: "trade", moduleKey: "trade", roles: standardRoles("trade", "Trade licence") },
  { service: "building", moduleKey: "building", roles: standardRoles("building", "Building plan") },
  {
    service: "fire",
    moduleKey: "fire",
    roles: standardRoles("fire", "Fire NOC", [
      { name: "fire_inspector", description: "Fire NOC — field inspector" },
    ]),
  },
  {
    service: "advertisement",
    moduleKey: "advertisement",
    roles: standardRoles("adv", "Advertisement licence", [
      { name: "adv_enforcement", description: "Advertisement — enforcement officer" },
    ]),
  },
  { service: "vendor", moduleKey: "vendor", roles: standardRoles("vendor", "Street vendor") },
  { service: "roadcut", moduleKey: "roadcut", roles: standardRoles("roadcut", "Road cutting") },
  { service: "event", moduleKey: "event", roles: standardRoles("event", "Public event") },
  { service: "refund", moduleKey: "refund", roles: standardRoles("refund", "Fee refund") },
  { service: "sewerage", moduleKey: "sewerage", roles: standardRoles("sewerage", "Sewerage connection") },
  { service: "swm", moduleKey: "swm", roles: standardRoles("swm", "Solid waste management") },
  { service: "drainage", moduleKey: "drainage", roles: standardRoles("drainage", "Drainage") },
  { service: "parks", moduleKey: "parks", roles: standardRoles("parks", "Parks & trees") },
  { service: "animal", moduleKey: "animal", roles: standardRoles("animal", "Animal control") },
  { service: "crematorium", moduleKey: "crematorium", roles: standardRoles("crematorium", "Crematorium") },
  { service: "parking", moduleKey: "parking", roles: standardRoles("parking", "Municipal parking") },
  { service: "market", moduleKey: "market", roles: standardRoles("market", "Market allotment") },
];

/** Flat list of all municipal JWT role names (excludes super_admin). */
export function listMunicipalRoleNames(): string[] {
  const names = new Set<string>();
  for (const svc of MUNICIPAL_SERVICE_CATALOG) {
    for (const r of svc.roles) names.add(r.name);
  }
  return Array.from(names).sort();
}

/** Gateway search: role → module keys. */
export function municipalRoleModuleMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const svc of MUNICIPAL_SERVICE_CATALOG) {
    for (const role of svc.roles) {
      map[role.name] = [svc.moduleKey];
    }
  }
  return map;
}
