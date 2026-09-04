/**
 * Municipal Sec5 role catalog — canonical JWT role names referenced by route handlers.
 * Mirror pattern: {service}_user, {service}_admin, {service}_officer (+ service-specific extras).
 * Used by policy-service catalog endpoint and gateway search module mapping.
 *
 * Role names below were verified against each of the 17 services' actual
 * `requireRole(ctx, ...)` guards on `origin/main` (not just copied from an
 * earlier draft of this catalog) — see the one deliberate deviation on
 * `refund` below. Every other prefix/name here is a byte-for-byte match with
 * what's currently enforced in each service's `routes.ts`.
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
  opts: {
    /**
     * Override for the officer-tier role name when a service's actual route
     * guards use something other than `${prefix}_officer`. Only `refund`
     * needs this today — its routes check `refund_approver`, not
     * `refund_officer` (verified against `origin/main` route guards).
     */
    officerName?: string;
    extras?: Omit<MunicipalRoleStub, "service" | "permissions">[];
  } = {},
): MunicipalRoleStub[] {
  const officerName = opts.officerName ?? `${prefix}_officer`;
  const base: MunicipalRoleStub[] = [
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
      name: officerName,
      description: `${label} — licensing/scrutiny officer`,
      service: prefix,
      permissions: [`${prefix}.applications.read`, `${prefix}.approvals.approve`],
    },
  ];
  const extraRoles: MunicipalRoleStub[] = (opts.extras ?? []).map((e) => ({
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
    roles: standardRoles("fire", "Fire NOC", {
      extras: [{ name: "fire_inspector", description: "Fire NOC — field inspector" }],
    }),
  },
  {
    service: "advertisement",
    moduleKey: "advertisement",
    roles: standardRoles("adv", "Advertisement licence", {
      extras: [{ name: "adv_enforcement", description: "Advertisement — enforcement officer" }],
    }),
  },
  { service: "vendor", moduleKey: "vendor", roles: standardRoles("vendor", "Street vendor") },
  { service: "roadcut", moduleKey: "roadcut", roles: standardRoles("roadcut", "Road cutting") },
  { service: "event", moduleKey: "event", roles: standardRoles("event", "Public event") },
  {
    // Deviation from the generic mirror pattern: refund-service's actual route
    // guards (processing/routes.ts, reconciliation/routes.ts) check
    // `refund_approver`, never `refund_officer`. Minting `refund_officer` here
    // would be a dead role no guard recognizes — verified against
    // `origin/main`, not carried over from an earlier draft.
    service: "refund",
    moduleKey: "refund",
    roles: standardRoles("refund", "Fee refund", { officerName: "refund_approver" }),
  },
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
