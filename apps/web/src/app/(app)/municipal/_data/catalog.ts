/**
 * Municipal Sec5 (BRD §5) — shared web catalog.
 * One config row per service; officer routes and citizen links derive from here.
 */

export type MunicipalServiceConfig = {
  /** URL segment under /municipal/{serviceKey} */
  serviceKey: string;
  /** Tenant module enablement key (policy-service municipal-catalog moduleKey) */
  moduleKey: string;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  /** Gateway list path, e.g. /api/v1/trade/applications */
  listPath: string;
  /** Officer-facing resource label (Applications, Registrations, …) */
  resourceLabel: string;
  /** Fields tried in order for the primary table/detail title */
  titleFields: string[];
  /** Fields tried in order for reference / tracking number column */
  numberFields: string[];
  /** Citizen catalogue serviceKey for /citizen/services/{key} apply + track */
  citizenServiceKey: string;
  /** Sec5 scope (shop is reference template, not part of the 16) */
  sec5: boolean;
};

/** 16 Sec5 services + shop reference (17 total). */
export const MUNICIPAL_SERVICE_CATALOG: MunicipalServiceConfig[] = [
  {
    serviceKey: "shop",
    moduleKey: "shop",
    label: "Shop & Establishment",
    shortLabel: "Shop",
    icon: "🏪",
    description: "Shop registration, renewal and establishment permits.",
    listPath: "/api/v1/shop/applications",
    resourceLabel: "Applications",
    titleFields: ["establishmentName", "ownerName"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "shop-establishment",
    sec5: false,
  },
  {
    serviceKey: "trade",
    moduleKey: "trade",
    label: "Trade Licence",
    shortLabel: "Trade",
    icon: "📋",
    description: "Trade licence applications, scrutiny and issuance.",
    listPath: "/api/v1/trade/applications",
    resourceLabel: "Applications",
    titleFields: ["businessName", "ownerName"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "trade-license",
    sec5: true,
  },
  {
    serviceKey: "building",
    moduleKey: "building",
    label: "Building Plan",
    shortLabel: "Building",
    icon: "🏗️",
    description: "Building plan scrutiny, permits and lifecycle.",
    listPath: "/api/v1/building/applications",
    resourceLabel: "Applications",
    titleFields: ["architectName", "siteAddress"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "building-plan",
    sec5: true,
  },
  {
    serviceKey: "fire",
    moduleKey: "fire",
    label: "Fire NOC",
    shortLabel: "Fire",
    icon: "🔥",
    description: "Fire safety NOC applications and field inspections.",
    listPath: "/api/v1/fire/applications",
    resourceLabel: "Applications",
    titleFields: ["buildingName"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "fire-noc",
    sec5: true,
  },
  {
    serviceKey: "advertisement",
    moduleKey: "advertisement",
    label: "Advertisement Licence",
    shortLabel: "Advertisement",
    icon: "📢",
    description: "Hoarding and advertisement permit applications.",
    listPath: "/api/v1/advertisement/applications",
    resourceLabel: "Applications",
    titleFields: ["advertiserName", "advertiserOrg"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "advertisement-licence",
    sec5: true,
  },
  {
    serviceKey: "vendor",
    moduleKey: "vendor",
    label: "Street Vendor",
    shortLabel: "Vendor",
    icon: "🛒",
    description: "Street vendor registration and zone allocation.",
    listPath: "/api/v1/vendor/registrations",
    resourceLabel: "Registrations",
    titleFields: ["vendorName"],
    numberFields: ["registrationNumber"],
    citizenServiceKey: "street-vendor",
    sec5: true,
  },
  {
    serviceKey: "roadcut",
    moduleKey: "roadcut",
    label: "Road Cutting",
    shortLabel: "Road cut",
    icon: "🚧",
    description: "Road cutting and restoration permit applications.",
    listPath: "/api/v1/roadcut/applications",
    resourceLabel: "Applications",
    titleFields: ["applicantName", "purpose"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "road-cutting",
    sec5: true,
  },
  {
    serviceKey: "event",
    moduleKey: "event",
    label: "Public Event",
    shortLabel: "Event",
    icon: "🎪",
    description: "Public event permission and post-event compliance.",
    listPath: "/api/v1/event/applications",
    resourceLabel: "Applications",
    titleFields: ["venueName", "organiserName"],
    numberFields: ["applicationNumber"],
    citizenServiceKey: "public-event",
    sec5: true,
  },
  {
    serviceKey: "refund",
    moduleKey: "refund",
    label: "Fee Refund",
    shortLabel: "Refund",
    icon: "💸",
    description: "Citizen fee refund requests and disbursement tracking.",
    listPath: "/api/v1/refund/requests",
    resourceLabel: "Refund requests",
    titleFields: ["applicantName", "originalServiceType"],
    numberFields: ["requestNumber"],
    citizenServiceKey: "fee-refund",
    sec5: true,
  },
  {
    serviceKey: "sewerage",
    moduleKey: "sewerage",
    label: "Sewerage & Desludging",
    shortLabel: "Sewerage",
    icon: "🚽",
    description: "Septic tank desludging bookings and billing.",
    listPath: "/api/v1/sewerage/desludging",
    resourceLabel: "Desludging bookings",
    titleFields: ["address", "requestedSlot"],
    numberFields: ["bookingNumber"],
    citizenServiceKey: "sewerage-desludging",
    sec5: true,
  },
  {
    serviceKey: "swm",
    moduleKey: "swm",
    label: "Solid Waste Management",
    shortLabel: "SWM",
    icon: "♻️",
    description: "Bulk waste generator registration and hotspot tracking.",
    listPath: "/api/v1/swm/bulk-generators",
    resourceLabel: "Bulk generators",
    titleFields: ["generatorName"],
    numberFields: ["registrationNumber"],
    citizenServiceKey: "swm-bulk-generator",
    sec5: true,
  },
  {
    serviceKey: "drainage",
    moduleKey: "drainage",
    label: "Drainage",
    shortLabel: "Drainage",
    icon: "🌊",
    description: "Drainage complaints, hotspots and field resolution.",
    listPath: "/api/v1/drainage/complaints",
    resourceLabel: "Complaints",
    titleFields: ["complaintType", "location"],
    numberFields: ["complaintNumber"],
    citizenServiceKey: "drainage-complaint",
    sec5: true,
  },
  {
    serviceKey: "parks",
    moduleKey: "parks",
    label: "Parks & Trees",
    shortLabel: "Parks",
    icon: "🌳",
    description: "Tree cutting/trimming requests and park asset upkeep.",
    listPath: "/api/v1/parks/tree-requests",
    resourceLabel: "Tree requests",
    titleFields: ["requestType", "treeSpecies"],
    numberFields: ["requestNumber"],
    citizenServiceKey: "tree-permission",
    sec5: true,
  },
  {
    serviceKey: "animal",
    moduleKey: "animal",
    label: "Animal Control",
    shortLabel: "Animal",
    icon: "🐕",
    description: "Stray and nuisance animal complaints and operations.",
    listPath: "/api/v1/animal/complaints",
    resourceLabel: "Complaints",
    titleFields: ["animalType", "complaintType"],
    numberFields: ["complaintNumber"],
    citizenServiceKey: "animal-complaint",
    sec5: true,
  },
  {
    serviceKey: "crematorium",
    moduleKey: "crematorium",
    label: "Crematorium",
    shortLabel: "Crematorium",
    icon: "🕯️",
    description: "Crematorium slot bookings and facility records.",
    listPath: "/api/v1/crematorium/bookings",
    resourceLabel: "Bookings",
    titleFields: ["deceasedName", "applicantName"],
    numberFields: ["bookingNumber"],
    citizenServiceKey: "crematorium-booking",
    sec5: true,
  },
  {
    serviceKey: "parking",
    moduleKey: "parking",
    label: "Municipal Parking",
    shortLabel: "Parking",
    icon: "🅿️",
    description: "Parking bookings, passes and enforcement.",
    listPath: "/api/v1/parking/bookings",
    resourceLabel: "Bookings",
    titleFields: ["vehicleNumber", "vehicleType"],
    numberFields: ["bookingNumber"],
    citizenServiceKey: "parking-booking",
    sec5: true,
  },
  {
    serviceKey: "market",
    moduleKey: "market",
    label: "Market Allotment",
    shortLabel: "Market",
    icon: "🏪",
    description: "Market stall allotments, rent demands and lifecycle.",
    listPath: "/api/v1/market/allotments",
    resourceLabel: "Allotments",
    titleFields: ["allotteeName", "allotmentType"],
    numberFields: ["allotmentNumber"],
    citizenServiceKey: "market-allotment",
    sec5: true,
  },
];

export const SEC5_SERVICE_COUNT = MUNICIPAL_SERVICE_CATALOG.filter((s) => s.sec5).length;

const byKey = new Map(MUNICIPAL_SERVICE_CATALOG.map((s) => [s.serviceKey, s]));

export function getMunicipalService(serviceKey: string): MunicipalServiceConfig | undefined {
  return byKey.get(serviceKey);
}

export function listSec5Services(): MunicipalServiceConfig[] {
  return MUNICIPAL_SERVICE_CATALOG.filter((s) => s.sec5);
}

export function detailPathFor(config: MunicipalServiceConfig, id: string): string {
  return `${config.listPath}/${encodeURIComponent(id)}`;
}

export function officerApplicationsHref(serviceKey: string): string {
  return `/municipal/${serviceKey}/applications`;
}

export function officerDetailHref(serviceKey: string, id: string): string {
  return `/municipal/${serviceKey}/applications/${encodeURIComponent(id)}`;
}

export function citizenServiceHref(citizenServiceKey: string): string {
  return `/citizen/services/${encodeURIComponent(citizenServiceKey)}`;
}

export function citizenApplyHref(citizenServiceKey: string): string {
  return `/citizen/services/${encodeURIComponent(citizenServiceKey)}/apply`;
}
